from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from app.models.ticket_event import TicketEventType


class TicketEventListFilters(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class TicketEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    actor_id: int | None
    event_type: TicketEventType
    field_name: str | None
    old_value: str | None
    new_value: str | None
    metadata: dict[str, JsonValue] | None = Field(
        validation_alias="event_metadata",
    )
    created_at: datetime


class TicketEventListResponse(BaseModel):
    items: list[TicketEventResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
