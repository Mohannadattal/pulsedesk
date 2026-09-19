import unittest
from datetime import datetime, timedelta
from email.message import EmailMessage

from sqlalchemy import create_engine, func, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.database.base import Base
from app.exceptions.ticket import (
    InvalidResolutionSummaryError,
    InvalidTicketStatusTransitionError,
)
from app.models.category import Category
from app.models.customer import Customer
from app.models.customer_email_delivery import (
    CustomerEmailDelivery,
    CustomerEmailStatus,
    CustomerEmailType,
)
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_email_delivery import CustomerEmailDeliveryRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.ticket import TicketCreate, TicketStatusUpdate
from app.services.customer_email_delivery import (
    MAXIMUM_DELIVERY_ATTEMPTS,
    MAXIMUM_DELIVERY_RETRIES,
    RETRY_DELAYS_AFTER_FAILED_ATTEMPTS,
    CustomerEmailDeliveryProcessor,
    CustomerEmailOutboxService,
)
from app.services.customer_email_templates import CustomerEmailTemplateRenderer
from app.services.customer_email_worker import CustomerEmailWorker
from app.services.email_transport import build_customer_email_message
from app.services.ticket import TicketService
from app.services.ticket_event import TicketEventRecorder


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT,
    _compiler: object,
    **_kwargs: object,
) -> str:
    return "INTEGER"


class RecordingTransport:
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.messages: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.messages.append(message)
        if self.error is not None:
            raise self.error


class FailingEventRecorder(TicketEventRecorder):
    def record(self, *args: object, **kwargs: object):
        raise RuntimeError("force transaction rollback")


class CustomerEmailTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.now = datetime(2026, 9, 19, 9, 0, 0)  # noqa: DTZ001
        with self.session_factory() as db:
            db.add_all(
                [
                    User(
                        id=1,
                        email="employee@example.com",
                        password_hash="hash",
                        first_name="Eli",
                        last_name="Employee",
                        role=UserRole.EMPLOYEE.value,
                        is_active=True,
                        must_change_password=False,
                        auth_version=0,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                    User(
                        id=2,
                        email="agent@example.com",
                        password_hash="hash",
                        first_name="Ada",
                        last_name="Agent",
                        role=UserRole.AGENT.value,
                        is_active=True,
                        must_change_password=False,
                        auth_version=0,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                    Category(
                        id=10,
                        name="Hardware",
                        description=None,
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                    Customer(
                        id=20,
                        customer_number="CUS-WITH-EMAIL",
                        first_name="<Mira>",
                        last_name="Customer",
                        email="original@example.net",
                        phone=None,
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                    Customer(
                        id=21,
                        customer_number="CUS-PHONE-ONLY",
                        first_name="Noemi",
                        last_name="Phone",
                        email=None,
                        phone="+14155550123",
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                ]
            )
            db.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def ticket_service(
        self,
        db: Session,
        *,
        event_recorder: TicketEventRecorder | None = None,
    ) -> TicketService:
        return TicketService(
            db=db,
            ticket_repository=TicketRepository(db),
            category_repository=CategoryRepository(db),
            user_repository=UserRepository(db),
            ticket_event_recorder=(
                event_recorder or TicketEventRecorder(TicketEventRepository(db))
            ),
            customer_repository=CustomerRepository(db),
        )

    def create_ticket(
        self,
        db: Session,
        *,
        customer_id: int = 20,
        title: str = "Printer <offline>",
    ) -> Ticket:
        actor = db.get(User, 1)
        assert actor is not None
        return self.ticket_service(db).create_ticket(
            TicketCreate(
                title=title,
                description="Internal request details",
                category_id=10,
                customer_id=customer_id,
            ),
            actor,
        )

    def add_delivery(
        self,
        db: Session,
        *,
        delivery_id: int,
        status: CustomerEmailStatus = CustomerEmailStatus.PENDING,
        next_attempt_at: datetime | None = None,
        processing_started_at: datetime | None = None,
        attempt_count: int = 0,
        email_type: CustomerEmailType = CustomerEmailType.TICKET_CREATED,
    ) -> CustomerEmailDelivery:
        if db.get(Ticket, 100) is None:
            db.add(
                Ticket(
                    id=100,
                    ticket_number="TKT-TESTREFERENCE1",
                    title="Printer <offline>",
                    description="Internal description must stay private",
                    resolution_summary=None,
                    status=TicketStatus.IN_PROGRESS.value,
                    priority=TicketPriority.MEDIUM.value,
                    category_id=10,
                    created_by_id=1,
                    assigned_to_id=2,
                    customer_id=20,
                    customer_verification_id=None,
                    created_at=self.now,
                    updated_at=self.now,
                    resolved_at=None,
                    closed_at=None,
                )
            )
            db.flush()
        delivery = CustomerEmailDelivery(
            id=delivery_id,
            ticket_id=100,
            customer_id=20,
            recipient_email="snapshot@example.net",
            email_type=email_type.value,
            status=status.value,
            idempotency_key=f"test:{delivery_id}",
            customer_first_name="<Mira>",
            ticket_number="TKT-TESTREFERENCE1",
            ticket_title="Printer <offline>",
            resolution_summary=(
                "Reset <script>alert('x')</script>\nCompleted"
                if email_type == CustomerEmailType.TICKET_RESOLVED
                else None
            ),
            attempt_count=attempt_count,
            next_attempt_at=(self.now if next_attempt_at is None else next_attempt_at),
            processing_started_at=processing_started_at,
            processing_token=(
                "old-processing-token"
                if status == CustomerEmailStatus.PROCESSING
                else None
            ),
            sent_at=None,
            last_error=None,
            created_at=self.now,
            updated_at=self.now,
        )
        db.add(delivery)
        db.commit()
        return delivery

    def processor(
        self,
        db: Session,
        transport: RecordingTransport,
        *,
        enabled: bool = True,
        batch_size: int = 50,
    ) -> CustomerEmailDeliveryProcessor:
        return CustomerEmailDeliveryProcessor(
            db=db,
            repository=CustomerEmailDeliveryRepository(db),
            renderer=CustomerEmailTemplateRenderer(
                product_name="PulseDesk",
                support_name="PulseDesk Support",
            ),
            transport=transport,
            delivery_enabled=enabled,
            batch_size=batch_size,
            lease_duration=timedelta(minutes=10),
            from_address="support@example.com",
            from_name="PulseDesk",
            reply_to="help@example.com",
        )


class CustomerEmailBusinessTests(CustomerEmailTestCase):
    def test_creation_stages_one_safe_snapshot_and_snapshots_recipient(self) -> None:
        with self.session_factory() as db:
            ticket = self.create_ticket(db)
            delivery = db.scalar(select(CustomerEmailDelivery))
            assert delivery is not None
            self.assertEqual(delivery.email_type, CustomerEmailType.TICKET_CREATED)
            self.assertEqual(delivery.recipient_email, "original@example.net")
            self.assertEqual(delivery.customer_first_name, "<Mira>")
            self.assertEqual(delivery.ticket_number, ticket.ticket_number)
            self.assertEqual(delivery.ticket_title, "Printer <offline>")
            self.assertIsNone(delivery.resolution_summary)
            persisted = " ".join(
                str(getattr(delivery, column.name))
                for column in CustomerEmailDelivery.__table__.columns
            )
            self.assertNotIn("Internal request details", persisted)
            self.assertNotIn("verification", persisted.lower())

            customer = db.get(Customer, 20)
            assert customer is not None
            customer.email = "changed@example.net"
            db.commit()
            db.refresh(delivery)
            self.assertEqual(delivery.recipient_email, "original@example.net")

    def test_creation_without_email_succeeds_without_delivery(self) -> None:
        with self.session_factory() as db:
            ticket = self.create_ticket(db, customer_id=21)
            self.assertIsNotNone(ticket.id)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                0,
            )

        with self.session_factory() as db:
            actor = db.get(User, 1)
            assert actor is not None
            ticket = self.ticket_service(db).create_ticket(
                TicketCreate(
                    title="Internal ticket",
                    description="No linked customer",
                    category_id=10,
                ),
                actor,
            )
            self.assertIsNone(ticket.customer_id)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                0,
            )

    def test_creation_ticket_and_delivery_roll_back_together(self) -> None:
        with self.session_factory() as db:
            actor = db.get(User, 1)
            assert actor is not None
            service = self.ticket_service(
                db,
                event_recorder=FailingEventRecorder(TicketEventRepository(db)),
            )
            with self.assertRaises(RuntimeError):
                service.create_ticket(
                    TicketCreate(
                        title="Rollback",
                        description="Rollback",
                        category_id=10,
                        customer_id=20,
                    ),
                    actor,
                )
            self.assertEqual(db.scalar(select(func.count()).select_from(Ticket)), 0)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                0,
            )

    def test_resolution_requires_trimmed_summary_and_persists_delivery(self) -> None:
        with self.session_factory() as db:
            ticket = self.create_ticket(db)
            actor = db.get(User, 2)
            assert actor is not None
            service = self.ticket_service(db)
            service.update_status(ticket.id, TicketStatus.IN_PROGRESS, actor)

            for invalid in (None, "   ", "x" * 2001):
                with self.assertRaises(InvalidResolutionSummaryError):
                    service.update_status(
                        ticket.id,
                        TicketStatus.RESOLVED,
                        actor,
                        resolution_summary=invalid,
                    )

            resolved = service.update_status(
                ticket.id,
                TicketStatus.RESOLVED,
                actor,
                resolution_summary="  Replaced the cable.  ",
            )
            self.assertEqual(resolved.resolution_summary, "Replaced the cable.")
            deliveries = list(
                db.scalars(
                    select(CustomerEmailDelivery).order_by(CustomerEmailDelivery.id)
                ).all()
            )
            self.assertEqual(
                [item.email_type for item in deliveries],
                [
                    CustomerEmailType.TICKET_CREATED.value,
                    CustomerEmailType.TICKET_RESOLVED.value,
                ],
            )
            self.assertEqual(deliveries[1].resolution_summary, "Replaced the cable.")

            with self.assertRaises(InvalidTicketStatusTransitionError):
                service.update_status(
                    ticket.id,
                    TicketStatus.RESOLVED,
                    actor,
                    resolution_summary="Duplicate service execution.",
                )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                2,
            )

            service.update_status(ticket.id, TicketStatus.CLOSED, actor)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                2,
            )

    def test_resolution_without_email_succeeds_and_rollback_is_atomic(self) -> None:
        with self.session_factory() as db:
            ticket = self.create_ticket(db, customer_id=21)
            actor = db.get(User, 2)
            assert actor is not None
            service = self.ticket_service(db)
            service.update_status(ticket.id, TicketStatus.IN_PROGRESS, actor)
            service.update_status(
                ticket.id,
                TicketStatus.RESOLVED,
                actor,
                resolution_summary="Solved by phone.",
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                0,
            )

        with self.session_factory() as db:
            ticket = self.create_ticket(db)
            actor = db.get(User, 2)
            assert actor is not None
            self.ticket_service(db).update_status(
                ticket.id, TicketStatus.IN_PROGRESS, actor
            )
            failing = self.ticket_service(
                db,
                event_recorder=FailingEventRecorder(TicketEventRepository(db)),
            )
            with self.assertRaises(RuntimeError):
                failing.update_status(
                    ticket.id,
                    TicketStatus.RESOLVED,
                    actor,
                    resolution_summary="Must roll back.",
                )
            db.expire_all()
            persisted = db.get(Ticket, ticket.id)
            assert persisted is not None
            self.assertEqual(persisted.status, TicketStatus.IN_PROGRESS.value)
            self.assertIsNone(persisted.resolution_summary)
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(CustomerEmailDelivery)
                    .where(
                        CustomerEmailDelivery.email_type
                        == CustomerEmailType.TICKET_RESOLVED.value
                    )
                ),
                0,
            )

    def test_outbox_stage_is_idempotent_under_database_unique_constraint(self) -> None:
        with self.session_factory() as db:
            ticket = self.create_ticket(db)
            customer = db.get(Customer, 20)
            assert customer is not None
            outbox = CustomerEmailOutboxService(db, CustomerEmailDeliveryRepository(db))
            first = outbox.stage_ticket_created(ticket, customer, created_at=self.now)
            second = outbox.stage_ticket_created(ticket, customer, created_at=self.now)
            db.commit()
            assert first is not None and second is not None
            self.assertEqual(first.id, second.id)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(CustomerEmailDelivery)),
                1,
            )

    def test_status_request_contract_requires_summary_only_for_resolution(self) -> None:
        resolved = TicketStatusUpdate(
            status=TicketStatus.RESOLVED,
            resolution_summary="  Fixed  ",
        )
        self.assertEqual(resolved.resolution_summary, "Fixed")
        for values in (
            {"status": TicketStatus.RESOLVED},
            {"status": TicketStatus.RESOLVED, "resolution_summary": "  "},
            {"status": TicketStatus.CLOSED, "resolution_summary": "unexpected"},
        ):
            with self.assertRaises(ValueError):
                TicketStatusUpdate(**values)


class CustomerEmailTemplateTests(CustomerEmailTestCase):
    def test_created_and_resolved_multipart_templates_escape_html(self) -> None:
        with self.session_factory() as db:
            created = self.add_delivery(db, delivery_id=1)
            resolved = self.add_delivery(
                db,
                delivery_id=2,
                email_type=CustomerEmailType.TICKET_RESOLVED,
            )
            renderer = CustomerEmailTemplateRenderer(
                product_name="PulseDesk",
                support_name="Support <Team>",
            )
            created_rendered = renderer.render(created)
            resolved_rendered = renderer.render(resolved)

            for rendered in (created_rendered, resolved_rendered):
                self.assertTrue(rendered.text_body)
                self.assertIn("<html", rendered.html_body)
                self.assertIn("&lt;Mira&gt;", rendered.html_body)
                self.assertIn("Printer &lt;offline&gt;", rendered.html_body)
                self.assertNotIn("Internal description", rendered.text_body)
                self.assertNotIn("Internal description", rendered.html_body)
            self.assertNotIn("Resolution", created_rendered.text_body)
            self.assertNotIn("Resolution", created_rendered.html_body)
            self.assertIn("Resolution", resolved_rendered.text_body)
            self.assertIn("&lt;script&gt;", resolved_rendered.html_body)
            self.assertNotIn("<script>", resolved_rendered.html_body)
            self.assertIn("<script>", resolved_rendered.text_body)

            self.assertEqual(
                created_rendered.subject,
                "We received your request — TKT-TESTREFERENCE1",
            )
            first_message = build_customer_email_message(
                created,
                created_rendered,
                from_address="support@example.com",
                from_name="PulseDesk",
                reply_to="help@example.com",
            )
            second_message = build_customer_email_message(
                created,
                created_rendered,
                from_address="support@example.com",
                from_name="PulseDesk",
                reply_to="help@example.com",
            )
            self.assertEqual(first_message["Message-ID"], second_message["Message-ID"])
            self.assertEqual(first_message["Reply-To"], "help@example.com")


class CustomerEmailProcessorTests(CustomerEmailTestCase):
    def test_worker_automatically_processes_pending_due_delivery(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(db, delivery_id=1)
            transport = RecordingTransport()
            processor = self.processor(db, transport)
            worker: CustomerEmailWorker

            def process_batch():
                result = processor.process_batch(now=self.now)
                worker.request_shutdown()
                return result

            worker = CustomerEmailWorker(
                process_batch=process_batch,
                polling_interval_seconds=5,
            )
            worker.run(delivery_enabled=True)

            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(delivery.status, CustomerEmailStatus.SENT.value)
            self.assertEqual(len(transport.messages), 1)

    def test_disabled_worker_does_not_claim_or_send(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(db, delivery_id=1)
            transport = RecordingTransport()
            processor = self.processor(db, transport, enabled=False)
            worker: CustomerEmailWorker

            def process_batch():
                result = processor.process_batch(now=self.now)
                worker.request_shutdown()
                return result

            worker = CustomerEmailWorker(
                process_batch=process_batch,
                polling_interval_seconds=5,
            )
            worker.run(delivery_enabled=False)

            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(delivery.status, CustomerEmailStatus.PENDING.value)
            self.assertEqual(delivery.attempt_count, 0)
            self.assertEqual(transport.messages, [])

    def test_due_success_is_sent_as_multipart_and_processor_is_repeatable(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(db, delivery_id=1)
            transport = RecordingTransport()
            processor = self.processor(db, transport)
            result = processor.process_batch(now=self.now)
            self.assertEqual((result.claimed, result.sent), (1, 1))
            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(delivery.status, CustomerEmailStatus.SENT.value)
            self.assertEqual(delivery.attempt_count, 1)
            self.assertEqual(delivery.sent_at, self.now)
            self.assertIsNone(delivery.processing_started_at)
            self.assertIsNone(delivery.processing_token)
            self.assertTrue(transport.messages[0].is_multipart())
            self.assertEqual(transport.messages[0]["To"], "snapshot@example.net")
            first_message_id = transport.messages[0]["Message-ID"]

            repeated = processor.process_batch(now=self.now + timedelta(minutes=1))
            self.assertEqual(repeated.claimed, 0)
            self.assertEqual(len(transport.messages), 1)
            self.assertTrue(first_message_id.startswith("<pulsedesk-"))

    def test_future_nonstale_and_disabled_deliveries_are_not_claimed(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(
                db,
                delivery_id=1,
                next_attempt_at=self.now + timedelta(seconds=1),
            )
            self.add_delivery(
                db,
                delivery_id=2,
                status=CustomerEmailStatus.PROCESSING,
                processing_started_at=self.now - timedelta(minutes=9),
                attempt_count=1,
            )
            transport = RecordingTransport()
            self.assertEqual(
                self.processor(db, transport).process_batch(now=self.now).claimed,
                0,
            )
            disabled = self.processor(db, transport, enabled=False).process_batch(
                now=self.now + timedelta(hours=1)
            )
            self.assertTrue(disabled.disabled)
            self.assertEqual(len(transport.messages), 0)

    def test_complete_retry_timeline_ends_after_sixth_failed_attempt(self) -> None:
        self.assertEqual(MAXIMUM_DELIVERY_RETRIES, 5)
        self.assertEqual(MAXIMUM_DELIVERY_ATTEMPTS, 6)
        expected_delays = (
            timedelta(minutes=1),
            timedelta(minutes=5),
            timedelta(minutes=15),
            timedelta(hours=1),
            timedelta(hours=6),
        )
        self.assertEqual(RETRY_DELAYS_AFTER_FAILED_ATTEMPTS, expected_delays)
        with self.session_factory() as db:
            self.add_delivery(db, delivery_id=1)
            transport = RecordingTransport(
                RuntimeError("smtp://user:password@secret.example.invalid private body")
            )
            processor = self.processor(db, transport)
            attempt_at = self.now

            for attempt_number, retry_delay in enumerate(expected_delays, start=1):
                with self.subTest(attempt_number=attempt_number):
                    result = processor.process_batch(now=attempt_at)
                    delivery = db.get(CustomerEmailDelivery, 1)
                    assert delivery is not None
                    self.assertEqual(result.retry_scheduled, 1)
                    self.assertEqual(result.terminal_failed, 0)
                    self.assertEqual(delivery.attempt_count, attempt_number)
                    self.assertEqual(delivery.status, CustomerEmailStatus.FAILED.value)
                    self.assertEqual(
                        delivery.next_attempt_at,
                        attempt_at + retry_delay,
                    )
                    self.assertEqual(
                        delivery.last_error,
                        "Email delivery failed (RuntimeError).",
                    )
                    attempt_at += retry_delay

            result = processor.process_batch(now=attempt_at)
            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(result.terminal_failed, 1)
            self.assertEqual(result.retry_scheduled, 0)
            self.assertEqual(delivery.attempt_count, MAXIMUM_DELIVERY_ATTEMPTS)
            self.assertEqual(delivery.status, CustomerEmailStatus.FAILED.value)
            self.assertIsNone(delivery.next_attempt_at)
            self.assertEqual(len(transport.messages), MAXIMUM_DELIVERY_ATTEMPTS)

            repeated = processor.process_batch(now=attempt_at + timedelta(days=1))
            self.assertEqual(repeated.claimed, 0)
            self.assertEqual(len(transport.messages), MAXIMUM_DELIVERY_ATTEMPTS)

    def test_sixth_attempt_can_succeed_normally(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(
                db,
                delivery_id=1,
                status=CustomerEmailStatus.FAILED,
                attempt_count=MAXIMUM_DELIVERY_ATTEMPTS - 1,
            )
            result = self.processor(db, RecordingTransport()).process_batch(
                now=self.now
            )
            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual((result.claimed, result.sent), (1, 1))
            self.assertEqual(delivery.attempt_count, MAXIMUM_DELIVERY_ATTEMPTS)
            self.assertEqual(delivery.status, CustomerEmailStatus.SENT.value)
            self.assertEqual(delivery.sent_at, self.now)
            self.assertIsNone(delivery.next_attempt_at)

    def test_delivery_at_six_attempts_cannot_be_claimed_for_a_seventh(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(
                db,
                delivery_id=1,
                status=CustomerEmailStatus.FAILED,
                attempt_count=MAXIMUM_DELIVERY_ATTEMPTS,
            )
            transport = RecordingTransport()
            result = self.processor(db, transport).process_batch(now=self.now)
            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(result.claimed, 0)
            self.assertEqual(delivery.attempt_count, MAXIMUM_DELIVERY_ATTEMPTS)
            self.assertEqual(len(transport.messages), 0)

    def test_stale_processing_is_recovered_but_fresh_is_not(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(
                db,
                delivery_id=1,
                status=CustomerEmailStatus.PROCESSING,
                processing_started_at=self.now - timedelta(minutes=10),
                attempt_count=1,
            )
            self.add_delivery(
                db,
                delivery_id=2,
                status=CustomerEmailStatus.PROCESSING,
                processing_started_at=self.now - timedelta(minutes=9),
                attempt_count=1,
            )
            transport = RecordingTransport()
            result = self.processor(db, transport).process_batch(now=self.now)
            self.assertEqual((result.claimed, result.sent), (1, 1))
            self.assertEqual(db.get(CustomerEmailDelivery, 1).attempt_count, 2)
            self.assertEqual(
                db.get(CustomerEmailDelivery, 2).status,
                CustomerEmailStatus.PROCESSING.value,
            )

    def test_stale_final_attempt_becomes_terminal_without_another_send(self) -> None:
        with self.session_factory() as db:
            self.add_delivery(
                db,
                delivery_id=1,
                status=CustomerEmailStatus.PROCESSING,
                processing_started_at=self.now - timedelta(minutes=10),
                attempt_count=MAXIMUM_DELIVERY_ATTEMPTS,
            )
            transport = RecordingTransport()
            result = self.processor(db, transport).process_batch(now=self.now)
            delivery = db.get(CustomerEmailDelivery, 1)
            assert delivery is not None
            self.assertEqual(result.stale_terminalized, 1)
            self.assertEqual(result.claimed, 0)
            self.assertEqual(delivery.status, CustomerEmailStatus.FAILED.value)
            self.assertEqual(delivery.attempt_count, MAXIMUM_DELIVERY_ATTEMPTS)
            self.assertIsNone(delivery.next_attempt_at)
            self.assertEqual(len(transport.messages), 0)

    def test_batch_is_bounded(self) -> None:
        with self.session_factory() as db:
            for delivery_id in range(1, 4):
                self.add_delivery(db, delivery_id=delivery_id)
            result = self.processor(
                db,
                RecordingTransport(),
                batch_size=2,
            ).process_batch(now=self.now)
            self.assertEqual((result.claimed, result.sent), (2, 2))
            pending = db.scalar(
                select(func.count())
                .select_from(CustomerEmailDelivery)
                .where(
                    CustomerEmailDelivery.status == CustomerEmailStatus.PENDING.value
                )
            )
            self.assertEqual(pending, 1)


if __name__ == "__main__":
    unittest.main()
