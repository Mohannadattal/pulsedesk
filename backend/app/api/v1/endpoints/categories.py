from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, status

from app.dependencies.auth import get_current_user
from app.dependencies.services import get_category_service
from app.models.user import User
from app.schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from app.schemas.error import ErrorResponse
from app.services.category import CategoryService


router = APIRouter(prefix="/categories", tags=["Categories"])


@router.post(
    "",
    response_model=CategoryResponse,
    status_code=status.HTTP_201_CREATED,
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
            "description": "Category name already exists.",
            "model": ErrorResponse,
        },
    },
)
def create_category(
    data: CategoryCreate,
    category_service: Annotated[CategoryService, Depends(get_category_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CategoryResponse:
    return category_service.create_category(data, current_user)


@router.get(
    "",
    response_model=list[CategoryResponse],
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_403_FORBIDDEN: {
            "description": "Only administrators may include inactive categories.",
            "model": ErrorResponse,
        },
    },
)
def list_categories(
    category_service: Annotated[CategoryService, Depends(get_category_service)],
    current_user: Annotated[User, Depends(get_current_user)],
    include_inactive: Annotated[bool, Query()] = False,
) -> list[CategoryResponse]:
    return category_service.list_categories(
        include_inactive=include_inactive,
        actor=current_user,
    )


@router.get(
    "/{category_id}",
    response_model=CategoryResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {
            "description": "Authentication is required.",
            "model": ErrorResponse,
        },
        status.HTTP_404_NOT_FOUND: {
            "description": "Visible category not found.",
            "model": ErrorResponse,
        },
    },
)
def get_category(
    category_id: Annotated[int, Path(gt=0)],
    category_service: Annotated[CategoryService, Depends(get_category_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CategoryResponse:
    return category_service.get_category(category_id, current_user)


@router.patch(
    "/{category_id}",
    response_model=CategoryResponse,
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
            "description": "Category not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "Category name already exists.",
            "model": ErrorResponse,
        },
    },
)
def update_category(
    category_id: Annotated[int, Path(gt=0)],
    data: CategoryUpdate,
    category_service: Annotated[CategoryService, Depends(get_category_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> CategoryResponse:
    return category_service.update_category(category_id, data, current_user)
