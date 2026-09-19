import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.core.config import settings
from app.models.category import Category
from app.models.customer import Customer
from app.models.customer_email_delivery import (
    CustomerEmailDelivery,
    CustomerEmailStatus,
    CustomerEmailType,
)
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User, UserRole
from app.repositories.customer_email_delivery import CustomerEmailDeliveryRepository
from app.services.customer_email_delivery import MAXIMUM_DELIVERY_ATTEMPTS


class CustomerEmailClaimConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")
        self.engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=3,
            max_overflow=0,
        )
        self.factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.now = datetime(2026, 9, 19, 12, 0, 0)  # noqa: DTZ001
        unique = uuid4().hex
        with self.factory() as db:
            user = User(
                email=f"email-claim-{unique}@example.com",
                password_hash="hash",
                first_name="Claim",
                last_name="Worker",
                role=UserRole.EMPLOYEE.value,
                is_active=True,
                must_change_password=False,
                auth_version=0,
                created_at=self.now,
                updated_at=self.now,
            )
            category = Category(
                name=f"email-claim-{unique}",
                description=None,
                is_active=True,
                created_at=self.now,
                updated_at=self.now,
            )
            customer = Customer(
                customer_number=f"CUS-{unique[:16].upper()}",
                first_name="Concurrent",
                last_name="Customer",
                email=f"customer-{unique}@example.net",
                phone=None,
                is_active=True,
                created_at=self.now,
                updated_at=self.now,
            )
            db.add_all([user, category, customer])
            db.flush()
            ticket = Ticket(
                ticket_number=f"TKT-{unique[:16].upper()}",
                title="Concurrent delivery claim",
                description="Test",
                resolution_summary=None,
                status=TicketStatus.OPEN.value,
                priority=TicketPriority.MEDIUM.value,
                category_id=category.id,
                created_by_id=user.id,
                assigned_to_id=None,
                customer_id=customer.id,
                customer_verification_id=None,
                created_at=self.now,
                updated_at=self.now,
                resolved_at=None,
                closed_at=None,
            )
            db.add(ticket)
            db.flush()
            delivery = CustomerEmailDelivery(
                ticket_id=ticket.id,
                customer_id=customer.id,
                recipient_email=customer.email,
                email_type=CustomerEmailType.TICKET_CREATED.value,
                status=CustomerEmailStatus.PENDING.value,
                idempotency_key=f"mysql-claim:{unique}",
                customer_first_name=customer.first_name,
                ticket_number=ticket.ticket_number,
                ticket_title=ticket.title,
                resolution_summary=None,
                attempt_count=0,
                next_attempt_at=self.now,
                processing_started_at=None,
                processing_token=None,
                sent_at=None,
                last_error=None,
                created_at=self.now,
                updated_at=self.now,
            )
            db.add(delivery)
            db.commit()
            self.user_id = user.id
            self.category_id = category.id
            self.customer_id = customer.id
            self.ticket_id = ticket.id
            self.delivery_id = delivery.id

    def tearDown(self) -> None:
        if not hasattr(self, "factory"):
            return
        with self.factory() as db:
            db.execute(
                delete(CustomerEmailDelivery).where(
                    CustomerEmailDelivery.id == self.delivery_id
                )
            )
            db.execute(delete(Ticket).where(Ticket.id == self.ticket_id))
            db.execute(delete(Customer).where(Customer.id == self.customer_id))
            db.execute(delete(Category).where(Category.id == self.category_id))
            db.execute(delete(User).where(User.id == self.user_id))
            db.commit()
        self.engine.dispose()

    def test_skip_locked_prevents_two_workers_claiming_same_delivery(self) -> None:
        first_claimed = threading.Event()
        release_first = threading.Event()

        def first_worker() -> list[int]:
            with self.factory() as db:
                claimed = CustomerEmailDeliveryRepository(db).claim_due(
                    now=self.now,
                    stale_before=self.now - timedelta(minutes=10),
                    batch_size=50,
                    maximum_attempts=MAXIMUM_DELIVERY_ATTEMPTS,
                )
                first_claimed.set()
                if not release_first.wait(timeout=10):
                    raise RuntimeError("Timed out waiting to release first claim.")
                db.rollback()
                return [item.id for item in claimed]

        def second_worker() -> list[int]:
            if not first_claimed.wait(timeout=5):
                raise RuntimeError("First worker did not acquire its row lock.")
            with self.factory() as db:
                claimed = CustomerEmailDeliveryRepository(db).claim_due(
                    now=self.now,
                    stale_before=self.now - timedelta(minutes=10),
                    batch_size=50,
                    maximum_attempts=MAXIMUM_DELIVERY_ATTEMPTS,
                )
                db.commit()
                return [item.id for item in claimed]

        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(first_worker)
            second = executor.submit(second_worker)
            try:
                self.assertEqual(second.result(timeout=10), [])
            finally:
                release_first.set()
            self.assertEqual(first.result(timeout=10), [self.delivery_id])

        with self.factory() as db:
            delivery = db.scalar(
                select(CustomerEmailDelivery).where(
                    CustomerEmailDelivery.id == self.delivery_id
                )
            )
            assert delivery is not None
            self.assertEqual(delivery.status, CustomerEmailStatus.PENDING.value)
            self.assertEqual(delivery.attempt_count, 0)


if __name__ == "__main__":
    unittest.main()
