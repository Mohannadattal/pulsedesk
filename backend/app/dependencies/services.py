from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.security import password_hasher
from app.dependencies.database import get_db
from app.repositories.user import UserRepository
from app.services.user import UserService


def get_user_service(
    db: Annotated[Session, Depends(get_db)],
) -> UserService:
    user_repository = UserRepository(db)

    return UserService(
        db=db,
        user_repository=user_repository,
        password_hasher=password_hasher,
    )
