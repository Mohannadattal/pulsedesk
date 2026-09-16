from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from app.models.ticket_comment import CommentVisibility
from app.models.ticket_event import TicketEventType
from app.schemas.types import UtcDateTime


class TicketEventOrder(StrEnum):
    ASC = "asc"
    DESC = "desc"


class TicketEventListFilters(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    order: TicketEventOrder = TicketEventOrder.ASC


class TicketEventActorResponse(BaseModel):
    id: int | None
    display_name: str


class TicketEventCommentResponse(BaseModel):
    id: int
    visibility: CommentVisibility


class TicketEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: int
    ticket_id: int
    actor_id: int | None
    event_type: TicketEventType
    actor: TicketEventActorResponse | None
    field_name: str | None
    old_value: str | None
    new_value: str | None
    old_display_value: str | None
    new_display_value: str | None
    comment: TicketEventCommentResponse | None
    metadata: dict[str, JsonValue] | None = Field(
        validation_alias="event_metadata",
    )
    created_at: UtcDateTime


class TicketEventListResponse(BaseModel):
    items: list[TicketEventResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
