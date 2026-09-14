from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.services import get_authentication_service
from app.schemas.auth import AccessTokenResponse, LoginRequest
from app.schemas.error import ErrorResponse
from app.services.auth import AuthenticationService


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/login",
    response_model=AccessTokenResponse,
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
