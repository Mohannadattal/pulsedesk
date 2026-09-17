from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.dependencies.auth import (
    get_current_user,
    require_roles,
    require_self_or_roles,
)
from app.dependencies.services import get_user_service
from app.models.user import User, UserRole
from app.schemas.error import ErrorResponse
from app.schemas.user import (
    UserDirectoryFilters,
    UserDirectoryListResponse,
    UserActivationUpdate,
    UserProvisionRequest,
    UserResponse,
)
from app.services.user import UserService


router = APIRouter(prefix="/users", tags=["Users"])


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="create_user",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Administrator access is required.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "A user with this email already exists.",
            "model": ErrorResponse,
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
    "",
    response_model=UserDirectoryListResponse,
    operation_id="list_users",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Agent or administrator access is required.",
            "model": ErrorResponse,
        },
    },
)
def list_users(
    filters: Annotated[UserDirectoryFilters, Depends()],
    user_service: Annotated[UserService, Depends(get_user_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserDirectoryListResponse:
    return user_service.list_users(filters, current_user)


@router.get(
    "/{user_id}",
    response_model=UserResponse,
    operation_id="get_user",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Access is limited to the user or an administrator.",
            "model": ErrorResponse,
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "User not found.",
            "model": ErrorResponse,
        },
    },
)
def get_user(
    user_id: Annotated[int, Path(gt=0)],
    user_service: Annotated[UserService, Depends(get_user_service)],
    _authorized_user: Annotated[
        User,
        Depends(require_self_or_roles(UserRole.ADMIN)),
    ],
) -> UserResponse:
    return user_service.get_user(user_id)


@router.patch(
    "/{user_id}/activation",
    response_model=UserResponse,
    operation_id="update_user_activation",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Administrator access is required.",
            "model": ErrorResponse,
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "User not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "The requested activation change violates an account invariant.",
            "model": ErrorResponse,
        },
    },
)
def update_user_activation(
    user_id: Annotated[int, Path(gt=0)],
    data: UserActivationUpdate,
    user_service: Annotated[UserService, Depends(get_user_service)],
    current_admin: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> UserResponse:
    return user_service.update_activation(user_id, data, current_admin)
