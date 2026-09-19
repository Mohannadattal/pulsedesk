from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.category import Category
    from app.models.customer import Customer
    from app.models.customer_verification import CustomerVerification
    from app.models.notification import Notification
    from app.models.ticket_comment import TicketComment
    from app.models.ticket_event import TicketEvent
    from app.models.user import User


class TicketStatus(StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class TicketPriority(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    URGENT = "URGENT"


class Ticket(Base):
    __tablename__ = "tickets"

    __table_args__ = (
        CheckConstraint(
            "status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')",
            name="status",
        ),
        CheckConstraint(
            "priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')",
            name="priority",
        ),
        Index(
            "ix_tickets_category_id",
            "category_id",
        ),
        Index(
            "ix_tickets_created_by_created_at",
            "created_by_id",
            "created_at",
        ),
        Index(
            "ix_tickets_assigned_to_status_created_at",
            "assigned_to_id",
            "status",
            "created_at",
        ),
        Index(
            "ix_tickets_status_priority_created_at",
            "status",
            "priority",
            "created_at",
        ),
        Index(
            "ix_tickets_customer_created_at_id",
            "customer_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_tickets_customer_verification_id",
            "customer_verification_id",
        ),
        Index(
            "ix_tickets_title",
            "title",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        primary_key=True,
        autoincrement=True,
    )

    ticket_number: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        unique=True,
    )

    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )

    description: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=TicketStatus.OPEN.value,
        server_default=TicketStatus.OPEN.value,
    )

    priority: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=TicketPriority.MEDIUM.value,
        server_default=TicketPriority.MEDIUM.value,
    )

    category_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("categories.id", ondelete="RESTRICT"),
        nullable=False,
    )

    created_by_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    assigned_to_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    customer_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=True,
    )

    customer_verification_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("customer_verifications.id", ondelete="RESTRICT"),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DATETIME(fsp=6),
        nullable=False,
    )

    resolved_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    closed_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6),
        nullable=True,
    )

    category: Mapped["Category"] = relationship(
        back_populates="tickets",
    )

    creator: Mapped["User"] = relationship(
        back_populates="created_tickets",
        foreign_keys=[created_by_id],
    )

    assignee: Mapped["User | None"] = relationship(
        back_populates="assigned_tickets",
        foreign_keys=[assigned_to_id],
    )

    customer: Mapped["Customer | None"] = relationship(
        back_populates="tickets",
        foreign_keys=[customer_id],
    )

    customer_verification: Mapped["CustomerVerification | None"] = relationship(
        back_populates="tickets",
    )

    comments: Mapped[list["TicketComment"]] = relationship(
        back_populates="ticket",
    )

    events: Mapped[list["TicketEvent"]] = relationship(
        back_populates="ticket",
    )

    notifications: Mapped[list["Notification"]] = relationship(
        back_populates="ticket",
    )

    @property
    def customer_was_verified(self) -> bool:
        return self.customer_verification_id is not None
