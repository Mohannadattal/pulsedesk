from datetime import timedelta
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import AccessTokenManager, password_hasher
from app.dependencies.database import get_db
from app.repositories.category import CategoryRepository
from app.repositories.ticket import TicketRepository
from app.repositories.user import UserRepository
from app.services.auth import AuthenticationService
from app.services.category import CategoryService
from app.services.ticket import TicketService
from app.services.user import UserService


access_token_manager = AccessTokenManager(
    secret=settings.jwt_secret.get_secret_value(),
    algorithm=settings.jwt_algorithm,
    lifetime=timedelta(minutes=settings.access_token_expire_minutes),
)


def get_user_service(
    db: Annotated[Session, Depends(get_db)],
) -> UserService:
    user_repository = UserRepository(db)

    return UserService(
        db=db,
        user_repository=user_repository,
        password_hasher=password_hasher,
    )


def get_authentication_service(
    db: Annotated[Session, Depends(get_db)],
) -> AuthenticationService:
    return AuthenticationService(
        user_repository=UserRepository(db),
        password_hasher=password_hasher,
        access_token_manager=access_token_manager,
    )


def get_category_service(
    db: Annotated[Session, Depends(get_db)],
) -> CategoryService:
    return CategoryService(
        db=db,
        category_repository=CategoryRepository(db),
    )


def get_ticket_service(
    db: Annotated[Session, Depends(get_db)],
) -> TicketService:
    return TicketService(
        db=db,
        ticket_repository=TicketRepository(db),
        category_repository=CategoryRepository(db),
        user_repository=UserRepository(db),
    )
