import asyncio
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock

import jwt
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - registers all mapped tables
from app.dependencies.database import get_db
from app.main import app as application
from app.core.security import AccessTokenManager, TokenPurpose, password_hasher
from app.database.base import Base
from app.dependencies.auth import get_current_user, get_password_change_user
from app.exceptions.auth import (
    AuthenticationError,
    AuthorizationError,
    PasswordConfirmationMismatchError,
    PasswordReuseError,
)
from app.exceptions.password_reset_request import (
    PasswordResetRequestResolvedError,
    PasswordResetTargetInactiveError,
)
from app.models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from app.models.user import User, UserRole
from app.repositories.exceptions import (
    DuplicatePendingPasswordResetRequestError,
)
from app.repositories.password_reset_request import (
    PasswordResetRequestRepository,
)
from app.repositories.user import UserRepository
from app.schemas.auth import (
    CompletePasswordChangeRequest,
    LoginRequest,
    PasswordResetRequestCreate,
    SessionType,
)
from app.schemas.password_reset_request import (
    AdminResetPasswordRequest,
    PasswordResetRequestFilters,
)
from app.schemas.user import InitialAdminCreate
from app.schemas.user import UserProvisionRequest
from app.services.auth import AuthenticationService
from app.services.password_reset_request import PasswordResetService
from app.services.user import UserService


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT,
    _compiler: object,
    **_kwargs: object,
) -> str:
    return "INTEGER"


class PasswordLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.normal_hash = password_hasher.hash("normal-password")
        cls.temporary_hash = password_hasher.hash("temporary-password")

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
        self.now = datetime(2026, 9, 17, 12, 0, 0)
        self.token_manager = AccessTokenManager(
            secret="test-secret-that-is-long-enough-for-hs256",
            algorithm="HS256",
            access_lifetime=timedelta(minutes=30),
            password_change_lifetime=timedelta(minutes=10),
        )
        with self.session_factory() as db:
            db.add_all(
                [
                    self._user(
                        1,
                        "admin@example.com",
                        UserRole.ADMIN,
                        self.normal_hash,
                    ),
                    self._user(
                        2,
                        "normal@example.com",
                        UserRole.AGENT,
                        self.normal_hash,
                    ),
                    self._user(
                        3,
                        "temporary@example.com",
                        UserRole.EMPLOYEE,
                        self.temporary_hash,
                        must_change_password=True,
                    ),
                    self._user(
                        4,
                        "inactive@example.com",
                        UserRole.EMPLOYEE,
                        self.normal_hash,
                        is_active=False,
                    ),
                ]
            )
            db.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_login_issues_purpose_version_and_indistinguishable_failures(self) -> None:
        with self.session_factory() as db:
            service = self._auth_service(db)
            normal = service.login(
                LoginRequest(
                    email="normal@example.com",
                    password="normal-password",
                )
            )
            restricted = service.login(
                LoginRequest(
                    email="temporary@example.com",
                    password="temporary-password",
                )
            )

            self.assertEqual(normal.session_type, SessionType.NORMAL)
            self.assertEqual(
                restricted.session_type, SessionType.PASSWORD_CHANGE_REQUIRED
            )
            self.assertEqual(
                self.token_manager.decode(normal.access_token).purpose,
                TokenPurpose.ACCESS,
            )
            self.assertEqual(
                self.token_manager.decode(restricted.access_token).purpose,
                TokenPurpose.PASSWORD_CHANGE,
            )
            self.assertNotIn("auth_version", normal.model_dump()["user"])
            self.assertNotIn("password", str(normal.model_dump()["user"]))

            failures = (
                LoginRequest(email="missing@example.com", password="anything"),
                LoginRequest(email="normal@example.com", password="wrong"),
                LoginRequest(
                    email="inactive@example.com",
                    password="normal-password",
                ),
            )
            for request in failures:
                with self.assertRaises(AuthenticationError):
                    service.login(request)

    def test_restricted_dependency_boundary_and_session_restoration(self) -> None:
        with self.session_factory() as db:
            service = self._auth_service(db)
            restricted_response = service.login(
                LoginRequest(
                    email="temporary@example.com",
                    password="temporary-password",
                )
            )
            restricted = service.authenticate_session(restricted_response.access_token)
            with self.assertRaises(AuthenticationError):
                get_current_user(restricted)
            self.assertEqual(get_password_change_user(restricted).user.id, 3)
            restored = service.restore_session(restricted)
            self.assertEqual(
                restored.session_type,
                SessionType.PASSWORD_CHANGE_REQUIRED,
            )

            normal_response = service.login(
                LoginRequest(
                    email="normal@example.com",
                    password="normal-password",
                )
            )
            normal = service.authenticate_session(normal_response.access_token)
            self.assertEqual(get_current_user(normal).id, 2)
            with self.assertRaises(AuthenticationError):
                get_password_change_user(normal)

    def test_restricted_http_session_can_only_access_auth_me(self) -> None:
        restricted_password = "Restricted-HTTP-Sentinel-927!"
        normal_password = "Normal-HTTP-Sentinel-314!"
        with self.session_factory() as db:
            restricted_user = db.get(User, 3)
            normal_user = db.get(User, 2)
            assert restricted_user is not None and normal_user is not None
            restricted_user.password_hash = password_hasher.hash(restricted_password)
            normal_user.password_hash = password_hasher.hash(normal_password)
            restricted_hash = restricted_user.password_hash
            normal_hash = normal_user.password_hash
            db.commit()

        def override_db():  # type: ignore[no-untyped-def]
            with self.session_factory() as db:
                yield db

        application.dependency_overrides[get_db] = override_db
        try:
            restricted_login = self._asgi_json_request(
                "POST",
                "/api/v1/auth/login",
                body={
                    "email": "temporary@example.com",
                    "password": restricted_password,
                },
            )
            self.assertEqual(restricted_login[0], 200)
            restricted_token = restricted_login[1]["access_token"]

            restricted_me = self._asgi_json_request(
                "GET",
                "/api/v1/auth/me",
                token=restricted_token,
            )
            self.assertEqual(restricted_me[0], 200)
            self.assertEqual(
                restricted_me[1]["session_type"],
                SessionType.PASSWORD_CHANGE_REQUIRED.value,
            )
            self.assertEqual(restricted_me[1]["user"]["id"], 3)

            with self.assertLogs("app.exceptions.handlers", level="INFO") as logs:
                restricted_categories = self._asgi_json_request(
                    "GET",
                    "/api/v1/categories",
                    token=restricted_token,
                )
            self.assertEqual(restricted_categories[0], 401)
            self.assertEqual(
                restricted_categories[1],
                {
                    "code": "AUTHENTICATION_FAILED",
                    "detail": "Could not validate credentials.",
                },
            )

            normal_login = self._asgi_json_request(
                "POST",
                "/api/v1/auth/login",
                body={
                    "email": "normal@example.com",
                    "password": normal_password,
                },
            )
            self.assertEqual(normal_login[0], 200)
            normal_categories = self._asgi_json_request(
                "GET",
                "/api/v1/categories",
                token=normal_login[1]["access_token"],
            )
            self.assertEqual(normal_categories, (200, []))

            application_output = json.dumps(
                [
                    restricted_login[1],
                    restricted_me[1],
                    restricted_categories[1],
                    normal_login[1],
                    normal_categories[1],
                    logs.output,
                ]
            )
            for secret in (
                restricted_password,
                normal_password,
                restricted_hash,
                normal_hash,
            ):
                self.assertNotIn(secret, application_output)
        finally:
            application.dependency_overrides.pop(get_db, None)

    def test_mandatory_replacement_invalidates_restricted_token(self) -> None:
        with self.session_factory() as db:
            service = self._auth_service(db)
            login = service.login(
                LoginRequest(
                    email="temporary@example.com",
                    password="temporary-password",
                )
            )
            restricted = service.authenticate_session(login.access_token)
            completed = service.complete_password_change(
                CompletePasswordChangeRequest(
                    new_password="replacement-password",
                    confirm_new_password="replacement-password",
                ),
                restricted,
            )

            self.assertEqual(completed.session_type, SessionType.NORMAL)
            changed = db.get(User, 3)
            assert changed is not None
            self.assertFalse(changed.must_change_password)
            self.assertEqual(changed.auth_version, 1)
            self.assertTrue(
                password_hasher.verify(
                    "replacement-password",
                    changed.password_hash,
                )
            )
            with self.assertRaises(AuthenticationError):
                service.authenticate_session(login.access_token)
            self.assertEqual(
                get_current_user(
                    service.authenticate_session(completed.access_token)
                ).id,
                3,
            )
            with self.assertRaises(AuthenticationError):
                service.complete_password_change(
                    CompletePasswordChangeRequest(
                        new_password="another-password",
                        confirm_new_password="another-password",
                    ),
                    restricted,
                )

    def test_mandatory_replacement_rejects_confirmation_reuse_and_policy(self) -> None:
        with self.session_factory() as db:
            service = self._auth_service(db)
            login = service.login(
                LoginRequest(
                    email="temporary@example.com",
                    password="temporary-password",
                )
            )
            restricted = service.authenticate_session(login.access_token)
            with self.assertRaises(PasswordConfirmationMismatchError):
                service.complete_password_change(
                    CompletePasswordChangeRequest(
                        new_password="replacement-password",
                        confirm_new_password="different-password",
                    ),
                    restricted,
                )
            with self.assertRaises(PasswordReuseError):
                service.complete_password_change(
                    CompletePasswordChangeRequest(
                        new_password="temporary-password",
                        confirm_new_password="temporary-password",
                    ),
                    restricted,
                )
            with self.assertRaises(ValidationError):
                CompletePasswordChangeRequest(
                    new_password="short",
                    confirm_new_password="short",
                )

    def test_shared_password_policy_preserves_secret_values_and_bounds(self) -> None:
        sentinel = "Shared-Policy-Sentinel-864!"
        models = (
            UserProvisionRequest(
                email="policy@example.com",
                password=sentinel,
                first_name="Policy",
                last_name="Test",
                role=UserRole.EMPLOYEE,
            ),
            CompletePasswordChangeRequest(
                new_password=sentinel,
                confirm_new_password=sentinel,
            ),
            AdminResetPasswordRequest(
                temporary_password=sentinel,
                confirm_temporary_password=sentinel,
            ),
        )
        for model in models:
            self.assertNotIn(sentinel, str(model))
            self.assertNotIn(sentinel, model.model_dump_json())

        rejected_sentinel = "S3nt!7"
        with self.assertRaises(ValidationError) as error:
            UserProvisionRequest(
                email="short@example.com",
                password=rejected_sentinel,
                first_name="Policy",
                last_name="Test",
                role=UserRole.EMPLOYEE,
            )
        self.assertNotIn(rejected_sentinel, str(error.exception))
        self.assertNotIn(rejected_sentinel, repr(error.exception.errors()))
        with self.assertRaises(ValidationError):
            CompletePasswordChangeRequest(
                new_password="x" * 129,
                confirm_new_password="x" * 129,
            )
        with self.assertRaises(ValidationError):
            AdminResetPasswordRequest(
                temporary_password="12345678",
                confirm_temporary_password="1234567",
            )

    def test_tokens_without_required_claims_and_stale_versions_fail(self) -> None:
        old_token = jwt.encode(
            {"sub": "2", "exp": datetime.now() + timedelta(minutes=5)},
            "test-secret-that-is-long-enough-for-hs256",
            algorithm="HS256",
        )
        with self.session_factory() as db:
            service = self._auth_service(db)
            with self.assertRaises(AuthenticationError):
                service.authenticate_session(old_token)

            token = self.token_manager.create(
                2,
                purpose=TokenPurpose.ACCESS,
                auth_version=0,
            )
            user = db.get(User, 2)
            assert user is not None
            user.auth_version = 1
            db.commit()
            with self.assertRaises(AuthenticationError):
                service.authenticate_session(token)

    def test_bootstrap_administrator_starts_as_a_normal_account(self) -> None:
        engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(engine)
        factory = sessionmaker(
            bind=engine,
            autoflush=False,
            expire_on_commit=False,
        )
        try:
            with factory() as db:
                admin = UserService(
                    db,
                    UserRepository(db),
                    password_hasher,
                ).bootstrap_initial_admin(
                    InitialAdminCreate(
                        email="bootstrap@example.com",
                        password="bootstrap-password",
                        first_name="Bootstrap",
                        last_name="Admin",
                    )
                )
                self.assertFalse(admin.must_change_password)
                self.assertEqual(admin.auth_version, 0)
        finally:
            engine.dispose()

    def test_forgot_password_response_and_persistence_are_indistinguishable(
        self,
    ) -> None:
        with self.session_factory() as db:
            service = self._reset_service(db)
            responses = [
                service.request_reset(
                    PasswordResetRequestCreate(email="normal@example.com")
                ),
                service.request_reset(
                    PasswordResetRequestCreate(email="normal@example.com")
                ),
                service.request_reset(
                    PasswordResetRequestCreate(email="missing@example.com")
                ),
                service.request_reset(
                    PasswordResetRequestCreate(email="inactive@example.com")
                ),
            ]
            self.assertEqual(
                {response.model_dump_json() for response in responses},
                {
                    '{"detail":"If an account exists for this email, '
                    'a password reset request has been submitted."}'
                },
            )
            requests = list(db.scalars(select(PasswordResetRequest)).all())
            self.assertEqual(len(requests), 1)
            self.assertEqual(requests[0].user_id, 2)
            serialized = str(requests[0].__dict__)
            self.assertNotIn("normal@example.com", serialized)
            self.assertNotIn("password", serialized)

    def test_reset_request_database_constraints(self) -> None:
        with self.session_factory() as db:
            db.add(
                PasswordResetRequest(
                    user_id=2,
                    status=PasswordResetRequestStatus.PENDING.value,
                    requested_at=self.now,
                )
            )
            db.commit()
            db.add(
                PasswordResetRequest(
                    user_id=2,
                    status=PasswordResetRequestStatus.PENDING.value,
                    requested_at=self.now,
                )
            )
            with self.assertRaises(IntegrityError):
                db.commit()
            db.rollback()
            db.add(
                PasswordResetRequest(
                    user_id=3,
                    status=PasswordResetRequestStatus.RESOLVED.value,
                    requested_at=self.now,
                    resolved_at=None,
                    resolved_by_user_id=None,
                )
            )
            with self.assertRaises(IntegrityError):
                db.commit()

    def test_admin_lists_and_atomically_resets_pending_request(self) -> None:
        with self.session_factory() as db:
            reset_service = self._reset_service(db)
            reset_service.request_reset(
                PasswordResetRequestCreate(email="normal@example.com")
            )
            admin = db.get(User, 1)
            employee = db.get(User, 3)
            target = db.get(User, 2)
            assert admin is not None and employee is not None and target is not None
            old_token = self.token_manager.create(
                target.id,
                auth_version=target.auth_version,
            )
            listing = reset_service.list_requests(
                PasswordResetRequestFilters(),
                admin,
            )
            self.assertEqual(listing.total, 1)
            self.assertEqual(listing.items[0].user.email, "normal@example.com")
            with self.assertRaises(AuthorizationError):
                reset_service.list_requests(
                    PasswordResetRequestFilters(),
                    employee,
                )

            request_id = listing.items[0].id
            password_sentinel = "Admin-Reset-Sentinel-642!"
            resolved = reset_service.reset_password(
                request_id,
                AdminResetPasswordRequest(
                    temporary_password=password_sentinel,
                    confirm_temporary_password=password_sentinel,
                ),
                admin,
            )
            self.assertEqual(
                resolved.status,
                PasswordResetRequestStatus.RESOLVED,
            )
            self.assertEqual(resolved.resolved_by_user_id, admin.id)
            db.refresh(target)
            self.assertTrue(target.must_change_password)
            self.assertEqual(target.auth_version, 1)
            first_hash = target.password_hash
            self.assertTrue(
                password_hasher.verify(
                    password_sentinel,
                    target.password_hash,
                )
            )
            serialized_response = resolved.model_dump_json()
            self.assertNotIn(password_sentinel, serialized_response)
            self.assertNotIn(first_hash, serialized_response)
            with self.assertRaises(AuthenticationError):
                self._auth_service(db).authenticate_session(old_token)
            with self.assertRaises(PasswordResetRequestResolvedError) as error:
                reset_service.reset_password(
                    request_id,
                    AdminResetPasswordRequest(
                        temporary_password="second-admin-password",
                        confirm_temporary_password="second-admin-password",
                    ),
                    admin,
                )
            self.assertNotIn("second-admin-password", str(error.exception))
            self.assertNotIn(first_hash, str(error.exception))
            db.refresh(target)
            self.assertEqual(target.password_hash, first_hash)

    def test_admin_cannot_reset_an_inactive_target(self) -> None:
        with self.session_factory() as db:
            service = self._reset_service(db)
            service.request_reset(
                PasswordResetRequestCreate(email="normal@example.com")
            )
            request = db.scalar(select(PasswordResetRequest))
            target = db.get(User, 2)
            admin = db.get(User, 1)
            assert request is not None and target is not None and admin is not None
            target.is_active = False
            db.commit()
            with self.assertRaises(PasswordResetTargetInactiveError):
                service.reset_password(
                    request.id,
                    AdminResetPasswordRequest(
                        temporary_password="new-temporary-password",
                        confirm_temporary_password="new-temporary-password",
                    ),
                    admin,
                )

    def test_duplicate_race_is_rolled_back_but_other_failures_propagate(self) -> None:
        user = Mock(id=2, is_active=True)
        user_repository = Mock()
        user_repository.get_by_email.return_value = user
        repository = Mock()
        repository.pending_exists_for_user.return_value = False
        repository.create.side_effect = DuplicatePendingPasswordResetRequestError
        db = Mock()
        service = PasswordResetService(
            db,
            repository,
            user_repository,
            password_hasher,
        )
        response = service.request_reset(
            PasswordResetRequestCreate(email="normal@example.com")
        )
        self.assertIn("If an account exists", response.detail)
        db.rollback.assert_called_once_with()
        db.commit.assert_not_called()

        repository.create.side_effect = RuntimeError("database unavailable")
        db.reset_mock()
        with self.assertRaises(RuntimeError):
            service.request_reset(
                PasswordResetRequestCreate(email="normal@example.com")
            )
        db.rollback.assert_called_once_with()

    def _auth_service(self, db: Session) -> AuthenticationService:
        return AuthenticationService(
            db,
            UserRepository(db),
            password_hasher,
            self.token_manager,
        )

    @staticmethod
    def _asgi_json_request(
        method: str,
        path: str,
        *,
        body: dict[str, str] | None = None,
        token: str | None = None,
    ) -> tuple[int, object]:
        request_body = json.dumps(body).encode() if body is not None else b""
        headers = [(b"content-type", b"application/json")]
        if token is not None:
            headers.append((b"authorization", f"Bearer {token}".encode()))

        async def invoke() -> tuple[int, object]:
            request_sent = False
            messages: list[dict[str, object]] = []

            async def receive() -> dict[str, object]:
                nonlocal request_sent
                if not request_sent:
                    request_sent = True
                    return {
                        "type": "http.request",
                        "body": request_body,
                        "more_body": False,
                    }
                return {"type": "http.disconnect"}

            async def send(message: dict[str, object]) -> None:
                messages.append(message)

            await application(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": method,
                    "scheme": "http",
                    "path": path,
                    "raw_path": path.encode(),
                    "query_string": b"",
                    "root_path": "",
                    "headers": headers,
                    "client": ("testclient", 50000),
                    "server": ("testserver", 80),
                    "state": {},
                },
                receive,
                send,
            )
            start = next(message for message in messages if message["type"] == "http.response.start")
            response_body = b"".join(
                message.get("body", b"")
                for message in messages
                if message["type"] == "http.response.body"
            )
            return int(start["status"]), json.loads(response_body)

        return asyncio.run(invoke())

    def _reset_service(self, db: Session) -> PasswordResetService:
        return PasswordResetService(
            db,
            PasswordResetRequestRepository(db),
            UserRepository(db),
            password_hasher,
        )

    def _user(
        self,
        user_id: int,
        email: str,
        role: UserRole,
        password_hash: str,
        *,
        must_change_password: bool = False,
        is_active: bool = True,
    ) -> User:
        return User(
            id=user_id,
            email=email,
            password_hash=password_hash,
            first_name=f"User{user_id}",
            last_name="Test",
            role=role.value,
            is_active=is_active,
            must_change_password=must_change_password,
            auth_version=0,
            created_at=self.now,
            updated_at=self.now,
        )


if __name__ == "__main__":
    unittest.main()
