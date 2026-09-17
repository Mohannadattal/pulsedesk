from sqlalchemy.orm import Session

from app.core.security import PasswordHasher
from app.exceptions.auth import AuthorizationError
from app.exceptions.user import (
    InitialAdminAlreadyExistsError,
    LastActiveAdminRequiredError,
    UserAlreadyExistsError,
    UserNotFoundError,
    UserSelfDeactivationForbiddenError,
)
from app.models.user import User, UserRole
from app.repositories.exceptions import DuplicateUserEmailError
from app.repositories.user import UserRepository
from app.schemas.user import (
    AdminUserDirectoryListResponse,
    InitialAdminCreate,
    UserActivationUpdate,
    UserDirectoryFilters,
    UserDirectoryListResponse,
    UserProvisionRequest,
)
from app.utils.time import utc_now_naive


class UserService:
    def __init__(
        self,
        db: Session,
        user_repository: UserRepository,
        password_hasher: PasswordHasher,
    ) -> None:
        self.db = db
        self.user_repository = user_repository
        self.password_hasher = password_hasher

    def create_user(self, data: UserProvisionRequest) -> User:
        return self._create_and_commit(data, must_change_password=True)

    def list_users(
        self,
        filters: UserDirectoryFilters,
        actor: User,
    ) -> UserDirectoryListResponse:
        if actor.role not in {UserRole.AGENT.value, UserRole.ADMIN.value}:
            raise AuthorizationError

        users, total = self.user_repository.list(
            role=filters.role,
            is_active=filters.is_active,
            page=filters.page,
            page_size=filters.page_size,
        )
        return UserDirectoryListResponse(
            items=users,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def list_admin_users(
        self,
        filters: UserDirectoryFilters,
        actor: User,
    ) -> AdminUserDirectoryListResponse:
        self._require_admin(actor)
        users, total = self.user_repository.list(
            role=filters.role,
            is_active=filters.is_active,
            page=filters.page,
            page_size=filters.page_size,
        )
        return AdminUserDirectoryListResponse(
            items=users,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def update_activation(
        self,
        user_id: int,
        data: UserActivationUpdate,
        actor: User,
    ) -> User:
        self._require_admin(actor)
        try:
            target_snapshot = self.user_repository.get_by_id(user_id)
            if target_snapshot is None:
                raise UserNotFoundError(user_id)

            deactivating_active_admin = (
                not data.is_active
                and target_snapshot.is_active
                and target_snapshot.role == UserRole.ADMIN.value
            )
            if deactivating_active_admin:
                active_admins = self.user_repository.lock_active_admins()
                locked_by_id = {user.id: user for user in active_admins}
                if user_id == actor.id:
                    raise UserSelfDeactivationForbiddenError

                target = locked_by_id.get(user_id)
                if target is not None and len(active_admins) == 1:
                    raise LastActiveAdminRequiredError

                locked_actor = locked_by_id.get(actor.id)
                if locked_actor is None or not locked_actor.is_active:
                    raise AuthorizationError

                if target is None:
                    target = self.user_repository.get_by_id_for_update(user_id)
                    if target is None:
                        raise UserNotFoundError(user_id)
            else:
                locked_users = self.user_repository.lock_by_ids({actor.id, user_id})
                locked_by_id = {user.id: user for user in locked_users}
                locked_actor = locked_by_id.get(actor.id)
                if (
                    locked_actor is None
                    or not locked_actor.is_active
                    or locked_actor.role != UserRole.ADMIN.value
                ):
                    raise AuthorizationError
                target = locked_by_id.get(user_id)
                if target is None:
                    raise UserNotFoundError(user_id)

            if target.is_active == data.is_active:
                self.db.commit()
                return target

            target.is_active = data.is_active
            if not data.is_active:
                target.auth_version += 1
            target.updated_at = utc_now_naive()
            target = self.user_repository.save(target)
            self.db.commit()
            return target
        except Exception:
            self.db.rollback()
            raise

    def bootstrap_initial_admin(self, data: InitialAdminCreate) -> User:
        try:
            admin_exists = self.user_repository.admin_exists()
        except Exception:
            self.db.rollback()
            raise

        if admin_exists:
            self.db.rollback()
            raise InitialAdminAlreadyExistsError

        provision_request = UserProvisionRequest(
            **data.model_dump(),
            role=UserRole.ADMIN,
        )
        return self._create_and_commit(
            provision_request,
            must_change_password=False,
        )

    def _create_and_commit(
        self,
        data: UserProvisionRequest,
        *,
        must_change_password: bool,
    ) -> User:
        try:
            existing_user = self.user_repository.get_by_email(data.email)

            if existing_user is not None:
                raise UserAlreadyExistsError(data.email)

            now = utc_now_naive()
            user = User(
                email=data.email,
                password_hash=self.password_hasher.hash(
                    data.password.get_secret_value()
                ),
                first_name=data.first_name,
                last_name=data.last_name,
                role=data.role,
                must_change_password=must_change_password,
                auth_version=0,
                created_at=now,
                updated_at=now,
            )

            created_user = self.user_repository.create(user)
            self.db.commit()
            return created_user
        except DuplicateUserEmailError as error:
            self.db.rollback()
            raise UserAlreadyExistsError(data.email) from error
        except Exception:
            self.db.rollback()
            raise

    def get_user(self, user_id: int) -> User:
        user = self.user_repository.get_by_id(user_id)

        if user is None:
            raise UserNotFoundError(user_id)

        return user

    @staticmethod
    def _require_admin(actor: User) -> None:
        if actor.role != UserRole.ADMIN.value:
            raise AuthorizationError
