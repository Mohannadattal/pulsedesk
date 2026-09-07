from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import ForeignKey, Index, JSON, String
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class TicketEventType(StrEnum):
    TICKET_CREATED = "TICKET_CREATED"
    STATUS_CHANGED = "STATUS_CHANGED"
    PRIORITY_CHANGED = "PRIORITY_CHANGED"
    ASSIGNEE_CHANGED = "ASSIGNEE_CHANGED"
    CATEGORY_CHANGED = "CATEGORY_CHANGED"
    COMMENT_ADDED = "COMMENT_ADDED"
    TICKET_RESOLVED = "TICKET_RESOLVED"
    TICKET_CLOSED = "TICKET_CLOSED"


class TicketEvent(Base):
    __tablename__ = "ticket_events"

    __table_args__ = (
        Index(
            "ix_ticket_events_ticket_id_created_at",
            "ticket_id",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        primary_key=True,
        autoincrement=True,
    )

    ticket_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
    )

    actor_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    event_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    field_name: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    old_value: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    new_value: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    event_metadata: Mapped[dict[str, Any] | None] = mapped_column(
    "metadata",
    JSON,
    nullable=True,
)
    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    ticket: Mapped["Ticket"] = relationship(
        back_populates="events",
    )

    actor: Mapped["User | None"] = relationship(
        back_populates="ticket_events",
    )