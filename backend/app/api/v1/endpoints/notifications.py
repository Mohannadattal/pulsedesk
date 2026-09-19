from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.dependencies.auth import get_current_user
from app.dependencies.services import get_notification_service
from app.models.user import User
from app.schemas.error import ErrorResponse
from app.schemas.notification import (
    NotificationListFilters,
    NotificationListResponse,
    NotificationReadAllResponse,
    NotificationResponse,
    NotificationUnreadCountResponse,
)
from app.services.notification import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"])

AUTH_RESPONSES = {
    status.HTTP_401_UNAUTHORIZED: {
        "description": "Authentication is required.",
        "model": ErrorResponse,
    }
}


@router.get(
    "",
    response_model=NotificationListResponse,
    operation_id="list_notifications",
    responses=AUTH_RESPONSES,
)
def list_notifications(
    filters: Annotated[NotificationListFilters, Depends()],
    notification_service: Annotated[
        NotificationService, Depends(get_notification_service)
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotificationListResponse:
    return notification_service.list_notifications(filters, current_user)


@router.get(
    "/unread-count",
    response_model=NotificationUnreadCountResponse,
    operation_id="get_notification_unread_count",
    responses=AUTH_RESPONSES,
)
def get_notification_unread_count(
    notification_service: Annotated[
        NotificationService, Depends(get_notification_service)
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotificationUnreadCountResponse:
    return notification_service.unread_count(current_user)


@router.patch(
    "/{notification_id}/read",
    response_model=NotificationResponse,
    operation_id="mark_notification_read",
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Owned notification not found.",
            "model": ErrorResponse,
        },
    },
)
def mark_notification_read(
    notification_id: Annotated[int, Path(gt=0)],
    notification_service: Annotated[
        NotificationService, Depends(get_notification_service)
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotificationResponse:
    return notification_service.mark_read(notification_id, current_user)


@router.post(
    "/read-all",
    response_model=NotificationReadAllResponse,
    operation_id="mark_all_notifications_read",
    responses=AUTH_RESPONSES,
)
def mark_all_notifications_read(
    notification_service: Annotated[
        NotificationService, Depends(get_notification_service)
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> NotificationReadAllResponse:
    return notification_service.mark_all_read(current_user)
