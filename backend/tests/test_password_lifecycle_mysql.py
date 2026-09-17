import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers mapped relationships
from app.core.config import settings
from app.core.security import AccessTokenManager, password_hasher
from app.exceptions.password_reset_request import (
    PasswordResetRequestResolvedError,
)
from app.models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from app.models.user import User, UserRole
from app.repositories.password_reset_request import (
    PasswordResetRequestRepository,
)
from app.repositories.user import UserRepository
from app.schemas.auth import LoginRequest, PasswordResetRequestCreate, SessionType
from app.schemas.password_reset_request import AdminResetPasswordRequest
from app.services.auth import AuthenticationService
from app.services.password_reset_request import PasswordResetService


class CoordinatedPendingRepository(PasswordResetRequestRepository):
    def __init__(self, db: Session, barrier: threading.Barrier) -> None:
        super().__init__(db)
        self.barrier = barrier

    def pending_exists_for_user(self, user_id: int) -> bool:
        exists = super().pending_exists_for_user(user_id)
        self.barrier.wait(timeout=10)
        return exists


class CoordinatedLockRepository(PasswordResetRequestRepository):
    def __init__(self, db: Session, barrier: threading.Barrier) -> None:
        super().__init__(db)
        self.barrier = barrier

    def get_by_id_for_update(
        self,
        request_id: int,
    ) -> PasswordResetRequest | None:
        self.barrier.wait(timeout=10)
        return super().get_by_id_for_update(request_id)


class CoordinatedRequestLockRepository(PasswordResetRequestRepository):
    """Pause only after each transaction owns its distinct request lock."""

    def __init__(self, db: Session, barrier: threading.Barrier) -> None:
        super().__init__(db)
        self.barrier = barrier

    def get_by_id_for_update(
        self,
        request_id: int,
    ) -> PasswordResetRequest | None:
        request = super().get_by_id_for_update(request_id)
        self.barrier.wait(timeout=10)
        return request


class MySqlPasswordLifecycleConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")
        self.engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=4,
            max_overflow=0,
        )
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.user_ids: list[int] = []

    def tearDown(self) -> None:
        if not hasattr(self, "engine"):
            return
        if self.user_ids:
            with self.session_factory() as db:
                db.execute(
                    delete(PasswordResetRequest).where(
                        PasswordResetRequest.user_id.in_(self.user_ids)
                    )
                )
                db.execute(delete(User).where(User.id.in_(self.user_ids)))
                db.commit()
        self.engine.dispose()

    def test_concurrent_public_requests_create_one_pending_row(self) -> None:
        user_id = self._insert_user(UserRole.EMPLOYEE)
        email = self._email(user_id)
        barrier = threading.Barrier(2)

        def submit() -> str:
            with self.session_factory() as db:
                service = PasswordResetService(
                    db,
                    CoordinatedPendingRepository(db, barrier),
                    UserRepository(db),
                    password_hasher,
                )
                return service.request_reset(
                    PasswordResetRequestCreate(email=email)
                ).detail

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: submit(), range(2)))

        self.assertEqual(results[0], results[1])
        with self.session_factory() as db:
            count = db.scalar(
                select(func.count())
                .select_from(PasswordResetRequest)
                .where(
                    PasswordResetRequest.user_id == user_id,
                    PasswordResetRequest.status
                    == PasswordResetRequestStatus.PENDING.value,
                )
            )
        self.assertEqual(count, 1)

    def test_two_admins_can_only_mutate_a_pending_request_once(self) -> None:
        admin_a_id = self._insert_user(UserRole.ADMIN)
        admin_b_id = self._insert_user(UserRole.ADMIN)
        target_id = self._insert_user(UserRole.EMPLOYEE)
        with self.session_factory() as db:
            request = PasswordResetRequest(
                user_id=target_id,
                status=PasswordResetRequestStatus.PENDING.value,
                requested_at=datetime(2026, 9, 17, 13, 0, 0),
            )
            db.add(request)
            db.commit()
            request_id = request.id

        barrier = threading.Barrier(2)

        def resolve(admin_id: int, password: str) -> str:
            with self.session_factory() as db:
                admin = db.get(User, admin_id)
                assert admin is not None
                service = PasswordResetService(
                    db,
                    CoordinatedLockRepository(db, barrier),
                    UserRepository(db),
                    password_hasher,
                )
                try:
                    service.reset_password(
                        request_id,
                        AdminResetPasswordRequest(
                            temporary_password=password,
                            confirm_temporary_password=password,
                        ),
                        admin,
                    )
                    return "resolved"
                except PasswordResetRequestResolvedError:
                    return "already-resolved"

        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(
                    lambda values: resolve(*values),
                    [
                        (admin_a_id, "first-temporary-password"),
                        (admin_b_id, "second-temporary-password"),
                    ],
                )
            )

        self.assertCountEqual(results, ["resolved", "already-resolved"])
        with self.session_factory() as db:
            target = db.get(User, target_id)
            request = db.get(PasswordResetRequest, request_id)
            assert target is not None and request is not None
            self.assertEqual(target.auth_version, 1)
            self.assertTrue(target.must_change_password)
            self.assertEqual(
                sum(
                    password_hasher.verify(candidate, target.password_hash)
                    for candidate in (
                        "first-temporary-password",
                        "second-temporary-password",
                    )
                ),
                1,
            )
            self.assertEqual(
                request.status,
                PasswordResetRequestStatus.RESOLVED.value,
            )
            self.assertIn(
                request.resolved_by_user_id,
                {admin_a_id, admin_b_id},
            )

    def test_cross_admin_resets_lock_users_in_the_same_order(self) -> None:
        admin_a_id = self._insert_user(UserRole.ADMIN)
        admin_b_id = self._insert_user(UserRole.ADMIN)
        with self.session_factory() as db:
            request_for_a = PasswordResetRequest(
                user_id=admin_a_id,
                status=PasswordResetRequestStatus.PENDING.value,
                requested_at=datetime(2026, 9, 17, 13, 0, 0),
            )
            request_for_b = PasswordResetRequest(
                user_id=admin_b_id,
                status=PasswordResetRequestStatus.PENDING.value,
                requested_at=datetime(2026, 9, 17, 13, 0, 1),
            )
            db.add_all([request_for_a, request_for_b])
            db.commit()
            request_for_a_id = request_for_a.id
            request_for_b_id = request_for_b.id

        barrier = threading.Barrier(2)
        password_for_a = "Cross-Admin-A-Sentinel-731!"
        password_for_b = "Cross-Admin-B-Sentinel-482!"

        def reset(
            actor_id: int,
            request_id: int,
            password: str,
        ) -> tuple[int, int]:
            with self.session_factory() as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                service = PasswordResetService(
                    db,
                    CoordinatedRequestLockRepository(db, barrier),
                    UserRepository(db),
                    password_hasher,
                )
                result = service.reset_password(
                    request_id,
                    AdminResetPasswordRequest(
                        temporary_password=password,
                        confirm_temporary_password=password,
                    ),
                    actor,
                )
                return result.id, result.resolved_by_user_id or 0

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = (
                executor.submit(
                    reset,
                    admin_a_id,
                    request_for_b_id,
                    password_for_b,
                ),
                executor.submit(
                    reset,
                    admin_b_id,
                    request_for_a_id,
                    password_for_a,
                ),
            )
            results = [future.result(timeout=15) for future in futures]

        self.assertCountEqual(
            results,
            [
                (request_for_b_id, admin_a_id),
                (request_for_a_id, admin_b_id),
            ],
        )
        with self.session_factory() as db:
            admin_a = db.get(User, admin_a_id)
            admin_b = db.get(User, admin_b_id)
            request_for_a = db.get(PasswordResetRequest, request_for_a_id)
            request_for_b = db.get(PasswordResetRequest, request_for_b_id)
            assert admin_a is not None and admin_b is not None
            assert request_for_a is not None and request_for_b is not None
            self.assertEqual(admin_a.auth_version, 1)
            self.assertEqual(admin_b.auth_version, 1)
            self.assertTrue(admin_a.must_change_password)
            self.assertTrue(admin_b.must_change_password)
            self.assertTrue(
                password_hasher.verify(password_for_a, admin_a.password_hash)
            )
            self.assertTrue(
                password_hasher.verify(password_for_b, admin_b.password_hash)
            )
            self.assertEqual(
                request_for_a.status,
                PasswordResetRequestStatus.RESOLVED.value,
            )
            self.assertEqual(
                request_for_b.status,
                PasswordResetRequestStatus.RESOLVED.value,
            )

    def _insert_user(self, role: UserRole) -> int:
        with self.session_factory() as db:
            user = User(
                email=f"password-lifecycle-{uuid4().hex}@example.com",
                password_hash="test-hash-not-used-for-login",
                first_name="Concurrency",
                last_name="Test",
                role=role.value,
                is_active=True,
                must_change_password=False,
                auth_version=0,
                created_at=datetime(2026, 9, 17, 13, 0, 0),
                updated_at=datetime(2026, 9, 17, 13, 0, 0),
            )
            db.add(user)
            db.commit()
            self.user_ids.append(user.id)
            return user.id

    def _email(self, user_id: int) -> str:
        with self.session_factory() as db:
            user = db.get(User, user_id)
            assert user is not None
            return user.email


class MySqlPasswordLifecycleMigrationTests(unittest.TestCase):
    def test_upgrade_backfills_existing_user_without_changing_password(self) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")

        configured_admin_url = os.environ.get("MIGRATION_TEST_ADMIN_DATABASE_URL")
        configured_root_password = os.environ.get(
            "MIGRATION_TEST_MYSQL_ROOT_PASSWORD"
        )
        application_url = make_url(settings.database_url)
        if configured_admin_url is not None:
            management_url = make_url(configured_admin_url).set(database=None)
        elif configured_root_password is not None:
            management_url = URL.create(
                drivername=application_url.drivername,
                username="root",
                password=configured_root_password,
                host=application_url.host,
                port=application_url.port,
            )
        else:
            management_url = application_url.set(database=None)
        management_engine = create_engine(management_url, pool_pre_ping=True)
        database_name = f"pulsedesk_migration_{uuid4().hex}"
        database_created = False
        try:
            try:
                with management_engine.connect().execution_options(
                    isolation_level="AUTOCOMMIT"
                ) as connection:
                    connection.exec_driver_sql(f"CREATE DATABASE {database_name}")
                database_created = True
            except OperationalError:
                if (
                    configured_admin_url is not None
                    or configured_root_password is not None
                ):
                    raise
                self.skipTest(
                    "Configure an isolated-database MySQL test credential via "
                    "MIGRATION_TEST_ADMIN_DATABASE_URL or "
                    "MIGRATION_TEST_MYSQL_ROOT_PASSWORD."
                )

            migration_url = management_url.set(database=database_name)
            original_database_url = settings.database_url
            settings.database_url = migration_url.render_as_string(
                hide_password=False
            )
            migration_engine = None
            try:
                alembic_config = Config(
                    str(Path(__file__).resolve().parents[1] / "alembic.ini")
                )
                command.upgrade(alembic_config, "7c59f11d23e3")

                existing_password = "Migration-Password-Sentinel-593!"
                existing_hash = password_hasher.hash(existing_password)
                migration_engine = create_engine(migration_url, pool_pre_ping=True)
                with migration_engine.begin() as connection:
                    connection.exec_driver_sql(
                        "INSERT INTO users "
                        "(email, password_hash, first_name, last_name, role, "
                        "is_active, created_at, updated_at) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                        (
                            "migration-existing@example.com",
                            existing_hash,
                            "Migration",
                            "Existing",
                            UserRole.EMPLOYEE.value,
                            True,
                            datetime(2026, 9, 17, 10, 0, 0),
                            datetime(2026, 9, 17, 10, 0, 0),
                        ),
                    )

                command.upgrade(alembic_config, "4a8e2f6c91bd")

                with migration_engine.connect() as connection:
                    row = connection.exec_driver_sql(
                        "SELECT id, password_hash, must_change_password, "
                        "auth_version FROM users "
                        "WHERE email = %s",
                        ("migration-existing@example.com",),
                    ).mappings().one()
                self.assertEqual(row["password_hash"], existing_hash)
                self.assertFalse(row["must_change_password"])
                self.assertEqual(row["auth_version"], 0)

                token_manager = AccessTokenManager(
                    secret="migration-test-secret-long-enough-for-hs256",
                    algorithm="HS256",
                    access_lifetime=timedelta(minutes=30),
                    password_change_lifetime=timedelta(minutes=10),
                )
                factory = sessionmaker(
                    bind=migration_engine,
                    autoflush=False,
                    expire_on_commit=False,
                )
                with factory() as db:
                    response = AuthenticationService(
                        db,
                        UserRepository(db),
                        password_hasher,
                        token_manager,
                    ).login(
                        LoginRequest(
                            email="migration-existing@example.com",
                            password=existing_password,
                        )
                    )
                self.assertEqual(response.session_type, SessionType.NORMAL)
                self.assertNotIn(existing_password, response.model_dump_json())
                self.assertNotIn(existing_hash, response.model_dump_json())
            finally:
                settings.database_url = original_database_url
                if migration_engine is not None:
                    migration_engine.dispose()
        finally:
            if database_created:
                with management_engine.connect().execution_options(
                    isolation_level="AUTOCOMMIT"
                ) as connection:
                    connection.exec_driver_sql(f"DROP DATABASE {database_name}")
            management_engine.dispose()


if __name__ == "__main__":
    unittest.main()
