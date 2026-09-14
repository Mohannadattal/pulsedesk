from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.ticket import TicketPriority, TicketStatus
from app.schemas.category import CategoryReference
from app.schemas.types import UtcDateTime
from app.schemas.user import UserReference


class TicketMutationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TicketCreate(TicketMutationRequest):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    category_id: int = Field(gt=0)

    @field_validator("title", "description", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("description")
    @classmethod
    def enforce_mysql_text_capacity(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 65_535:
            raise ValueError("Description exceeds the database text capacity.")
        return value


class TicketAssignmentUpdate(TicketMutationRequest):
    assigned_to_id: int | None = Field(gt=0)


class TicketPriorityUpdate(TicketMutationRequest):
    priority: TicketPriority


class TicketStatusUpdate(TicketMutationRequest):
    status: TicketStatus


class TicketCategoryUpdate(TicketMutationRequest):
    category_id: int = Field(gt=0)


class TicketListFilters(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    category_id: int | None = Field(default=None, gt=0)
    assigned_to_id: int | None = Field(default=None, gt=0)
    created_by_id: int | None = Field(default=None, gt=0)
    unassigned: bool | None = None
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class TicketResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_number: str
    title: str
    description: str
    status: TicketStatus
    priority: TicketPriority
    category_id: int
    category: CategoryReference
    created_by_id: int
    created_by: UserReference = Field(validation_alias="creator")
    assigned_to_id: int | None
    assigned_to: UserReference | None = Field(validation_alias="assignee")
    created_at: UtcDateTime
    updated_at: UtcDateTime
    resolved_at: UtcDateTime | None
    closed_at: UtcDateTime | None


class TicketListResponse(BaseModel):
    items: list[TicketResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
