import unittest
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers all tables for the test database
from app.database.base import Base
from app.exceptions.auth import AuthorizationError
from app.exceptions.ticket import TicketNotFoundError
from app.models.category import Category
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.ticket_comment import CommentVisibility
from app.models.ticket_event import TicketEvent, TicketEventType
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_comment import TicketCommentRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.ticket_comment import TicketCommentCreate
from app.schemas.ticket_event import TicketEventListFilters, TicketEventOrder
from app.services.ticket import TicketService
from app.services.ticket_comment import TicketCommentService
from app.services.ticket_event import TicketEventRecorder, TicketEventService


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT,
    _compiler: object,
    **_kwargs: object,
) -> str:
    return "INTEGER"


class TicketEventTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.now = datetime(2026, 9, 15, 8, 0, 0)
        self._seed()

    def tearDown(self) -> None:
        self.engine.dispose()

    def event_service(self, db: Session) -> TicketEventService:
        repository = TicketEventRepository(db)
        return TicketEventService(
            ticket_service=self.ticket_service(db, repository),
            ticket_event_repository=repository,
            user_repository=UserRepository(db),
            category_repository=CategoryRepository(db),
        )

    def ticket_service(
        self,
        db: Session,
        event_repository: TicketEventRepository | None = None,
    ) -> TicketService:
        repository = event_repository or TicketEventRepository(db)
        return TicketService(
            db=db,
            ticket_repository=TicketRepository(db),
            category_repository=CategoryRepository(db),
            user_repository=UserRepository(db),
            ticket_event_recorder=TicketEventRecorder(repository),
        )

    def list_events(
        self,
        db: Session,
        *,
        actor_id: int = 2,
        page: int = 1,
        page_size: int = 20,
        order: TicketEventOrder = TicketEventOrder.ASC,
        ticket_id: int = 100,
    ):
        actor = db.get(User, actor_id)
        assert actor is not None
        return self.event_service(db).list_events(
            ticket_id,
            TicketEventListFilters(page=page, page_size=page_size, order=order),
            actor,
        )

    def add_event(
        self,
        db: Session,
        event_type: TicketEventType,
        *,
        actor_id: int | None = 2,
        field_name: str | None = None,
        old_value: str | None = None,
        new_value: str | None = None,
        metadata: Any = None,
        created_at: datetime | None = None,
    ) -> TicketEvent:
        value = TicketEvent(
            ticket_id=100,
            actor_id=actor_id,
            event_type=event_type.value,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            event_metadata=metadata,
            created_at=created_at or self.now,
        )
        db.add(value)
        db.flush()
        return value

    def _seed(self) -> None:
        db = self.session_factory()
        db.add_all(
            [
                self._user(1, "Eli", "Employee", UserRole.EMPLOYEE, True),
                self._user(2, "Ada", "Renamed", UserRole.AGENT, True),
                self._user(3, "Amir", "Admin", UserRole.ADMIN, True),
                self._user(4, "Inez", "Inactive", UserRole.AGENT, False),
                self._user(5, "Grace", "Helper", UserRole.AGENT, True),
                self._category(10, "Hardware", True),
                self._category(11, "Legacy systems", False),
                self._category(12, "Networking", True),
            ]
        )
        db.add(
            Ticket(
                id=100,
                ticket_number="TKT-100",
                title="Printer unavailable",
                description="Offline",
                status=TicketStatus.OPEN.value,
                priority=TicketPriority.MEDIUM.value,
                category_id=10,
                created_by_id=1,
                assigned_to_id=2,
                created_at=self.now,
                updated_at=self.now,
                resolved_at=None,
                closed_at=None,
            )
        )
        db.add(
            Ticket(
                id=101,
                ticket_number="TKT-101",
                title="Admin ticket",
                description="Not employee-owned",
                status=TicketStatus.OPEN.value,
                priority=TicketPriority.LOW.value,
                category_id=10,
                created_by_id=3,
                assigned_to_id=None,
                created_at=self.now,
                updated_at=self.now,
                resolved_at=None,
                closed_at=None,
            )
        )
        db.commit()
        db.close()

    def _user(
        self,
        user_id: int,
        first_name: str,
        last_name: str,
        role: UserRole,
        active: bool,
    ) -> User:
        return User(
            id=user_id,
            email=f"user{user_id}@example.com",
            password_hash=f"hash-{user_id}",
            first_name=first_name,
            last_name=last_name,
            role=role.value,
            is_active=active,
            created_at=self.now,
            updated_at=self.now,
        )

    def _category(self, category_id: int, name: str, active: bool) -> Category:
        return Category(
            id=category_id,
            name=name,
            description=None,
            is_active=active,
            created_at=self.now,
            updated_at=self.now,
        )


class TicketEventProjectionTests(TicketEventTestCase):
    def test_all_event_types_keep_raw_fields_and_add_typed_projection(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 2)
        assert actor is not None
        recorder = TicketEventRecorder(TicketEventRepository(db))
        definitions = [
            (TicketEventType.TICKET_CREATED, {}),
            (
                TicketEventType.STATUS_CHANGED,
                {
                    "field_name": "status",
                    "old_value": "OPEN",
                    "new_value": "IN_PROGRESS",
                },
            ),
            (
                TicketEventType.PRIORITY_CHANGED,
                {"field_name": "priority", "old_value": "LOW", "new_value": "HIGH"},
            ),
            (
                TicketEventType.ASSIGNEE_CHANGED,
                {
                    "field_name": "assigned_to_id",
                    "old_value": "2",
                    "new_value": "5",
                    "metadata": {
                        TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME: "Ada Original",
                        TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME: "Grace Original",
                    },
                },
            ),
            (
                TicketEventType.CATEGORY_CHANGED,
                {
                    "field_name": "category_id",
                    "old_value": "10",
                    "new_value": "12",
                    "metadata": {
                        TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME: "Old Hardware",
                        TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME: "Old Networking",
                    },
                },
            ),
            (
                TicketEventType.COMMENT_ADDED,
                {"metadata": {"comment_id": 700, "visibility": "INTERNAL"}},
            ),
            (TicketEventType.TICKET_RESOLVED, {}),
            (TicketEventType.TICKET_CLOSED, {}),
        ]
        for offset, (event_type, values) in enumerate(definitions):
            recorder.record(
                ticket_id=100,
                actor=actor,
                event_type=event_type,
                created_at=self.now + timedelta(seconds=offset),
                **values,
            )
        db.commit()

        response = self.list_events(db)
        self.assertEqual(
            [item.event_type for item in response.items],
            list(TicketEventType),
        )
        self.assertTrue(
            all(item.actor.display_name == "Ada Renamed" for item in response.items)
        )
        assignment = response.items[3]
        self.assertEqual(assignment.old_value, "2")
        self.assertEqual(assignment.new_value, "5")
        self.assertEqual(assignment.old_display_value, "Ada Original")
        self.assertEqual(assignment.new_display_value, "Grace Original")
        category = response.items[4]
        self.assertEqual(category.old_display_value, "Old Hardware")
        self.assertEqual(category.new_display_value, "Old Networking")
        comment = response.items[5]
        self.assertEqual(comment.comment.id, 700)
        self.assertEqual(comment.comment.visibility, CommentVisibility.INTERNAL)
        self.assertEqual(comment.metadata["comment_id"], 700)
        db.close()

    def test_metadata_is_allow_listed_by_event_type(self) -> None:
        db = self.session_factory()
        legacy_metadata = {
            TicketEventRecorder.ACTOR_DISPLAY_NAME: "  Historical Ada  ",
            TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME: "Former assignee",
            TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME: "New assignee",
            TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME: "Former category",
            TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME: "New category",
            "comment_id": 77,
            "visibility": "PUBLIC",
            "content": "secret",
            "email": "private@example.invalid",
            "token": "do-not-return",
            "secret_key": "also-private",
            "unknown": {"nested": "value"},
        }
        definitions = [
            (TicketEventType.TICKET_CREATED, None),
            (TicketEventType.ASSIGNEE_CHANGED, "assigned_to_id"),
            (TicketEventType.CATEGORY_CHANGED, "category_id"),
            (TicketEventType.COMMENT_ADDED, None),
        ]
        for event_type, field_name in definitions:
            self.add_event(
                db,
                event_type,
                field_name=field_name,
                old_value="4" if field_name else None,
                new_value="5" if field_name else None,
                metadata=legacy_metadata,
            )
        db.commit()

        response = self.list_events(db)
        actor_metadata, assignment_metadata, category_metadata, comment_metadata = [
            item.metadata for item in response.items
        ]
        self.assertEqual(actor_metadata, {"actor_display_name": "Historical Ada"})
        self.assertEqual(
            assignment_metadata,
            {
                "actor_display_name": "Historical Ada",
                "old_assignee_display_name": "Former assignee",
                "new_assignee_display_name": "New assignee",
            },
        )
        self.assertEqual(
            category_metadata,
            {
                "actor_display_name": "Historical Ada",
                "old_category_display_name": "Former category",
                "new_category_display_name": "New category",
            },
        )
        self.assertEqual(
            comment_metadata,
            {
                "actor_display_name": "Historical Ada",
                "comment_id": 77,
                "visibility": "PUBLIC",
            },
        )

        payload = response.model_dump(mode="json")
        serialized = str(payload)
        for unsafe_value in (
            "secret",
            "private@example.invalid",
            "do-not-return",
            "also-private",
            "nested",
        ):
            self.assertNotIn(unsafe_value, serialized)
        db.close()

    def test_malformed_top_level_metadata_serializes_as_empty_object(self) -> None:
        db = self.session_factory()
        malformed_values = (None, [], ["not", "an", "object"], "text", 42, True)
        for offset, metadata in enumerate(malformed_values):
            self.add_event(
                db,
                TicketEventType.TICKET_CREATED,
                metadata=metadata,
                created_at=self.now + timedelta(seconds=offset),
            )
        db.commit()

        response = self.list_events(db)
        payload = response.model_dump(mode="json")
        self.assertEqual([item["metadata"] for item in payload["items"]], [{}] * 6)
        self.assertTrue(
            all(
                item["actor"]["display_name"] == "Ada Renamed"
                for item in payload["items"]
            )
        )
        db.close()

    def test_malformed_approved_values_are_ignored_and_use_safe_fallbacks(self) -> None:
        db = self.session_factory()
        self.add_event(
            db,
            TicketEventType.ASSIGNEE_CHANGED,
            field_name="assigned_to_id",
            old_value="4",
            new_value="5",
            metadata={
                TicketEventRecorder.ACTOR_DISPLAY_NAME: {"name": "Unsafe actor"},
                TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME: ["Unsafe old"],
                TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME: 123,
            },
        )
        self.add_event(
            db,
            TicketEventType.CATEGORY_CHANGED,
            field_name="category_id",
            old_value="11",
            new_value="12",
            metadata={
                TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME: {
                    "name": "Unsafe category"
                },
                TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME: False,
            },
        )
        self.add_event(
            db,
            TicketEventType.COMMENT_ADDED,
            metadata={"comment_id": "77", "visibility": {"value": "PUBLIC"}},
        )
        self.add_event(
            db,
            TicketEventType.COMMENT_ADDED,
            metadata={"comment_id": True, "visibility": "UNKNOWN"},
        )
        db.commit()

        response = self.list_events(db)
        assignment, category, invalid_nested_comment, invalid_scalar_comment = (
            response.items
        )
        self.assertEqual(assignment.metadata, {})
        self.assertEqual(assignment.actor.display_name, "Ada Renamed")
        self.assertEqual(assignment.old_display_value, "Inez Inactive")
        self.assertEqual(assignment.new_display_value, "Grace Helper")
        self.assertEqual(category.metadata, {})
        self.assertEqual(category.old_display_value, "Legacy systems")
        self.assertEqual(category.new_display_value, "Networking")
        self.assertIsNone(invalid_nested_comment.comment)
        self.assertEqual(invalid_nested_comment.metadata, {})
        self.assertIsNone(invalid_scalar_comment.comment)
        self.assertEqual(invalid_scalar_comment.metadata, {})

        serialized = str(response.model_dump(mode="json"))
        for unsafe_value in ("Unsafe actor", "Unsafe old", "Unsafe category"):
            self.assertNotIn(unsafe_value, serialized)
        db.close()

    def test_snapshot_precedence_and_legacy_inactive_fallbacks(self) -> None:
        db = self.session_factory()
        self.add_event(
            db,
            TicketEventType.ASSIGNEE_CHANGED,
            field_name="assigned_to_id",
            old_value="2",
            new_value="5",
            metadata={
                TicketEventRecorder.ACTOR_DISPLAY_NAME: "Ada Original",
                TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME: "Former Ada",
                TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME: "Former Grace",
            },
        )
        self.add_event(
            db,
            TicketEventType.ASSIGNEE_CHANGED,
            actor_id=4,
            field_name="assigned_to_id",
            old_value="4",
            new_value="999",
        )
        self.add_event(
            db,
            TicketEventType.CATEGORY_CHANGED,
            field_name="category_id",
            old_value="11",
            new_value="999",
        )
        self.add_event(db, TicketEventType.TICKET_CREATED, actor_id=None)
        self.add_event(
            db,
            TicketEventType.TICKET_CREATED,
            actor_id=None,
            metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Deleted Historical"},
        )
        db.commit()

        response = self.list_events(db)
        snapshot, legacy_user, legacy_category, deleted_actor, historical_actor = (
            response.items
        )
        self.assertEqual(snapshot.actor.display_name, "Ada Original")
        self.assertEqual(snapshot.old_display_value, "Former Ada")
        self.assertEqual(snapshot.new_display_value, "Former Grace")
        self.assertEqual(legacy_user.actor.display_name, "Inez Inactive")
        self.assertEqual(legacy_user.old_display_value, "Inez Inactive")
        self.assertEqual(legacy_user.new_display_value, "An unavailable user")
        self.assertEqual(legacy_category.old_display_value, "Legacy systems")
        self.assertEqual(legacy_category.new_display_value, "An unavailable category")
        self.assertIsNone(deleted_actor.actor)
        self.assertIsNone(historical_actor.actor.id)
        self.assertEqual(historical_actor.actor.display_name, "Deleted Historical")
        presentation = " ".join(
            filter(
                None,
                [
                    legacy_user.old_display_value,
                    legacy_user.new_display_value,
                    legacy_category.old_display_value,
                    legacy_category.new_display_value,
                ],
            )
        )
        self.assertNotIn("999", presentation)
        db.close()

    def test_generic_values_are_parsed_only_for_matching_reference_events(self) -> None:
        db = self.session_factory()
        self.add_event(
            db,
            TicketEventType.PRIORITY_CHANGED,
            field_name="priority",
            old_value="4",
            new_value="5",
        )
        self.add_event(
            db,
            TicketEventType.ASSIGNEE_CHANGED,
            field_name="wrong_field",
            old_value="4",
            new_value="5",
        )
        self.add_event(
            db,
            TicketEventType.ASSIGNEE_CHANGED,
            field_name="assigned_to_id",
            old_value="18446744073709551616",
            new_value="5",
        )
        db.commit()

        response = self.list_events(db)
        self.assertTrue(
            all(item.old_display_value is None for item in response.items[:2])
        )
        self.assertTrue(
            all(item.new_display_value is None for item in response.items[:2])
        )
        self.assertEqual(response.items[2].old_display_value, "An unavailable user")
        self.assertEqual(response.items[2].new_display_value, "Grace Helper")
        db.close()

    def test_malformed_comment_metadata_has_no_typed_projection(self) -> None:
        db = self.session_factory()
        for metadata in (
            {"comment_id": True, "visibility": "PUBLIC"},
            {"comment_id": 10, "visibility": "UNKNOWN"},
            {"comment_id": "10", "visibility": "INTERNAL", "content": "secret"},
        ):
            self.add_event(db, TicketEventType.COMMENT_ADDED, metadata=metadata)
        db.commit()

        response = self.list_events(db)
        self.assertTrue(all(item.comment is None for item in response.items))
        db.close()

    def test_response_serializes_after_session_closure_without_lazy_load(self) -> None:
        db = self.session_factory()
        self.add_event(db, TicketEventType.TICKET_CREATED)
        db.commit()
        response = self.list_events(db)
        db.expunge_all()
        db.close()

        payload = response.model_dump(mode="json")
        self.assertEqual(payload["items"][0]["actor"]["display_name"], "Ada Renamed")
        self.assertEqual(payload["items"][0]["created_at"], "2026-09-15T08:00:00Z")


class TicketEventOrderingAndQueryTests(TicketEventTestCase):
    def test_ordering_same_timestamp_and_pagination(self) -> None:
        db = self.session_factory()
        for _ in range(5):
            self.add_event(
                db,
                TicketEventType.TICKET_CREATED,
                metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Ada Snapshot"},
            )
        db.commit()

        first = self.list_events(db, page=1, page_size=2)
        second = self.list_events(db, page=2, page_size=2)
        descending = self.list_events(
            db,
            page=1,
            page_size=5,
            order=TicketEventOrder.DESC,
        )

        self.assertEqual(first.total, 5)
        self.assertEqual(first.total_pages, 3)
        self.assertEqual([item.id for item in second.items], [3, 4])
        self.assertEqual([item.id for item in descending.items], [5, 4, 3, 2, 1])
        db.close()

    def test_fully_snapshotted_page_uses_three_queries(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 2)
        assert actor is not None
        for _ in range(20):
            self.add_event(
                db,
                TicketEventType.TICKET_CREATED,
                metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Historical Ada"},
            )
        db.commit()

        statements = self._count_selects(lambda: self.list_events(db, page_size=20))

        self.assertEqual(len(statements), 3)
        db.close()

    def test_mixed_legacy_pages_use_five_queries_independent_of_page_size(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 2)
        assert actor is not None
        for _ in range(10):
            self.add_event(
                db,
                TicketEventType.ASSIGNEE_CHANGED,
                field_name="assigned_to_id",
                old_value="4",
                new_value="5",
                metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Ada Snapshot"},
            )
            self.add_event(
                db,
                TicketEventType.CATEGORY_CHANGED,
                field_name="category_id",
                old_value="11",
                new_value="12",
                metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Ada Snapshot"},
            )
        db.commit()

        ten = self._count_selects(lambda: self.list_events(db, page_size=10))
        twenty = self._count_selects(lambda: self.list_events(db, page_size=20))

        self.assertEqual(len(ten), 5)
        self.assertEqual(len(twenty), 5)
        self.assertEqual(sum("FROM users" in statement for statement in twenty), 1)
        self.assertEqual(sum("FROM categories" in statement for statement in twenty), 1)
        db.close()

    def _count_selects(self, operation) -> list[str]:
        statements: list[str] = []

        def record(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: object,
        ) -> None:
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", record)
        try:
            operation()
        finally:
            event.remove(self.engine, "before_cursor_execute", record)
        return statements


class TicketEventMutationTests(TicketEventTestCase):
    def test_assignment_and_category_snapshots_both_display_values(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 3)
        assert actor is not None
        service = self.ticket_service(db)

        service.update_assignment(100, 5, actor)
        service.update_category(100, 12, actor)

        events = list(
            db.scalars(select(TicketEvent).order_by(TicketEvent.id)).all()
        )
        assignment = db.get(TicketEvent, 1)
        category = db.get(TicketEvent, 2)
        assert assignment is not None and category is not None
        self.assertEqual(len(events), 2)
        self.assertEqual(assignment.event_metadata["actor_display_name"], "Amir Admin")
        self.assertEqual(
            assignment.event_metadata["old_assignee_display_name"],
            "Ada Renamed",
        )
        self.assertEqual(
            assignment.event_metadata["new_assignee_display_name"],
            "Grace Helper",
        )
        self.assertEqual(
            category.event_metadata["old_category_display_name"],
            "Hardware",
        )
        self.assertEqual(
            category.event_metadata["new_category_display_name"],
            "Networking",
        )
        db.close()

    def test_no_op_mutations_create_no_events(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 3)
        assert actor is not None
        service = self.ticket_service(db)

        service.update_assignment(100, 2, actor)
        service.update_priority(100, TicketPriority.MEDIUM, actor)
        service.update_category(100, 10, actor)

        self.assertEqual(db.query(TicketEvent).count(), 0)
        db.close()

    def test_comment_events_are_content_free_and_typed(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 2)
        assert actor is not None
        event_repository = TicketEventRepository(db)
        service = TicketCommentService(
            db=db,
            ticket_service=self.ticket_service(db, event_repository),
            ticket_comment_repository=TicketCommentRepository(db),
            ticket_event_recorder=TicketEventRecorder(event_repository),
        )

        service.create_comment(
            100,
            TicketCommentCreate(content="Public body", visibility="PUBLIC"),
            actor,
        )
        service.create_comment(
            100,
            TicketCommentCreate(content="Internal secret", visibility="INTERNAL"),
            actor,
        )

        response = self.list_events(db)
        self.assertEqual(
            [item.comment.visibility for item in response.items],
            [CommentVisibility.PUBLIC, CommentVisibility.INTERNAL],
        )
        for item in response.items:
            self.assertNotIn("content", item.metadata)
            self.assertEqual(item.actor.display_name, "Ada Renamed")
        db.close()

    def test_resolved_and_closed_transitions_record_ordered_event_pairs(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 2)
        assert actor is not None
        service = self.ticket_service(db)

        service.update_status(100, TicketStatus.IN_PROGRESS, actor)
        service.update_status(100, TicketStatus.RESOLVED, actor)
        service.update_status(100, TicketStatus.CLOSED, actor)

        ascending = self.list_events(db)
        self.assertEqual(
            [item.event_type for item in ascending.items],
            [
                TicketEventType.STATUS_CHANGED,
                TicketEventType.STATUS_CHANGED,
                TicketEventType.TICKET_RESOLVED,
                TicketEventType.STATUS_CHANGED,
                TicketEventType.TICKET_CLOSED,
            ],
        )
        self.assertEqual(ascending.items[1].created_at, ascending.items[2].created_at)
        self.assertEqual(ascending.items[3].created_at, ascending.items[4].created_at)
        descending = self.list_events(db, order=TicketEventOrder.DESC)
        self.assertEqual(descending.items[0].event_type, TicketEventType.TICKET_CLOSED)
        self.assertEqual(descending.items[1].event_type, TicketEventType.STATUS_CHANGED)
        db.close()


class TicketEventAuthorizationTests(TicketEventTestCase):
    def test_employee_own_ticket_and_internal_events_are_forbidden(self) -> None:
        db = self.session_factory()
        self.add_event(
            db,
            TicketEventType.COMMENT_ADDED,
            metadata={"comment_id": 1, "visibility": "INTERNAL"},
        )
        db.commit()

        with self.assertRaises(AuthorizationError):
            self.list_events(db, actor_id=1)
        db.close()

    def test_employee_other_ticket_is_not_found_before_role_disclosure(self) -> None:
        db = self.session_factory()
        employee = db.get(User, 1)
        assert employee is not None

        with self.assertRaises(TicketNotFoundError):
            self.event_service(db).list_events(
                101,
                TicketEventListFilters(),
                employee,
            )
        db.close()

    def test_agent_and_admin_can_access_visible_ticket_activity(self) -> None:
        db = self.session_factory()
        self.add_event(
            db,
            TicketEventType.TICKET_CREATED,
            metadata={TicketEventRecorder.ACTOR_DISPLAY_NAME: "Ada Snapshot"},
        )
        db.commit()

        self.assertEqual(self.list_events(db, actor_id=2).total, 1)
        self.assertEqual(self.list_events(db, actor_id=3).total, 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
