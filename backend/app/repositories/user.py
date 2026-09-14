import re

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User
from app.repositories.exceptions import DuplicateUserEmailError


MYSQL_DUPLICATE_ENTRY_ERROR_CODE = 1062
USER_EMAIL_UNIQUE_CONSTRAINT = "uq_users_email"


def _is_duplicate_user_email_error(error: IntegrityError) -> bool:
    original_error_arguments = getattr(error.orig, "args", ())
    if (
        len(original_error_arguments) < 2
        or original_error_arguments[0] != MYSQL_DUPLICATE_ENTRY_ERROR_CODE
    ):
        return False

    message = str(original_error_arguments[1])
    constraint_pattern = (
        rf"for key ['`](?:[^'`]+\.)?{re.escape(USER_EMAIL_UNIQUE_CONSTRAINT)}['`]"
    )
    return re.search(constraint_pattern, message) is not None


class UserRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        statement = select(User).where(User.id == user_id)
        return self.db.scalar(statement)

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return self.db.scalar(statement)

    def create(self, user: User) -> User:
        self.db.add(user)
        try:
            self.db.flush()
        except IntegrityError as error:
            if _is_duplicate_user_email_error(error):
                raise DuplicateUserEmailError from error
            raise

        self.db.refresh(user)
        return user
