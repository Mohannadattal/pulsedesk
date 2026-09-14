from sqlalchemy.orm import Session

from app.core.security import PasswordHasher
from app.exceptions.auth import AuthorizationError
from app.exceptions.user import (
    InitialAdminAlreadyExistsError,
    UserAlreadyExistsError,
    UserNotFoundError,
)
from app.models.user import User, UserRole
from app.repositories.exceptions import DuplicateUserEmailError
from app.repositories.user import UserRepository
from app.schemas.user import (
    InitialAdminCreate,
    UserDirectoryFilters,
    UserDirectoryListResponse,
    UserProvisionRequest,
)


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
        return self._create_and_commit(data)

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
        return self._create_and_commit(provision_request)

    def _create_and_commit(self, data: UserProvisionRequest) -> User:
        try:
            existing_user = self.user_repository.get_by_email(data.email)

            if existing_user is not None:
                raise UserAlreadyExistsError(data.email)

            user = User(
                email=data.email,
                password_hash=self.password_hasher.hash(data.password),
                first_name=data.first_name,
                last_name=data.last_name,
                role=data.role,
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
