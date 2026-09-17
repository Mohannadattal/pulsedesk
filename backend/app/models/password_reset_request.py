from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import BIGINT, DATETIME
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.user import User


class PasswordResetRequestStatus(StrEnum):
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'RESOLVED')",
            name="status",
        ),
        CheckConstraint(
            "(status = 'PENDING' AND resolved_at IS NULL "
            "AND resolved_by_user_id IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL "
            "AND resolved_by_user_id IS NOT NULL)",
            name="resolution_consistency",
        ),
        UniqueConstraint("pending_user_id"),
        Index(
            "ix_password_reset_requests_status_requested_at_id",
            "status",
            "requested_at",
            "id",
        ),
        Index(
            "ix_password_reset_requests_user_id_requested_at_id",
            "user_id",
            "requested_at",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True), primary_key=True, autoincrement=True
    )
    user_id: Mapped[int] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=PasswordResetRequestStatus.PENDING.value,
        server_default=PasswordResetRequestStatus.PENDING.value,
    )
    requested_at: Mapped[datetime] = mapped_column(DATETIME(fsp=6), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DATETIME(fsp=6))
    resolved_by_user_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
    )
    pending_user_id: Mapped[int | None] = mapped_column(
        BIGINT(unsigned=True),
        Computed(
            "CASE WHEN status = 'PENDING' THEN user_id ELSE NULL END",
            persisted=True,
        ),
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    resolved_by_user: Mapped["User | None"] = relationship(
        foreign_keys=[resolved_by_user_id]
    )
