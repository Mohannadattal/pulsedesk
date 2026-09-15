from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.ticket_comment import CommentVisibility
from app.schemas.types import UtcDateTime
from app.schemas.user import UserReference


class TicketCommentMutationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TicketCommentCreate(TicketCommentMutationRequest):
    content: str = Field(min_length=1)
    visibility: CommentVisibility = CommentVisibility.PUBLIC

    @field_validator("content", mode="before")
    @classmethod
    def strip_content(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("content")
    @classmethod
    def enforce_mysql_text_capacity(cls, value: str) -> str:
        if len(value.encode("utf-8")) > 65_535:
            raise ValueError("Comment exceeds the database text capacity.")
        return value


class TicketCommentListFilters(BaseModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class TicketCommentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_id: int
    author_id: int
    author: UserReference
    content: str
    visibility: CommentVisibility
    created_at: UtcDateTime
    updated_at: UtcDateTime


class TicketCommentListResponse(BaseModel):
    items: list[TicketCommentResponse]
    page: int
    page_size: int
    total: int
    total_pages: int
