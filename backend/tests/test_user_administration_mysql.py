import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers mapped relationships
from app.core.config import settings
from app.exceptions.user import LastActiveAdminRequiredError
from app.models.user import User, UserRole
from app.repositories.user import UserRepository
from app.schemas.user import UserActivationUpdate
from app.services.user import UserService


class CoordinatedUserRepository(UserRepository):
    """Coordinate snapshots; locking remains the production implementation."""

    def __init__(self, db: Session, snapshots_ready: threading.Barrier) -> None:
        super().__init__(db)
        self.snapshots_ready = snapshots_ready

    def get_by_id(self, user_id: int) -> User | None:
        user = super().get_by_id(user_id)
        self.snapshots_ready.wait(timeout=10)
        return user


class MySqlUserActivationConcurrencyTests(unittest.TestCase):
    def test_cross_deactivation_preserves_an_active_admin_with_real_row_locks(
        self,
    ) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")

        engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=0,
        )
        table = User.__table__
        original_table_name = table.name
        test_suffix = uuid4().hex
        table.name = f"users_concurrency_{test_suffix}"
        original_constraint_names = {
            constraint: constraint.name for constraint in table.constraints
        }
        for constraint, original_name in original_constraint_names.items():
            if original_name:
                constraint.name = f"{original_name}_{test_suffix}"
        lock_statements: list[str] = []
        lock_statements_guard = threading.Lock()

        def record_for_update(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            normalized = statement.upper()
            if "FOR UPDATE" in normalized and table.name.upper() in normalized:
                with lock_statements_guard:
                    lock_statements.append(statement)

        event.listen(engine, "before_cursor_execute", record_for_update)
        try:
            table.create(engine)
            session_factory = sessionmaker(
                bind=engine,
                autoflush=False,
                expire_on_commit=False,
            )
            now = datetime(2026, 9, 17, 8, 0, 0)
            with session_factory() as setup:
                setup.add_all(
                    [
                        self._admin(1, "concurrent-a@example.com", "Admin", "A", now),
                        self._admin(2, "concurrent-b@example.com", "Admin", "B", now),
                    ]
                )
                setup.commit()

            snapshots_ready = threading.Barrier(2)

            def deactivate(actor_id: int, target_id: int) -> str:
                with session_factory() as db:
                    actor = db.get(User, actor_id)
                    assert actor is not None
                    service = UserService(
                        db,
                        CoordinatedUserRepository(db, snapshots_ready),
                        password_hasher=Mock(),
                    )
                    try:
                        service.update_activation(
                            target_id,
                            UserActivationUpdate(is_active=False),
                            actor,
                        )
                        return "committed"
                    except LastActiveAdminRequiredError:
                        return "last-active-admin-rejected"

            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(
                    executor.map(
                        lambda pair: deactivate(*pair),
                        [(1, 2), (2, 1)],
                    )
                )

            with session_factory() as verification:
                active_admins = verification.scalar(
                    select(func.count())
                    .select_from(table)
                    .where(
                        table.c.role == UserRole.ADMIN.value,
                        table.c.is_active.is_(True),
                    )
                )

            self.assertCountEqual(
                results,
                ["committed", "last-active-admin-rejected"],
            )
            self.assertEqual(active_admins, 1)
            self.assertGreaterEqual(len(lock_statements), 2)
        finally:
            try:
                table.drop(engine, checkfirst=True)
            finally:
                event.remove(engine, "before_cursor_execute", record_for_update)
                engine.dispose()
                table.name = original_table_name
                for constraint, original_name in original_constraint_names.items():
                    constraint.name = original_name

    @staticmethod
    def _admin(
        user_id: int,
        email: str,
        first_name: str,
        last_name: str,
        now: datetime,
    ) -> User:
        return User(
            id=user_id,
            email=email,
            password_hash="not-used-by-this-test",
            first_name=first_name,
            last_name=last_name,
            role=UserRole.ADMIN.value,
            is_active=True,
            created_at=now,
            updated_at=now,
        )


if __name__ == "__main__":
    unittest.main()
