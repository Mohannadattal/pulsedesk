from sqlalchemy.orm import Session

from app.core.security import PasswordHasher
from app.exceptions.user import (
    UserAlreadyExistsError,
    UserNotFoundError,
)
from app.models.user import User
from app.repositories.exceptions import DuplicateUserEmailError
from app.repositories.user import UserRepository
from app.schemas.user import UserCreate


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

    def create_user(self, data: UserCreate) -> User:
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
