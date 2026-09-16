from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

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

    def get_display_references_by_ids(self, user_ids: set[int]) -> list[User]:
        """Resolve historical display references, including inactive users."""
        if not user_ids:
            return []
        statement = (
            select(User)
            .options(load_only(User.id, User.first_name, User.last_name))
            .where(User.id.in_(user_ids))
        )
        return list(self.db.scalars(statement).all())

    def get_by_email(self, email: str) -> User | None:
        statement = select(User).where(User.email == email)
        return self.db.scalar(statement)

    def admin_exists(self) -> bool:
        statement = select(User.id).where(User.role == UserRole.ADMIN).limit(1)
        return self.db.scalar(statement) is not None

    def list(
        self,
        *,
        role: UserRole | None,
        is_active: bool,
        page: int,
        page_size: int,
    ) -> tuple[list[User], int]:
        conditions = [User.is_active.is_(is_active)]
        if role is not None:
            conditions.append(User.role == role.value)

        count_statement = select(func.count()).select_from(User).where(*conditions)
        total = self.db.scalar(count_statement) or 0

        statement = (
            select(User)
            .where(*conditions)
            .order_by(User.last_name.asc(), User.first_name.asc(), User.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        users = list(self.db.scalars(statement).all())
        return users, total

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
