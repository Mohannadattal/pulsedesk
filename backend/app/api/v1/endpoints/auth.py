from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.auth import (
    get_authenticated_session,
    get_password_change_user,
)
from app.dependencies.services import (
    get_authentication_service,
    get_password_reset_service,
)
from app.schemas.auth import (
    AuthSessionResponse,
    AuthSessionStateResponse,
    CompletePasswordChangeRequest,
    LoginRequest,
    PasswordResetRequestAcceptedResponse,
    PasswordResetRequestCreate,
)
from app.schemas.error import ErrorResponse
from app.services.auth import AuthenticatedSession, AuthenticationService
from app.services.password_reset_request import PasswordResetService


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/login",
    response_model=AuthSessionResponse,
    operation_id="login",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "The supplied credentials could not be authenticated.",
            "model": ErrorResponse,
        },
    },
)
def login(
    data: LoginRequest,
    authentication_service: Annotated[
        AuthenticationService,
        Depends(get_authentication_service),
    ],
) -> AuthSessionResponse:
    return authentication_service.login(data)


@router.get(
    "/me",
    response_model=AuthSessionStateResponse,
    operation_id="get_current_user",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
    },
)
def read_current_user(
    session: Annotated[
        AuthenticatedSession,
        Depends(get_authenticated_session),
    ],
    authentication_service: Annotated[
        AuthenticationService,
        Depends(get_authentication_service),
    ],
) -> AuthSessionStateResponse:
    return authentication_service.restore_session(session)


@router.post(
    "/complete-password-change",
    response_model=AuthSessionResponse,
    operation_id="complete_password_change",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "A valid password-change session is required.",
            "model": ErrorResponse,
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "The replacement password is invalid.",
            "model": ErrorResponse,
        },
    },
)
def complete_password_change(
    data: CompletePasswordChangeRequest,
    session: Annotated[
        AuthenticatedSession,
        Depends(get_password_change_user),
    ],
    authentication_service: Annotated[
        AuthenticationService,
        Depends(get_authentication_service),
    ],
) -> AuthSessionResponse:
    return authentication_service.complete_password_change(data, session)


@router.post(
    "/password-reset-requests",
    response_model=PasswordResetRequestAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="request_password_reset",
)
def request_password_reset(
    data: PasswordResetRequestCreate,
    password_reset_service: Annotated[
        PasswordResetService,
        Depends(get_password_reset_service),
    ],
) -> PasswordResetRequestAcceptedResponse:
    return password_reset_service.request_reset(data)
