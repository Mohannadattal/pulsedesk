from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.category import Category
from app.repositories.exceptions import (
    DuplicateCategoryNameError,
    is_mysql_duplicate_constraint,
)


CATEGORY_NAME_UNIQUE_CONSTRAINT = "uq_categories_name"


class CategoryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, category_id: int) -> Category | None:
        return self.db.get(Category, category_id)

    def get_by_id_for_update(self, category_id: int) -> Category | None:
        statement = (
            select(Category)
            .where(Category.id == category_id)
            .with_for_update()
        )
        return self.db.scalar(statement)

    def get_by_name(self, name: str) -> Category | None:
        statement = select(Category).where(Category.name == name)
        return self.db.scalar(statement)

    def list(self, *, include_inactive: bool) -> list[Category]:
        statement = select(Category)
        if not include_inactive:
            statement = statement.where(Category.is_active.is_(True))
        statement = statement.order_by(Category.name.asc(), Category.id.asc())
        return list(self.db.scalars(statement).all())

    def save(self, category: Category) -> Category:
        self.db.add(category)
        try:
            self.db.flush()
        except IntegrityError as error:
            if is_mysql_duplicate_constraint(
                error,
                CATEGORY_NAME_UNIQUE_CONSTRAINT,
            ):
                raise DuplicateCategoryNameError from error
            raise

        self.db.refresh(category)
        return category
