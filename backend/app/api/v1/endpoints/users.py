from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.auth import require_roles, require_self_or_roles
from app.dependencies.services import get_user_service
from app.models.user import User, UserRole
from app.schemas.user import UserProvisionRequest, UserResponse
from app.services.user import UserService


router = APIRouter(prefix="/users", tags=["Users"])


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Administrator access is required.",
        },
        status.HTTP_409_CONFLICT: {
            "description": "A user with this email already exists.",
        },
    },
)
def create_user(
    data: UserProvisionRequest,
    user_service: Annotated[UserService, Depends(get_user_service)],
    _current_admin: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> UserResponse:
    return user_service.create_user(data)


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Access is limited to the user or an administrator.",
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "User not found.",
        },
    },
)
def get_user(
    user_id: int,
    user_service: Annotated[UserService, Depends(get_user_service)],
    _authorized_user: Annotated[
        User,
        Depends(require_self_or_roles(UserRole.ADMIN)),
    ],
) -> UserResponse:
    return user_service.get_user(user_id)
