import asyncio
import json
import unittest
from datetime import datetime, timedelta
from unittest.mock import Mock, patch

from pydantic import ValidationError
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401 - registers mapped tables
from app.core.security import password_hasher
from app.database.base import Base
from app.dependencies.services import access_token_manager
from app.exceptions.auth import AuthenticationError, AuthorizationError
from app.exceptions.ticket import InvalidTicketAssigneeError
from app.exceptions.user import (
    LastActiveAdminRequiredError,
    UserAlreadyExistsError,
    UserNotFoundError,
    UserSelfDeactivationForbiddenError,
)
from app.exceptions.handlers import register_exception_handlers
from app.models.user import User, UserRole
from app.models.category import Category
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.repositories.category import CategoryRepository
from app.repositories.ticket import TicketRepository
from app.repositories.user import UserRepository
from app.schemas.user import (
    AdminUserDirectoryListResponse,
    UserActivationUpdate,
    UserDirectoryFilters,
    UserDirectoryListResponse,
    UserProvisionRequest,
)
from app.services.auth import AuthenticationService
from app.services.ticket import TicketService
from app.services.ticket_event import TicketEventRecorder
from app.services.user import UserService


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT,
    _compiler: object,
    **_kwargs: object,
) -> str:
    return "INTEGER"


class UserAdministrationServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine,
            autoflush=False,
            expire_on_commit=False,
        )
        self.now = datetime(2026, 9, 17, 8, 0, 0)
        self._seed_users()

    def tearDown(self) -> None:
        self.engine.dispose()

    def test_admin_directory_is_admin_only_and_does_not_broaden_operational_projection(
        self,
    ) -> None:
        with self.session_factory() as db:
            service = self._service(db)
            filters = UserDirectoryFilters()
            admin_response = service.list_admin_users(filters, self._get(db, 1))
            operational = service.list_users(filters, self._get(db, 2))
            with self.assertRaises(AuthorizationError):
                service.list_admin_users(filters, self._get(db, 2))
            with self.assertRaises(AuthorizationError):
                service.list_admin_users(filters, self._get(db, 3))

        self.assertEqual(
            [item.email for item in admin_response.items],
            [
                "admin@example.com",
                "ada@example.com",
                "zoe@example.com",
                "eli@example.com",
            ],
        )
        admin_payload = AdminUserDirectoryListResponse.model_validate(
            admin_response
        ).model_dump()
        self.assertNotIn("password", str(admin_payload))
        self.assertNotIn("password_hash", str(admin_payload))
        operational_payload = UserDirectoryListResponse.model_validate(
            operational
        ).model_dump()
        self.assertNotIn("email", operational_payload["items"][0])

    def test_admin_directory_filters_and_paginates_with_stable_order(self) -> None:
        with self.session_factory() as db:
            service = self._service(db)
            result = service.list_admin_users(
                UserDirectoryFilters(role=UserRole.AGENT, page=1, page_size=1),
                self._get(db, 1),
            )
            inactive = service.list_admin_users(
                UserDirectoryFilters(is_active=False),
                self._get(db, 1),
            )

        self.assertEqual(result.items[0].first_name, "Ada")
        self.assertEqual(result.total, 2)
        self.assertEqual(result.total_pages, 2)
        self.assertEqual(
            [item.email for item in inactive.items],
            ["inactive@example.com"],
        )
        with self.assertRaises(ValidationError):
            UserDirectoryFilters(page_size=101)

    def test_provisioning_supports_all_roles_hashes_passwords(self) -> None:
        for index, role in enumerate(UserRole, start=10):
            with self.session_factory() as db:
                created = self._service(db).create_user(
                    UserProvisionRequest(
                        email=f"new{index}@example.com",
                        first_name="New",
                        last_name=role.value.title(),
                        role=role,
                        password="secure-passphrase",
                    )
                )
                self.assertTrue(created.is_active)
                self.assertNotEqual(created.password_hash, "secure-passphrase")
                self.assertTrue(
                    password_hasher.verify(
                        "secure-passphrase",
                        created.password_hash,
                    )
                )

        with self.session_factory() as db:
            with self.assertRaises(UserAlreadyExistsError):
                self._service(db).create_user(
                    UserProvisionRequest(
                        email="ada@example.com",
                        first_name="Duplicate",
                        last_name="Agent",
                        role=UserRole.AGENT,
                        password="secure-passphrase",
                    )
                )

        with self.assertRaises(ValidationError):
            UserProvisionRequest(
                email="not-an-email",
                first_name="",
                last_name="User",
                role=UserRole.EMPLOYEE,
                password="short",
            )

    def test_activation_handles_transition_noop_missing_target_and_reactivation(
        self,
    ) -> None:
        with self.session_factory() as db:
            service = self._service(db)
            before = self._get(db, 2).updated_at
            noop = service.update_activation(
                2,
                UserActivationUpdate(is_active=True),
                self._get(db, 1),
            )
            self.assertEqual(noop.updated_at, before)

        changed_time = self.now + timedelta(hours=1)
        with self.session_factory() as db, patch(
            "app.services.user.utc_now_naive",
            return_value=changed_time,
        ):
            service = self._service(db)
            deactivated = service.update_activation(
                2,
                UserActivationUpdate(is_active=False),
                self._get(db, 1),
            )
            self.assertFalse(deactivated.is_active)
            self.assertEqual(deactivated.updated_at, changed_time)

        with self.session_factory() as db:
            service = self._service(db)
            reactivated = service.update_activation(
                2,
                UserActivationUpdate(is_active=True),
                self._get(db, 1),
            )
            self.assertTrue(reactivated.is_active)
            with self.assertRaises(UserNotFoundError):
                service.update_activation(
                    999,
                    UserActivationUpdate(is_active=False),
                    self._get(db, 1),
                )

    def test_activation_rejects_non_admin_and_self_deactivation(self) -> None:
        with self.session_factory() as db:
            service = self._service(db)
            with self.assertRaises(AuthorizationError):
                service.update_activation(
                    3,
                    UserActivationUpdate(is_active=False),
                    self._get(db, 3),
                )
            with self.assertRaises(UserSelfDeactivationForbiddenError):
                service.update_activation(
                    1,
                    UserActivationUpdate(is_active=False),
                    self._get(db, 1),
                )

    def test_deactivated_user_existing_token_fails_on_next_authentication(self) -> None:
        token = access_token_manager.create(2)
        with self.session_factory() as db:
            authentication = AuthenticationService(
                UserRepository(db),
                password_hasher,
                access_token_manager,
            )
            self.assertEqual(authentication.authenticate_access_token(token).id, 2)
            self._service(db).update_activation(
                2,
                UserActivationUpdate(is_active=False),
                self._get(db, 1),
            )
        with self.session_factory() as db:
            authentication = AuthenticationService(
                UserRepository(db),
                password_hasher,
                access_token_manager,
            )
            with self.assertRaises(AuthenticationError):
                authentication.authenticate_access_token(token)

    def test_agent_deactivation_preserves_existing_assignment_and_blocks_new_assignment(
        self,
    ) -> None:
        with self.session_factory() as db:
            db.add(
                Category(
                    id=10,
                    name="Hardware",
                    description=None,
                    is_active=True,
                    created_at=self.now,
                    updated_at=self.now,
                )
            )
            db.add(
                Ticket(
                    id=20,
                    ticket_number="TKT-ADMIN-TEST",
                    title="Assigned work",
                    description="Existing assignment must remain visible.",
                    status=TicketStatus.OPEN.value,
                    priority=TicketPriority.MEDIUM.value,
                    category_id=10,
                    created_by_id=3,
                    assigned_to_id=2,
                    created_at=self.now,
                    updated_at=self.now,
                    resolved_at=None,
                    closed_at=None,
                )
            )
            db.commit()
            admin = self._get(db, 1)
            self._service(db).update_activation(
                2,
                UserActivationUpdate(is_active=False),
                admin,
            )

            ticket = TicketRepository(db).get_visible_by_id(20, created_by_id=None)
            assert ticket is not None
            self.assertEqual(ticket.assigned_to_id, 2)
            self.assertEqual(ticket.assignee.first_name, "Ada")

            ticket_service = TicketService(
                db=db,
                ticket_repository=TicketRepository(db),
                category_repository=CategoryRepository(db),
                user_repository=UserRepository(db),
                ticket_event_recorder=Mock(spec=TicketEventRecorder),
            )
            with self.assertRaises(InvalidTicketAssigneeError):
                ticket_service.update_assignment(20, 2, admin)

    def _service(self, db: Session) -> UserService:
        return UserService(db, UserRepository(db), password_hasher)

    @staticmethod
    def _get(db: Session, user_id: int) -> User:
        user = db.get(User, user_id)
        assert user is not None
        return user

    def _seed_users(self) -> None:
        with self.session_factory() as db:
            db.add_all(
                [
                    self._user(1, "admin@example.com", "Amir", "Admin", UserRole.ADMIN, True),
                    self._user(2, "ada@example.com", "Ada", "Agent", UserRole.AGENT, True),
                    self._user(3, "eli@example.com", "Eli", "Employee", UserRole.EMPLOYEE, True),
                    self._user(4, "inactive@example.com", "Inez", "Inactive", UserRole.AGENT, False),
                    self._user(5, "zoe@example.com", "Zoe", "Agent", UserRole.AGENT, True),
                ]
            )
            db.commit()

    def _user(
        self,
        user_id: int,
        email: str,
        first_name: str,
        last_name: str,
        role: UserRole,
        active: bool,
    ) -> User:
        return User(
            id=user_id,
            email=email,
            password_hash=password_hasher.hash("password-123"),
            first_name=first_name,
            last_name=last_name,
            role=role.value,
            is_active=active,
            created_at=self.now,
            updated_at=self.now,
        )


class UserActivationInvariantTests(unittest.TestCase):
    def test_provisioning_rolls_back_when_hashing_fails(self) -> None:
        db = Mock()
        repository = Mock()
        repository.get_by_email.return_value = None
        hasher = Mock()
        hasher.hash.side_effect = RuntimeError("hashing failed")
        service = UserService(db, repository, hasher)

        with self.assertRaises(RuntimeError):
            service.create_user(
                UserProvisionRequest(
                    email="new@example.com",
                    first_name="New",
                    last_name="User",
                    role=UserRole.EMPLOYEE,
                    password="secure-passphrase",
                )
            )

        db.rollback.assert_called_once_with()
        repository.create.assert_not_called()

    def test_activation_schema_rejects_missing_null_and_extra_fields(self) -> None:
        for payload in (
            {},
            {"is_active": None},
            {"is_active": "false"},
            {"is_active": "true"},
            {"is_active": 0},
            {"is_active": 1},
            {"is_active": True, "role": "ADMIN"},
        ):
            with self.assertRaises(ValidationError):
                UserActivationUpdate.model_validate(payload)

        self.assertIs(
            UserActivationUpdate.model_validate({"is_active": True}).is_active,
            True,
        )
        self.assertIs(
            UserActivationUpdate.model_validate({"is_active": False}).is_active,
            False,
        )

    def test_activation_http_contract_returns_422_for_non_boolean_json(self) -> None:
        app = FastAPI()
        register_exception_handlers(app)

        @app.patch("/activation")
        def validate_activation(data: UserActivationUpdate) -> UserActivationUpdate:
            return data

        for value in ("false", "true", 0, 1, None):
            status, body = asyncio.run(
                self._asgi_json_request(app, {"is_active": value})
            )
            self.assertEqual(status, 422)
            self.assertEqual(body["code"], "VALIDATION_ERROR")

        for value in (True, False):
            status, body = asyncio.run(
                self._asgi_json_request(app, {"is_active": value})
            )
            self.assertEqual(status, 200)
            self.assertIs(body["is_active"], value)

    @staticmethod
    async def _asgi_json_request(
        app: FastAPI,
        payload: dict[str, object],
    ) -> tuple[int, dict[str, object]]:
        request_sent = False
        response_status = 0
        response_body = bytearray()

        async def receive() -> dict[str, object]:
            nonlocal request_sent
            if request_sent:
                return {"type": "http.disconnect"}
            request_sent = True
            return {
                "type": "http.request",
                "body": json.dumps(payload).encode(),
                "more_body": False,
            }

        async def send(message: dict[str, object]) -> None:
            nonlocal response_status
            if message["type"] == "http.response.start":
                response_status = int(message["status"])
            elif message["type"] == "http.response.body":
                response_body.extend(message.get("body", b""))

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "PATCH",
                "scheme": "http",
                "path": "/activation",
                "raw_path": b"/activation",
                "query_string": b"",
                "headers": [(b"content-type", b"application/json")],
                "client": ("test", 123),
                "server": ("test", 80),
            },
            receive,
            send,
        )
        return response_status, json.loads(response_body)

    def test_self_deactivation_is_rejected_after_admin_rows_are_locked(self) -> None:
        actor = Mock(id=7, role=UserRole.ADMIN.value, is_active=True)
        repository = Mock()
        repository.get_by_id.return_value = actor
        repository.lock_active_admins.return_value = [actor]
        db = Mock()
        service = UserService(db, repository, Mock())

        with self.assertRaises(UserSelfDeactivationForbiddenError):
            service.update_activation(7, UserActivationUpdate(is_active=False), actor)

        repository.lock_active_admins.assert_called_once_with()
        repository.save.assert_not_called()
        db.rollback.assert_called_once_with()

    def test_last_active_admin_survives_concurrent_cross_deactivation(self) -> None:
        actor = Mock(id=8, role=UserRole.ADMIN.value, is_active=True)
        target = Mock(id=7, role=UserRole.ADMIN.value, is_active=True)
        repository = Mock()
        repository.get_by_id.return_value = target
        # This is the second cross-deactivation transaction after the first
        # commits: the lock query can now return only the target admin.
        repository.lock_active_admins.return_value = [target]
        db = Mock()
        service = UserService(db, repository, Mock())

        with self.assertRaises(LastActiveAdminRequiredError):
            service.update_activation(7, UserActivationUpdate(is_active=False), actor)

        repository.save.assert_not_called()
        db.rollback.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
