"""password lifecycle phase 1

Revision ID: 4a8e2f6c91bd
Revises: 7c59f11d23e3
Create Date: 2026-09-17 17:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision: str = "4a8e2f6c91bd"
down_revision: Union[str, Sequence[str], None] = "7c59f11d23e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "auth_version",
            mysql.BIGINT(unsigned=True),
            server_default=sa.text("0"),
            nullable=False,
        ),
    )

    op.create_table(
        "password_reset_requests",
        sa.Column(
            "id",
            mysql.BIGINT(unsigned=True),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            mysql.BIGINT(unsigned=True),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="PENDING",
            nullable=False,
        ),
        sa.Column(
            "requested_at",
            mysql.DATETIME(fsp=6),
            nullable=False,
        ),
        sa.Column("resolved_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column(
            "resolved_by_user_id",
            mysql.BIGINT(unsigned=True),
            nullable=True,
        ),
        sa.Column(
            "pending_user_id",
            mysql.BIGINT(unsigned=True),
            sa.Computed(
                "CASE WHEN status = 'PENDING' THEN user_id ELSE NULL END",
                persisted=True,
            ),
            nullable=True,
        ),
        sa.CheckConstraint(
            "(status = 'PENDING' AND resolved_at IS NULL "
            "AND resolved_by_user_id IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL "
            "AND resolved_by_user_id IS NOT NULL)",
            name=op.f("ck_password_reset_requests_resolution_consistency"),
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'RESOLVED')",
            name=op.f("ck_password_reset_requests_status"),
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_user_id"],
            ["users.id"],
            name=op.f("fk_password_reset_requests_resolved_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_password_reset_requests_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("pk_password_reset_requests"),
        ),
        sa.UniqueConstraint(
            "pending_user_id",
            name=op.f("uq_password_reset_requests_pending_user_id"),
        ),
    )
    op.create_index(
        "ix_password_reset_requests_status_requested_at_id",
        "password_reset_requests",
        ["status", "requested_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_password_reset_requests_user_id_requested_at_id",
        "password_reset_requests",
        ["user_id", "requested_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_password_reset_requests_user_id_requested_at_id",
        table_name="password_reset_requests",
    )
    op.drop_index(
        "ix_password_reset_requests_status_requested_at_id",
        table_name="password_reset_requests",
    )
    op.drop_table("password_reset_requests")
    op.drop_column("users", "auth_version")
    op.drop_column("users", "must_change_password")
