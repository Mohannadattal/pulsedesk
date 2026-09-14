from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.dependencies.services import get_user_service
from app.schemas.user import UserCreate, UserResponse
from app.services.user import UserService


router = APIRouter(prefix="/users", tags=["Users"])


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_409_CONFLICT: {
            "description": "A user with this email already exists.",
        },
    },
)
def create_user(
    data: UserCreate,
    user_service: Annotated[UserService, Depends(get_user_service)],
) -> UserResponse:
    return user_service.create_user(data)

@router.get(
    "/{user_id}",
    response_model=UserResponse,
    responses={
        status.HTTP_404_NOT_FOUND: {
            "description": "User not found.",
        },
    },
)
def get_user(
    user_id: int,
    user_service: Annotated[UserService, Depends(get_user_service)],
) -> UserResponse:
    return user_service.get_user(user_id)