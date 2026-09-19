from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.ticket import Ticket


class CustomerEmailType(StrEnum):
    TICKET_CREATED = "TICKET_CREATED"
    TICKET_RESOLVED = "TICKET_RESOLVED"


class CustomerEmailStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SENT = "SENT"
    FAILED = "FAILED"


class CustomerEmailDelivery(Base):
    __tablename__ = "customer_email_deliveries"

    __table_args__ = (
        CheckConstraint(
            "email_type IN ('TICKET_CREATED', 'TICKET_RESOLVED')",
            name="email_type",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')",
            name="status",
        ),
        CheckConstraint("attempt_count >= 0", name="attempt_count_nonnegative"),
        UniqueConstraint("idempotency_key"),
        Index(
            "ix_customer_email_deliveries_due",
            "status",
            "next_attempt_at",
            "id",
        ),
        Index(
            "ix_customer_email_deliveries_processing_lease",
            "status",
            "processing_started_at",
            "id",
        ),
        Index("ix_customer_email_deliveries_ticket_id", "ticket_id"),
        Index("ix_customer_email_deliveries_customer_id", "customer_id"),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True), primary_key=True, autoincrement=True
    )
    ticket_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("tickets.id", ondelete="RESTRICT"),
        nullable=False,
    )
    customer_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    recipient_email: Mapped[str] = mapped_column(String(254), nullable=False)
    email_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=CustomerEmailStatus.PENDING.value,
        server_default=CustomerEmailStatus.PENDING.value,
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(255).with_variant(String(255, collation="utf8mb4_bin"), "mysql"),
        nullable=False,
    )

    customer_first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    ticket_number: Mapped[str] = mapped_column(String(20), nullable=False)
    ticket_title: Mapped[str] = mapped_column(String(200), nullable=False)
    resolution_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    attempt_count: Mapped[int] = mapped_column(
        nullable=False,
        default=0,
        server_default="0",
    )
    next_attempt_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DATETIME(fsp=6), nullable=True
    )
    processing_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    ticket: Mapped["Ticket"] = relationship(back_populates="customer_email_deliveries")
    customer: Mapped["Customer"] = relationship(
        back_populates="email_deliveries",
        foreign_keys=[customer_id],
    )
