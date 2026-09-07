from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base


class CommentVisibility(StrEnum):
    PUBLIC = "PUBLIC"
    INTERNAL = "INTERNAL"


class TicketComment(Base):
    __tablename__ = "ticket_comments"

    __table_args__ = (
        CheckConstraint(
    "visibility IN ('PUBLIC', 'INTERNAL')",
    name="visibility",
),
        Index(
            "ix_ticket_comments_ticket_id_created_at",
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

    author_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    content: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    visibility: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=CommentVisibility.PUBLIC.value,
        server_default=CommentVisibility.PUBLIC.value,
    )

    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    ticket: Mapped["Ticket"] = relationship(
        back_populates="comments",
    )

    author: Mapped["User"] = relationship(
        back_populates="comments",
    )