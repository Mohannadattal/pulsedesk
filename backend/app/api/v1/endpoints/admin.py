from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.auth import require_roles
from app.dependencies.services import get_user_service
from app.models.user import User, UserRole
from app.schemas.error import ErrorResponse
from app.schemas.user import AdminUserDirectoryListResponse, UserDirectoryFilters
from app.services.user import UserService


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
