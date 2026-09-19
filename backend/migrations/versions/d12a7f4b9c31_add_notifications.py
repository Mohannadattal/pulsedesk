"""add notification center foundation

Revision ID: d12a7f4b9c31
Revises: c4f9a8e71d22
Create Date: 2026-09-18 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = "d12a7f4b9c31"
down_revision: str | Sequence[str] | None = "c4f9a8e71d22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column(
            "id",
            mysql.BIGINT(unsigned=True),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column(
            "recipient_user_id",
            mysql.BIGINT(unsigned=True),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("ticket_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("actor_user_id", mysql.BIGINT(unsigned=True), nullable=True),
        sa.Column("is_read", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("read_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.CheckConstraint(
            "type IN ('TICKET_ASSIGNED', 'TICKET_REASSIGNED', "
            "'TICKET_PUBLIC_COMMENT', 'TICKET_IN_PROGRESS', "
            "'TICKET_RESOLVED', 'TICKET_CLOSED', "
            "'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED')",
            name=op.f("ck_notifications_type"),
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name=op.f("fk_notifications_actor_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"],
            ["users.id"],
            name=op.f("fk_notifications_recipient_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_notifications_ticket_id_tickets"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notifications")),
    )
    op.create_index(
        "ix_notifications_recipient_created_at_id",
        "notifications",
        ["recipient_user_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_recipient_is_read_created_at_id",
        "notifications",
        ["recipient_user_id", "is_read", "created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("notifications")
