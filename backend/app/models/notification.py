from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.ticket import Ticket
    from app.models.user import User


class NotificationType(StrEnum):
    TICKET_ASSIGNED = "TICKET_ASSIGNED"
    TICKET_REASSIGNED = "TICKET_REASSIGNED"
    TICKET_PUBLIC_COMMENT = "TICKET_PUBLIC_COMMENT"
    TICKET_IN_PROGRESS = "TICKET_IN_PROGRESS"
    TICKET_RESOLVED = "TICKET_RESOLVED"
    TICKET_CLOSED = "TICKET_CLOSED"
    PASSWORD_RESET_REQUESTED = "PASSWORD_RESET_REQUESTED"
    PASSWORD_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED"


class Notification(Base):
    __tablename__ = "notifications"

    __table_args__ = (
        CheckConstraint(
            "type IN ('TICKET_ASSIGNED', 'TICKET_REASSIGNED', "
            "'TICKET_PUBLIC_COMMENT', 'TICKET_IN_PROGRESS', "
            "'TICKET_RESOLVED', 'TICKET_CLOSED', "
            "'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED')",
            name="type",
        ),
        Index(
            "ix_notifications_recipient_created_at_id",
            "recipient_user_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_notifications_recipient_is_read_created_at_id",
            "recipient_user_id",
            "is_read",
            "created_at",
            "id",
        ),
        Index(
            "ix_notifications_created_at_id",
            "created_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True), primary_key=True, autoincrement=True
    )
    recipient_user_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    ticket_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("tickets.id", ondelete="SET NULL"),
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="SET NULL"),
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("0"),
    )
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6))

    recipient: Mapped["User"] = relationship(
        back_populates="received_notifications",
        foreign_keys=[recipient_user_id],
    )
    actor: Mapped["User | None"] = relationship(
        back_populates="acted_notifications",
        foreign_keys=[actor_user_id],
    )
    ticket: Mapped["Ticket | None"] = relationship(back_populates="notifications")
