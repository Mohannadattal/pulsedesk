"""add notification retention index

Revision ID: e84b6c2d9a10
Revises: d12a7f4b9c31
Create Date: 2026-09-18 17:15:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e84b6c2d9a10"
down_revision: str | Sequence[str] | None = "d12a7f4b9c31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_notifications_created_at_id",
        "notifications",
        ["created_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_created_at_id", table_name="notifications")
