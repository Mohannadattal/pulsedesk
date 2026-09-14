from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.auth import get_current_user
from app.dependencies.services import get_authentication_service
from app.models.user import User
from app.schemas.auth import AccessTokenResponse, LoginRequest
from app.schemas.error import ErrorResponse
from app.schemas.user import UserResponse
from app.services.auth import AuthenticationService


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/login",
    response_model=AccessTokenResponse,
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
) -> AccessTokenResponse:
    return authentication_service.login(data)


@router.get(
    "/me",
    response_model=UserResponse,
    operation_id="get_current_user",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
    },
)
def read_current_user(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    return current_user
