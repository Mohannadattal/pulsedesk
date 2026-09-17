from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, ForeignKey, Index
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.customer import Customer
    from app.models.ticket import Ticket
    from app.models.user import User


class VerificationFactor(StrEnum):
    DATE_OF_BIRTH = "DATE_OF_BIRTH"
    POSTAL_CODE = "POSTAL_CODE"
    ADDRESS = "ADDRESS"
    PHONE = "PHONE"


class CustomerVerification(Base):
    __tablename__ = "customer_verifications"

    __table_args__ = (
        Index(
            "ix_customer_verifications_customer_expires_id",
            "customer_id",
            "expires_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True), primary_key=True, autoincrement=True
    )
    customer_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("customers.id", ondelete="RESTRICT"),
        nullable=False,
    )
    verified_by_user_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    factors: Mapped[list[str]] = mapped_column(JSON, nullable=False)
    verified_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)

    customer: Mapped["Customer"] = relationship(back_populates="verifications")
    verified_by: Mapped["User"] = relationship(back_populates="customer_verifications")
    tickets: Mapped[list["Ticket"]] = relationship(
        back_populates="customer_verification"
    )
