from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.repositories.exceptions import (
    DuplicateUserEmailError,
    is_mysql_duplicate_constraint,
)


USER_EMAIL_UNIQUE_CONSTRAINT = "uq_users_email"


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        statement = select(User).where(User.id == user_id)
        return self.db.scalar(statement)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return self.db.scalar(statement)

    def admin_exists(self) -> bool:
        statement = select(User.id).where(User.role == UserRole.ADMIN).limit(1)
        return self.db.scalar(statement) is not None

    def create(self, user: User) -> User:
        self.db.add(user)
        try:
            self.db.flush()
        except IntegrityError as error:
            if is_mysql_duplicate_constraint(error, USER_EMAIL_UNIQUE_CONSTRAINT):
                raise DuplicateUserEmailError from error
            raise

        self.db.refresh(user)
        return user
