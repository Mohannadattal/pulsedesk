from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.exceptions.auth import AuthorizationError
from app.exceptions.category import (
    CategoryAlreadyExistsError,
    CategoryNotFoundError,
)
from app.models.category import Category
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.exceptions import DuplicateCategoryNameError
from app.schemas.category import CategoryCreate, CategoryUpdate


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class CategoryService:
    def __init__(self, db: Session, category_repository: CategoryRepository) -> None:
        self.db = db
        self.category_repository = category_repository

    def create_category(self, data: CategoryCreate, actor: User) -> Category:
        self._require_admin(actor)
        try:
            if self.category_repository.get_by_name(data.name) is not None:
                raise CategoryAlreadyExistsError(data.name)

            now = _utc_now()
            category = Category(
                name=data.name,
                description=data.description,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            category = self.category_repository.save(category)
            self.db.commit()
            return category
        except DuplicateCategoryNameError as error:
            self.db.rollback()
            raise CategoryAlreadyExistsError(data.name) from error
        except Exception:
            self.db.rollback()
            raise

    def list_categories(
        self,
        *,
        include_inactive: bool,
        actor: User,
    ) -> list[Category]:
        if include_inactive and actor.role != UserRole.ADMIN.value:
            raise AuthorizationError
        return self.category_repository.list(include_inactive=include_inactive)

    def get_category(self, category_id: int, actor: User) -> Category:
        category = self.category_repository.get_by_id(category_id)
        if category is None:
            raise CategoryNotFoundError(category_id)
        if not category.is_active and actor.role != UserRole.ADMIN.value:
            raise CategoryNotFoundError(category_id)
        return category

    def update_category(
        self,
        category_id: int,
        data: CategoryUpdate,
        actor: User,
    ) -> Category:
        self._require_admin(actor)
        try:
            category = self.category_repository.get_by_id_for_update(category_id)
            if category is None:
                raise CategoryNotFoundError(category_id)

            if "name" in data.model_fields_set:
                assert data.name is not None
                existing = self.category_repository.get_by_name(data.name)
                if existing is not None and existing.id != category.id:
                    raise CategoryAlreadyExistsError(data.name)
                category.name = data.name
            if "description" in data.model_fields_set:
                category.description = data.description
            if "is_active" in data.model_fields_set:
                assert data.is_active is not None
                category.is_active = data.is_active

            category.updated_at = _utc_now()
            category = self.category_repository.save(category)
            self.db.commit()
            return category
        except DuplicateCategoryNameError as error:
            self.db.rollback()
            name = data.name if data.name is not None else ""
            raise CategoryAlreadyExistsError(name) from error
        except Exception:
            self.db.rollback()
            raise

    @staticmethod
    def _require_admin(actor: User) -> None:
        if actor.role != UserRole.ADMIN.value:
            raise AuthorizationError
