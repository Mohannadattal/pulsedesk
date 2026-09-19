from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Index, String
from sqlalchemy.dialects.mysql import BIGINT, CHAR, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.customer_email_delivery import CustomerEmailDelivery
    from app.models.customer_verification import CustomerVerification
    from app.models.ticket import Ticket


class Customer(Base):
    __tablename__ = "customers"

    __table_args__ = (
        CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL",
            name="contact_present",
        ),
        Index("ix_customers_email", "email"),
        Index("ix_customers_phone", "phone"),
        Index(
            "ix_customers_active_last_first_id",
            "is_active",
            "last_name",
            "first_name",
            "id",
        ),
        Index(
            "ix_customers_active_first_last_id",
            "is_active",
            "first_name",
            "last_name",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True), primary_key=True, autoincrement=True
    )
    customer_number: Mapped[str] = mapped_column(
        String(20), nullable=False, unique=True
    )
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(nullable=True)
    email: Mapped[str | None] = mapped_column(
        String(254).with_variant(String(254, collation="utf8mb4_bin"), "mysql"),
        nullable=True,
    )
    phone: Mapped[str | None] = mapped_column(String(16), nullable=True)
    street: Mapped[str | None] = mapped_column(String(150), nullable=True)
    house_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    country: Mapped[str | None] = mapped_column(CHAR(2), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="1"
    )
    created_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    verifications: Mapped[list["CustomerVerification"]] = relationship(
        back_populates="customer"
    )
    tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="customer",
        foreign_keys="Ticket.customer_id",
    )
    email_deliveries: Mapped[list["CustomerEmailDelivery"]] = relationship(
        back_populates="customer",
        foreign_keys="CustomerEmailDelivery.customer_id",
    )
