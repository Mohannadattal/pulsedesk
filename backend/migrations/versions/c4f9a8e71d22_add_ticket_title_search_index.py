"""add ticket title search index

Revision ID: c4f9a8e71d22
Revises: b93f2d7a6c10
Create Date: 2026-09-18 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4f9a8e71d22"
down_revision: Union[str, Sequence[str], None] = "b93f2d7a6c10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index("ix_tickets_title", "tickets", ["title"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_tickets_title", table_name="tickets")
