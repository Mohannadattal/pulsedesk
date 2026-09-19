import asyncio
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock

from sqlalchemy import create_engine, func, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers all mapped tables
from app.core.security import password_hasher
from app.database.base import Base
from app.dependencies.auth import get_current_user
from app.dependencies.database import get_db
from app.main import app as application
from app.models.category import Category
from app.models.notification import Notification, NotificationType
from app.models.password_reset_request import PasswordResetRequest
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.ticket_event import TicketEvent, TicketEventType
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.notification import NotificationRepository
from app.repositories.password_reset_request import PasswordResetRequestRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_comment import TicketCommentRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.auth import PasswordResetRequestCreate
from app.schemas.password_reset_request import AdminResetPasswordRequest
from app.schemas.ticket_comment import TicketCommentCreate
from app.services.notification import NotificationRetentionService, NotificationService
from app.services.password_reset_request import PasswordResetService
from app.services.ticket import TicketService
from app.services.ticket_comment import TicketCommentService
from app.services.ticket_event import TicketEventRecorder


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT,
    _compiler: object,
    **_kwargs: object,
) -> str:
    return "INTEGER"


class NotificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.password_hash = password_hasher.hash("notification-test-password")

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
        self.now = datetime(2026, 9, 18, 10, 0, 0)  # noqa: DTZ001
        self._seed()

    def tearDown(self) -> None:
        application.dependency_overrides.pop(get_db, None)
        application.dependency_overrides.pop(get_current_user, None)
        self.engine.dispose()

    def test_feed_ownership_filters_pagination_order_and_projection(self) -> None:
        with self.session_factory() as db:
            same_time = self.now + timedelta(minutes=1)
            db.add_all(
                [
                    self._notification(10, 1, self.now),
                    self._notification(11, 1, same_time),
                    self._notification(12, 1, same_time, is_read=True),
                    self._notification(13, 2, self.now),
                    self._notification(14, 3, self.now),
                ]
            )
            db.commit()

        for user_id, expected_ids in ((1, [12, 11, 10]), (2, [13]), (3, [14])):
            status_code, body = self._request(user_id, "GET", "/api/v1/notifications")
            self.assertEqual(status_code, 200)
            self.assertEqual([item["id"] for item in body["items"]], expected_ids)
            self.assertNotIn("recipient_user_id", body["items"][0])
            self.assertNotIn("content", json.dumps(body))
            self.assertNotIn("description", json.dumps(body))

        status_code, body = self._request(
            1,
            "GET",
            "/api/v1/notifications?unread_only=true&page=1&page_size=1",
        )
        self.assertEqual(status_code, 200)
        self.assertEqual(body["total"], 2)
        self.assertEqual(body["total_pages"], 2)
        self.assertEqual([item["id"] for item in body["items"]], [11])
        self.assertEqual(body["items"][0]["actor"]["id"], 3)
        self.assertEqual(body["items"][0]["ticket"]["id"], 100)
        self.assertEqual(
            set(body["items"][0]["ticket"]),
            {"id", "ticket_number", "title"},
        )

    def test_unread_count_mark_read_ownership_idempotency_and_read_all(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._notification(20, 1, self.now),
                    self._notification(21, 1, self.now + timedelta(seconds=1)),
                    self._notification(22, 2, self.now),
                ]
            )
            db.commit()

        self.assertEqual(
            self._request(1, "GET", "/api/v1/notifications/unread-count"),
            (200, {"unread_count": 2}),
        )
        status_code, first = self._request(1, "PATCH", "/api/v1/notifications/20/read")
        self.assertEqual(status_code, 200)
        self.assertTrue(first["is_read"])
        self.assertIsNotNone(first["read_at"])
        status_code, second = self._request(1, "PATCH", "/api/v1/notifications/20/read")
        self.assertEqual(status_code, 200)
        self.assertEqual(second["read_at"], first["read_at"])

        missing_status, missing = self._request(
            1, "PATCH", "/api/v1/notifications/22/read"
        )
        self.assertEqual(missing_status, 404)
        self.assertEqual(missing["code"], "NOTIFICATION_NOT_FOUND")

        self.assertEqual(
            self._request(1, "POST", "/api/v1/notifications/read-all"),
            (200, {"updated_count": 1}),
        )
        self.assertEqual(
            self._request(1, "GET", "/api/v1/notifications/unread-count"),
            (200, {"unread_count": 0}),
        )
        self.assertEqual(
            self._request(2, "GET", "/api/v1/notifications/unread-count"),
            (200, {"unread_count": 1}),
        )
        with self.session_factory() as db:
            own = db.get(Notification, 21)
            other = db.get(Notification, 22)
            assert own is not None and other is not None
            self.assertIsNotNone(own.read_at)
            self.assertIsNone(other.read_at)

    def test_assignment_reassignment_self_and_no_op_rules(self) -> None:
        with self.session_factory() as db:
            service = self._ticket_service(db)
            admin = self._user_from(db, 3)
            agent = self._user_from(db, 2)

            service.update_assignment(101, 2, admin)
            service.update_assignment(101, 5, admin)
            service.update_assignment(101, 5, admin)
            service.update_assignment(102, None, admin)
            service.update_assignment(102, 2, agent)

            notifications = list(
                db.scalars(select(Notification).order_by(Notification.id)).all()
            )
            self.assertEqual(
                [(item.recipient_user_id, item.type) for item in notifications],
                [
                    (2, NotificationType.TICKET_ASSIGNED.value),
                    (5, NotificationType.TICKET_REASSIGNED.value),
                ],
            )

    def test_public_comment_and_internal_comment_recipient_rules(self) -> None:
        with self.session_factory() as db:
            service = self._comment_service(db)
            employee = self._user_from(db, 1)
            agent = self._user_from(db, 2)

            service.create_comment(
                100,
                TicketCommentCreate(
                    content="Employee public body", visibility="PUBLIC"
                ),
                employee,
            )
            service.create_comment(
                101,
                TicketCommentCreate(content="No assignee", visibility="PUBLIC"),
                employee,
            )
            service.create_comment(
                100,
                TicketCommentCreate(content="Agent public body", visibility="PUBLIC"),
                agent,
            )
            service.create_comment(
                100,
                TicketCommentCreate(
                    content="Secret internal body", visibility="INTERNAL"
                ),
                agent,
            )

            notifications = list(db.scalars(select(Notification)).all())
            self.assertEqual(
                {
                    (item.recipient_user_id, item.actor_user_id)
                    for item in notifications
                },
                {(2, 1), (1, 2)},
            )
            self.assertTrue(
                all(
                    item.type == NotificationType.TICKET_PUBLIC_COMMENT.value
                    for item in notifications
                )
            )
            persisted = json.dumps(
                [
                    {
                        column.name: getattr(item, column.name)
                        for column in Notification.__table__.columns
                        if column.name not in {"created_at", "read_at"}
                    }
                    for item in notifications
                ]
            )
            self.assertNotIn("Employee public body", persisted)
            self.assertNotIn("Agent public body", persisted)
            self.assertNotIn("Secret internal body", persisted)

    def test_status_notifications_go_only_to_employee_creator(self) -> None:
        with self.session_factory() as db:
            service = self._ticket_service(db)
            admin = self._user_from(db, 3)
            service.update_status(100, TicketStatus.IN_PROGRESS, admin)
            service.update_status(
                100,
                TicketStatus.RESOLVED,
                admin,
                resolution_summary="The request was completed.",
            )
            service.update_status(100, TicketStatus.CLOSED, admin)
            service.update_status(102, TicketStatus.IN_PROGRESS, admin)

            notifications = list(
                db.scalars(select(Notification).order_by(Notification.id)).all()
            )
            self.assertEqual(
                [(item.recipient_user_id, item.type) for item in notifications],
                [
                    (1, NotificationType.TICKET_IN_PROGRESS.value),
                    (1, NotificationType.TICKET_RESOLVED.value),
                    (1, NotificationType.TICKET_CLOSED.value),
                ],
            )

    def test_password_request_broadcast_completion_privacy_and_self_rule(self) -> None:
        with self.session_factory() as db:
            service = self._password_reset_service(db)
            service.request_reset(PasswordResetRequestCreate(email="agent@example.com"))
            service.request_reset(PasswordResetRequestCreate(email="agent@example.com"))

            requested = list(
                db.scalars(
                    select(Notification).where(
                        Notification.type
                        == NotificationType.PASSWORD_RESET_REQUESTED.value
                    )
                ).all()
            )
            self.assertEqual(
                {item.recipient_user_id for item in requested},
                {3, 6},
            )
            self.assertTrue(all(item.actor_user_id is None for item in requested))

            request = db.scalar(select(PasswordResetRequest))
            assert request is not None
            admin = self._user_from(db, 3)
            temporary_password = "Temporary-notification-secret-927!"
            service.reset_password(
                request.id,
                AdminResetPasswordRequest(
                    temporary_password=temporary_password,
                    confirm_temporary_password=temporary_password,
                ),
                admin,
            )
            completed = db.scalar(
                select(Notification).where(
                    Notification.type == NotificationType.PASSWORD_RESET_COMPLETED.value
                )
            )
            assert completed is not None
            self.assertEqual(completed.recipient_user_id, 2)
            self.assertEqual(completed.actor_user_id, 3)
            self.assertNotIn(temporary_password, repr(completed.__dict__))

            self_request = PasswordResetRequest(
                user_id=3,
                status="PENDING",
                requested_at=self.now,
                resolved_at=None,
                resolved_by_user_id=None,
            )
            db.add(self_request)
            db.commit()
            service.reset_password(
                self_request.id,
                AdminResetPasswordRequest(
                    temporary_password="Another-temporary-secret-314!",
                    confirm_temporary_password="Another-temporary-secret-314!",
                ),
                admin,
            )
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(Notification)
                    .where(
                        Notification.type
                        == NotificationType.PASSWORD_RESET_COMPLETED.value
                    )
                ),
                1,
            )

    def test_notification_failure_rolls_back_owning_ticket_change(self) -> None:
        with self.session_factory() as db:
            failing_notifications = Mock()
            failing_notifications.notify_ticket_assignment.side_effect = RuntimeError(
                "forced notification failure"
            )
            service = self._ticket_service(
                db, notification_service=failing_notifications
            )
            admin = self._user_from(db, 3)
            with self.assertRaises(RuntimeError):
                service.update_assignment(101, 2, admin)

        with self.session_factory() as verification_db:
            ticket = verification_db.get(Ticket, 101)
            assert ticket is not None
            self.assertIsNone(ticket.assigned_to_id)
            self.assertEqual(
                verification_db.scalar(select(func.count()).select_from(Notification)),
                0,
            )

    def test_notification_failure_rolls_back_password_reset_request(self) -> None:
        with self.session_factory() as db:
            failing_notifications = Mock()
            failing_notifications.notify_password_reset_requested.side_effect = (
                RuntimeError("forced notification failure")
            )
            service = PasswordResetService(
                db=db,
                password_reset_repository=PasswordResetRequestRepository(db),
                user_repository=UserRepository(db),
                password_hasher=password_hasher,
                notification_service=failing_notifications,
            )
            with self.assertRaises(RuntimeError):
                service.request_reset(
                    PasswordResetRequestCreate(email="other-employee@example.com")
                )

        with self.session_factory() as verification_db:
            self.assertEqual(
                verification_db.scalar(
                    select(func.count()).select_from(PasswordResetRequest)
                ),
                0,
            )

    def test_retention_uses_a_strict_90_day_cutoff_for_read_and_unread(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._notification(30, 1, self.now - timedelta(days=89)),
                    self._notification(
                        31,
                        1,
                        self.now - timedelta(days=90),
                        is_read=True,
                    ),
                    self._notification(
                        32,
                        1,
                        self.now - timedelta(days=90, microseconds=1),
                        is_read=True,
                    ),
                    self._notification(
                        33,
                        1,
                        self.now - timedelta(days=120),
                        is_read=False,
                    ),
                    self._notification(34, 1, self.now, is_read=True),
                ]
            )
            db.commit()

            service = NotificationRetentionService(
                db,
                NotificationRepository(db),
                retention_days=90,
                batch_size=100,
            )

            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 2)
            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 0)
            self.assertEqual(
                set(db.scalars(select(Notification.id)).all()),
                {30, 31, 34},
            )

    def test_retention_cleanup_is_bounded_and_preserves_ticket_activity(self) -> None:
        with self.session_factory() as db:
            db.add(
                TicketEvent(
                    id=900,
                    ticket_id=100,
                    actor_id=3,
                    event_type=TicketEventType.TICKET_CREATED.value,
                    field_name=None,
                    old_value=None,
                    new_value=None,
                    event_metadata=None,
                    created_at=self.now - timedelta(days=180),
                )
            )
            db.add_all(
                [
                    self._notification(
                        notification_id,
                        1,
                        self.now - timedelta(days=100 + notification_id),
                    )
                    for notification_id in range(40, 45)
                ]
            )
            db.commit()

            service = NotificationRetentionService(
                db,
                NotificationRepository(db),
                retention_days=90,
                batch_size=2,
            )

            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 2)
            self.assertEqual(
                db.scalar(select(func.count()).select_from(Notification)),
                3,
            )
            self.assertIsNotNone(db.get(TicketEvent, 900))
            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 2)
            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 1)
            self.assertEqual(service.cleanup_expired_batch(as_of=self.now), 0)
            self.assertIsNotNone(db.get(TicketEvent, 900))

    def _notification(
        self,
        notification_id: int,
        recipient_user_id: int,
        created_at: datetime,
        *,
        is_read: bool = False,
    ) -> Notification:
        return Notification(
            id=notification_id,
            recipient_user_id=recipient_user_id,
            type=NotificationType.TICKET_PUBLIC_COMMENT.value,
            ticket_id=100,
            actor_user_id=3,
            is_read=is_read,
            created_at=created_at,
            read_at=created_at if is_read else None,
        )

    def _notification_service(self, db: Session) -> NotificationService:
        return NotificationService(
            db,
            NotificationRepository(db),
            UserRepository(db),
        )

    def _ticket_service(
        self,
        db: Session,
        *,
        notification_service: object | None = None,
    ) -> TicketService:
        return TicketService(
            db=db,
            ticket_repository=TicketRepository(db),
            category_repository=CategoryRepository(db),
            user_repository=UserRepository(db),
            ticket_event_recorder=TicketEventRecorder(TicketEventRepository(db)),
            notification_service=(
                notification_service or self._notification_service(db)
            ),
        )

    def _comment_service(self, db: Session) -> TicketCommentService:
        event_repository = TicketEventRepository(db)
        return TicketCommentService(
            db=db,
            ticket_service=TicketService(
                db=db,
                ticket_repository=TicketRepository(db),
                category_repository=CategoryRepository(db),
                user_repository=UserRepository(db),
                ticket_event_recorder=TicketEventRecorder(event_repository),
                notification_service=self._notification_service(db),
            ),
            ticket_comment_repository=TicketCommentRepository(db),
            ticket_event_recorder=TicketEventRecorder(event_repository),
            notification_service=self._notification_service(db),
        )

    def _password_reset_service(self, db: Session) -> PasswordResetService:
        return PasswordResetService(
            db=db,
            password_reset_repository=PasswordResetRequestRepository(db),
            user_repository=UserRepository(db),
            password_hasher=password_hasher,
            notification_service=self._notification_service(db),
        )

    def _request(
        self,
        user_id: int,
        method: str,
        path: str,
    ) -> tuple[int, dict[str, object]]:
        def override_db():  # type: ignore[no-untyped-def]
            with self.session_factory() as db:
                yield db

        def override_user() -> User:
            with self.session_factory() as db:
                user = db.get(User, user_id)
                assert user is not None
                db.expunge(user)
                return user

        application.dependency_overrides[get_db] = override_db
        application.dependency_overrides[get_current_user] = override_user

        async def invoke() -> tuple[int, dict[str, object]]:
            response_status = 0
            response_body = bytearray()

            async def receive() -> dict[str, object]:
                return {"type": "http.request", "body": b"", "more_body": False}

            async def send(message: dict[str, object]) -> None:
                nonlocal response_status
                if message["type"] == "http.response.start":
                    response_status = int(message["status"])
                elif message["type"] == "http.response.body":
                    response_body.extend(message.get("body", b""))

            raw_path, _, raw_query = path.partition("?")
            await application(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": method,
                    "scheme": "http",
                    "path": raw_path,
                    "raw_path": raw_path.encode(),
                    "query_string": raw_query.encode(),
                    "headers": [],
                    "client": ("test", 1),
                    "server": ("test", 80),
                },
                receive,
                send,
            )
            return response_status, json.loads(response_body)

        return asyncio.run(invoke())

    def _user_from(self, db: Session, user_id: int) -> User:
        user = db.get(User, user_id)
        assert user is not None
        return user

    def _seed(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._user(1, "employee@example.com", UserRole.EMPLOYEE),
                    self._user(2, "agent@example.com", UserRole.AGENT),
                    self._user(3, "admin@example.com", UserRole.ADMIN),
                    self._user(4, "other-employee@example.com", UserRole.EMPLOYEE),
                    self._user(5, "other-agent@example.com", UserRole.AGENT),
                    self._user(6, "other-admin@example.com", UserRole.ADMIN),
                    self._user(
                        7,
                        "inactive-admin@example.com",
                        UserRole.ADMIN,
                        is_active=False,
                    ),
                    Category(
                        id=10,
                        name="Support",
                        description=None,
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                ]
            )
            db.add_all(
                [
                    self._ticket(100, created_by_id=1, assigned_to_id=2),
                    self._ticket(101, created_by_id=1, assigned_to_id=None),
                    self._ticket(102, created_by_id=3, assigned_to_id=2),
                ]
            )
            db.commit()

    def _user(
        self,
        user_id: int,
        email: str,
        role: UserRole,
        *,
        is_active: bool = True,
    ) -> User:
        return User(
            id=user_id,
            email=email,
            password_hash=self.password_hash,
            first_name=f"First{user_id}",
            last_name=f"Last{user_id}",
            role=role.value,
            is_active=is_active,
            must_change_password=False,
            auth_version=0,
            created_at=self.now,
            updated_at=self.now,
        )

    def _ticket(
        self,
        ticket_id: int,
        *,
        created_by_id: int,
        assigned_to_id: int | None,
    ) -> Ticket:
        return Ticket(
            id=ticket_id,
            ticket_number=f"TKT-{ticket_id}",
            title=f"Ticket {ticket_id}",
            description="Description that must never enter a notification.",
            status=TicketStatus.OPEN.value,
            priority=TicketPriority.MEDIUM.value,
            category_id=10,
            created_by_id=created_by_id,
            assigned_to_id=assigned_to_id,
            customer_id=None,
            customer_verification_id=None,
            created_at=self.now,
            updated_at=self.now,
            resolved_at=None,
            closed_at=None,
        )
