import unittest
from datetime import datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.database.base import Base
from app.exceptions.auth import AuthorizationError
from app.exceptions.customer import (
    CustomerVerificationInvalidError,
    CustomerVerificationNotFoundError,
)
from app.exceptions.ticket import CustomerTicketNotFoundError
from app.models.category import Category
from app.models.customer import Customer
from app.models.customer_verification import CustomerVerification
from app.models.ticket import Ticket
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.ticket import (
    CustomerTicketLookupRequest,
    TicketResponse,
    TicketSearchRequest,
)
from app.services.ticket import TicketService
from app.services.ticket_event import TicketEventRecorder


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT, _compiler: object, **_kwargs: object
) -> str:
    return "INTEGER"


class TicketSearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        self.now = datetime(2026, 9, 18, 10, 0, 0)  # noqa: DTZ001
        with self.session_factory() as db:
            db.add_all(
                [
                    self.user(1, UserRole.EMPLOYEE),
                    self.user(2, UserRole.EMPLOYEE),
                    self.user(3, UserRole.AGENT),
                    self.user(4, UserRole.ADMIN),
                    Category(
                        id=10,
                        name="Support",
                        description=None,
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                    self.customer(20, "CUS-0000000000000001", "Thomas", "Müller"),
                    self.customer(21, "CUS-0000000000000002", "Ada", "Lovelace"),
                ]
            )
            db.flush()
            db.add_all(
                [
                    CustomerVerification(
                        id=30,
                        customer_id=20,
                        verified_by_user_id=1,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now,
                        expires_at=datetime(2099, 1, 1),  # noqa: DTZ001
                    ),
                    CustomerVerification(
                        id=31,
                        customer_id=21,
                        verified_by_user_id=1,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now,
                        expires_at=datetime(2099, 1, 1),  # noqa: DTZ001
                    ),
                    CustomerVerification(
                        id=32,
                        customer_id=20,
                        verified_by_user_id=2,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now,
                        expires_at=datetime(2099, 1, 1),  # noqa: DTZ001
                    ),
                    CustomerVerification(
                        id=33,
                        customer_id=20,
                        verified_by_user_id=1,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now - timedelta(hours=2),
                        expires_at=datetime(2000, 1, 1),  # noqa: DTZ001
                    ),
                ]
            )
            db.flush()
            db.add_all(
                [
                    self.ticket(40, "TKT-4ZFUPC6W7ZFJDEWY", "Outlook search", 20),
                    self.ticket(41, "TKT-AAAAAAAAAAAAAAAA", "Outlook cannot send", 21),
                    self.ticket(42, "TKT-BBBBBBBBBBBBBBBB", "Printer offline", None),
                    self.ticket(
                        43,
                        "TKT-CCCCCCCCCCCCCCCC",
                        "outlook calendar",
                        20,
                        created_at=self.now + timedelta(minutes=1),
                    ),
                ]
            )
            db.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def user(self, user_id: int, role: UserRole) -> User:
        return User(
            id=user_id,
            email=f"user{user_id}@example.com",
            password_hash="hash",
            first_name="User",
            last_name=str(user_id),
            role=role.value,
            is_active=True,
            created_at=self.now,
            updated_at=self.now,
        )

    def customer(
        self, customer_id: int, number: str, first_name: str, last_name: str
    ) -> Customer:
        return Customer(
            id=customer_id,
            customer_number=number,
            first_name=first_name,
            last_name=last_name,
            date_of_birth=None,
            email=f"customer{customer_id}@example.com",
            phone=None,
            street=None,
            house_number=None,
            postal_code=None,
            city=None,
            country=None,
            is_active=True,
            created_at=self.now,
            updated_at=self.now,
        )

    def ticket(
        self,
        ticket_id: int,
        number: str,
        title: str,
        customer_id: int | None,
        *,
        created_at: datetime | None = None,
    ) -> Ticket:
        timestamp = created_at or self.now
        return Ticket(
            id=ticket_id,
            ticket_number=number,
            title=title,
            description="Private support description",
            status="OPEN",
            priority="MEDIUM",
            category_id=10,
            created_by_id=1,
            assigned_to_id=None,
            customer_id=customer_id,
            customer_verification_id=30 if customer_id == 20 else None,
            created_at=timestamp,
            updated_at=timestamp,
            resolved_at=None,
            closed_at=None,
        )

    def service(self, db: Session) -> TicketService:
        return TicketService(
            db,
            TicketRepository(db),
            CategoryRepository(db),
            UserRepository(db),
            TicketEventRecorder(TicketEventRepository(db)),
            CustomerRepository(db),
            CustomerVerificationRepository(db),
        )

    def test_ticket_number_contract_normalizes_and_rejects_malformed_values(
        self,
    ) -> None:
        lookup = CustomerTicketLookupRequest(
            ticket_number="  tkt-4zfupc6w7zfjdewy  ",
            customer_verification_id=30,
        )
        self.assertEqual(lookup.ticket_number, "TKT-4ZFUPC6W7ZFJDEWY")
        for value in ("", "TKT-123", "TKT-4ZFUPC6W7ZFJDEW!", "4ZFUPC6W7ZFJDEWY"):
            with self.assertRaises(ValidationError):
                CustomerTicketLookupRequest(
                    ticket_number=value, customer_verification_id=30
                )

    def test_verified_employee_can_lookup_same_customer_ticket_privately(self) -> None:
        with self.session_factory() as db:
            actor = db.get(User, 1)
            assert actor is not None
            ticket = self.service(db).lookup_customer_ticket(
                20,
                CustomerTicketLookupRequest(
                    ticket_number=" tkt-4zfupc6w7zfjdewy ",
                    customer_verification_id=30,
                ),
                actor,
            )
            response = TicketResponse.model_validate(ticket).model_dump()
            self.assertEqual(ticket.id, 40)
            self.assertEqual(
                set(response["customer"]),
                {"id", "customer_number", "first_name", "last_name"},
            )
            for private_field in ("email", "phone", "date_of_birth", "postal_code"):
                self.assertNotIn(private_field, response["customer"])

    def test_wrong_customer_and_missing_ticket_share_safe_failure(self) -> None:
        with self.session_factory() as db:
            actor = db.get(User, 1)
            assert actor is not None
            service = self.service(db)
            for number in ("TKT-AAAAAAAAAAAAAAAA", "TKT-ZZZZZZZZZZZZZZZZ"):
                with self.assertRaises(CustomerTicketNotFoundError):
                    service.lookup_customer_ticket(
                        20,
                        CustomerTicketLookupRequest(
                            ticket_number=number, customer_verification_id=30
                        ),
                        actor,
                    )
            with self.assertRaises(CustomerTicketNotFoundError):
                service.lookup_customer_ticket(
                    20,
                    CustomerTicketLookupRequest(
                        ticket_number="TKT-BBBBBBBBBBBBBBBB",
                        customer_verification_id=30,
                    ),
                    actor,
                )

    def test_lookup_requires_same_employee_customer_and_current_verification(
        self,
    ) -> None:
        with self.session_factory() as db:
            actor = db.get(User, 1)
            assert actor is not None
            service = self.service(db)
            for verification_id, error in (
                (999, CustomerVerificationNotFoundError),
                (31, CustomerVerificationInvalidError),
                (32, CustomerVerificationInvalidError),
                (33, CustomerVerificationInvalidError),
            ):
                with self.assertRaises(error):
                    service.lookup_customer_ticket(
                        20,
                        CustomerTicketLookupRequest(
                            ticket_number="TKT-4ZFUPC6W7ZFJDEWY",
                            customer_verification_id=verification_id,
                        ),
                        actor,
                    )

    def test_internal_exact_and_title_search_are_paginated_and_role_scoped(
        self,
    ) -> None:
        with self.session_factory() as db:
            service = self.service(db)
            agent = db.get(User, 3)
            admin = db.get(User, 4)
            employee = db.get(User, 1)
            assert agent is not None and admin is not None and employee is not None
            exact = service.search_tickets(
                TicketSearchRequest(
                    kind="TICKET_NUMBER", value=" tkt-bbbbbbbbbbbbbbbb "
                ),
                agent,
            )
            self.assertEqual([ticket.id for ticket in exact.items], [42])
            first = service.search_tickets(
                TicketSearchRequest(kind="TITLE", value="OUTLOOK", page_size=1),
                admin,
            )
            second = service.search_tickets(
                TicketSearchRequest(kind="TITLE", value="outlook", page=2, page_size=1),
                agent,
            )
            self.assertEqual(first.total, 3)
            self.assertEqual(first.total_pages, 3)
            self.assertEqual(first.items[0].id, 43)
            self.assertEqual(second.items[0].id, 41)
            self.assertIsNone(exact.items[0].customer)
            with self.assertRaises(AuthorizationError):
                service.search_tickets(
                    TicketSearchRequest(kind="TITLE", value="Outlook"), employee
                )


if __name__ == "__main__":
    unittest.main()
