from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.dependencies.auth import require_roles
from app.dependencies.services import get_password_reset_service, get_user_service
from app.models.user import User, UserRole
from app.schemas.error import ErrorResponse
from app.schemas.user import AdminUserDirectoryListResponse, UserDirectoryFilters
from app.services.user import UserService
from app.services.password_reset_request import PasswordResetService
from app.schemas.password_reset_request import (
    AdminResetPasswordRequest,
    PasswordResetRequestFilters,
    PasswordResetRequestListResponse,
    PasswordResetRequestResponse,
)


router = APIRouter(prefix="/admin", tags=["Administration"])


@router.get(
    "/users",
    response_model=AdminUserDirectoryListResponse,
    operation_id="list_admin_users",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Administrator access is required.",
            "model": ErrorResponse,
        },
    },
)
def list_admin_users(
    filters: Annotated[UserDirectoryFilters, Depends()],
    user_service: Annotated[UserService, Depends(get_user_service)],
    current_admin: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> AdminUserDirectoryListResponse:
    return user_service.list_admin_users(filters, current_admin)


@router.get(
    "/password-reset-requests",
    response_model=PasswordResetRequestListResponse,
    operation_id="list_password_reset_requests",
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Administrator access is required.",
            "model": ErrorResponse,
        },
    },
)
def list_password_reset_requests(
    filters: Annotated[PasswordResetRequestFilters, Depends()],
    password_reset_service: Annotated[
        PasswordResetService,
        Depends(get_password_reset_service),
    ],
    current_admin: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> PasswordResetRequestListResponse:
    return password_reset_service.list_requests(filters, current_admin)


@router.post(
    "/password-reset-requests/{request_id}/reset-password",
    response_model=PasswordResetRequestResponse,
    operation_id="reset_user_password",
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
            "description": "Password reset request was not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "The password reset request cannot be resolved.",
            "model": ErrorResponse,
        },
    },
)
def reset_user_password(
    request_id: Annotated[int, Path(gt=0)],
    data: AdminResetPasswordRequest,
    password_reset_service: Annotated[
        PasswordResetService,
        Depends(get_password_reset_service),
    ],
    current_admin: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> PasswordResetRequestResponse:
    return password_reset_service.reset_password(request_id, data, current_admin)
