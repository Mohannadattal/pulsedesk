from datetime import timedelta
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import AccessTokenManager, password_hasher
from app.dependencies.database import get_db
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.password_reset_request import PasswordResetRequestRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_comment import TicketCommentRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.services.auth import AuthenticationService
from app.services.category import CategoryService
from app.services.customer import CustomerService
from app.services.password_reset_request import PasswordResetService
from app.services.ticket import TicketService
from app.services.ticket_comment import TicketCommentService
from app.services.ticket_event import TicketEventRecorder, TicketEventService
from app.services.user import UserService

access_token_manager = AccessTokenManager(
    secret=settings.jwt_secret.get_secret_value(),
    algorithm=settings.jwt_algorithm,
    access_lifetime=timedelta(minutes=settings.access_token_expire_minutes),
    password_change_lifetime=timedelta(
        minutes=settings.password_change_token_expire_minutes
    ),
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
        db=db,
        user_repository=UserRepository(db),
        password_hasher=password_hasher,
        access_token_manager=access_token_manager,
    )


def get_password_reset_service(
    db: Annotated[Session, Depends(get_db)],
) -> PasswordResetService:
    return PasswordResetService(
        db=db,
        password_reset_repository=PasswordResetRequestRepository(db),
        user_repository=UserRepository(db),
        password_hasher=password_hasher,
    )


def get_category_service(
    db: Annotated[Session, Depends(get_db)],
) -> CategoryService:
    return CategoryService(
        db=db,
        category_repository=CategoryRepository(db),
    )


def get_customer_service(
    db: Annotated[Session, Depends(get_db)],
) -> CustomerService:
    return CustomerService(
        db=db,
        customer_repository=CustomerRepository(db),
        verification_repository=CustomerVerificationRepository(db),
    )


def _build_ticket_service(
    db: Session,
    ticket_event_repository: TicketEventRepository | None = None,
) -> TicketService:
    event_repository = ticket_event_repository or TicketEventRepository(db)
    return TicketService(
        db=db,
        ticket_repository=TicketRepository(db),
        category_repository=CategoryRepository(db),
        user_repository=UserRepository(db),
        ticket_event_recorder=TicketEventRecorder(event_repository),
        customer_repository=CustomerRepository(db),
        customer_verification_repository=CustomerVerificationRepository(db),
    )


def get_ticket_service(
    db: Annotated[Session, Depends(get_db)],
) -> TicketService:
    return _build_ticket_service(db)


def get_ticket_comment_service(
    db: Annotated[Session, Depends(get_db)],
) -> TicketCommentService:
    ticket_event_repository = TicketEventRepository(db)
    return TicketCommentService(
        db=db,
        ticket_service=_build_ticket_service(db, ticket_event_repository),
        ticket_comment_repository=TicketCommentRepository(db),
        ticket_event_recorder=TicketEventRecorder(ticket_event_repository),
    )


def get_ticket_event_service(
    db: Annotated[Session, Depends(get_db)],
) -> TicketEventService:
    ticket_event_repository = TicketEventRepository(db)
    return TicketEventService(
        ticket_service=_build_ticket_service(db, ticket_event_repository),
        ticket_event_repository=ticket_event_repository,
        user_repository=UserRepository(db),
        category_repository=CategoryRepository(db),
    )
