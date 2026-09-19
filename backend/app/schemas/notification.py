from pydantic import BaseModel, ConfigDict, Field

from app.models.notification import NotificationType
from app.schemas.types import UtcDateTime
from app.schemas.user import UserReference


class NotificationListFilters(BaseModel):
    unread_only: bool = False
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class NotificationTicketReference(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_number: str
    title: str


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: NotificationType
    is_read: bool
    created_at: UtcDateTime
    read_at: UtcDateTime | None
    actor: UserReference | None
    ticket: NotificationTicketReference | None


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class NotificationUnreadCountResponse(BaseModel):
    unread_count: int


class NotificationReadAllResponse(BaseModel):
    updated_count: int
