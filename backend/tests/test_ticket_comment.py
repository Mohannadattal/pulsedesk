import unittest
from datetime import datetime
from unittest.mock import Mock

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers all mapped tables for the test database
from app.database.base import Base
from app.models.category import Category
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.ticket_comment import CommentVisibility, TicketComment
from app.models.user import User, UserRole
from app.repositories.ticket_comment import TicketCommentRepository
from app.schemas.ticket_comment import (
    TicketCommentCreate,
    TicketCommentListResponse,
    TicketCommentResponse,
)
from app.services.ticket_comment import TicketCommentService


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(_type: BIGINT, _compiler: object, **_kwargs: object) -> str:
    return "INTEGER"


class TicketCommentAuthorLoadingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.now = datetime(2026, 9, 15, 8, 0, 0)
        self._seed_ticket_and_comments()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_create_returns_a_detachable_comment_with_explicit_author(self) -> None:
        db = self.session_factory()
        actor = db.get(User, 1)
        assert actor is not None
        db.expunge(actor)
        ticket_service = Mock()
        event_recorder = Mock()
        service = TicketCommentService(
            db=db,
            ticket_service=ticket_service,
            ticket_comment_repository=TicketCommentRepository(db),
            ticket_event_recorder=event_recorder,
        )

        comment = service.create_comment(
            10,
            TicketCommentCreate(content="Created response", visibility="PUBLIC"),
            actor,
        )

        ticket_service.get_ticket.assert_called_once_with(10, actor)
        event_recorder.record.assert_called_once()
        self.assertNotIn("author", inspect(comment).unloaded)
        self.assertTrue(
            {"email", "password_hash", "role", "is_active"}.issubset(
                inspect(comment.author).unloaded,
            ),
        )
        db.close()

        response = TicketCommentResponse.model_validate(comment)
        self.assertEqual(
            response.author.model_dump(),
            {
                "id": 1,
                "first_name": "Eli",
                "last_name": "Employee",
            },
        )

    def test_list_eager_loads_minimal_author_references_in_one_query(self) -> None:
        db = self.session_factory()
        statements: list[str] = []

        def record_statement(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: object,
        ) -> None:
            statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", record_statement)
        try:
            comments, total = TicketCommentRepository(db).list_for_ticket(
                10,
                visibility=CommentVisibility.PUBLIC,
                page=1,
                page_size=20,
            )
            query_count_after_load = len(statements)
            response = TicketCommentListResponse(
                items=comments,
                page=1,
                page_size=20,
                total=total,
                total_pages=1,
            )
        finally:
            event.remove(self.engine, "before_cursor_execute", record_statement)

        self.assertEqual(total, 2)
        self.assertEqual(query_count_after_load, 3)
        self.assertEqual(len(statements), query_count_after_load)
        self.assertEqual(
            [item.author.first_name for item in response.items],
            ["Eli", "Inez"],
        )
        author_statement = next(
            statement for statement in statements if "FROM users" in statement
        )
        self.assertIn("users.id", author_statement)
        self.assertIn("users.first_name", author_statement)
        self.assertIn("users.last_name", author_statement)
        self.assertNotIn("users.email", author_statement)
        self.assertNotIn("users.password_hash", author_statement)
        self.assertTrue(
            {"email", "password_hash", "role", "is_active"}.issubset(
                inspect(comments[1].author).unloaded,
            ),
        )
        db.expunge_all()
        db.close()
        TicketCommentResponse.model_validate(comments[0])
        TicketCommentResponse.model_validate(comments[1])

    def _seed_ticket_and_comments(self) -> None:
        db: Session = self.session_factory()
        db.add_all(
            [
                User(
                    id=1,
                    email="eli@example.com",
                    password_hash="hash-one",
                    first_name="Eli",
                    last_name="Employee",
                    role=UserRole.EMPLOYEE.value,
                    is_active=True,
                    created_at=self.now,
                    updated_at=self.now,
                ),
                User(
                    id=2,
                    email="inez@example.com",
                    password_hash="hash-two",
                    first_name="Inez",
                    last_name="Inactive",
                    role=UserRole.AGENT.value,
                    is_active=False,
                    created_at=self.now,
                    updated_at=self.now,
                ),
                Category(
                    id=4,
                    name="Hardware",
                    description=None,
                    is_active=True,
                    created_at=self.now,
                    updated_at=self.now,
                ),
            ],
        )
        db.add(
            Ticket(
                id=10,
                ticket_number="TKT-TEST",
                title="Printer unavailable",
                description="The printer is offline.",
                status=TicketStatus.OPEN.value,
                priority=TicketPriority.MEDIUM.value,
                category_id=4,
                created_by_id=1,
                assigned_to_id=None,
                created_at=self.now,
                updated_at=self.now,
                resolved_at=None,
                closed_at=None,
            ),
        )
        db.add_all(
            [
                TicketComment(
                    id=100,
                    ticket_id=10,
                    author_id=1,
                    content="First",
                    visibility=CommentVisibility.PUBLIC.value,
                    created_at=self.now,
                    updated_at=self.now,
                ),
                TicketComment(
                    id=101,
                    ticket_id=10,
                    author_id=2,
                    content="Historical author",
                    visibility=CommentVisibility.PUBLIC.value,
                    created_at=self.now,
                    updated_at=self.now,
                ),
            ],
        )
        db.commit()
        db.close()


if __name__ == "__main__":
    unittest.main()
