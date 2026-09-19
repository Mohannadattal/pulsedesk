"""add customer email deliveries

Revision ID: a61c9e4b2f70
Revises: e84b6c2d9a10
Create Date: 2026-09-19 10:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

# revision identifiers, used by Alembic.
revision: str = "a61c9e4b2f70"
down_revision: str | Sequence[str] | None = "e84b6c2d9a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "tickets",
        sa.Column("resolution_summary", sa.Text(), nullable=True),
    )
    op.create_table(
        "customer_email_deliveries",
        sa.Column(
            "id",
            mysql.BIGINT(unsigned=True),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("ticket_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("customer_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("recipient_email", sa.String(length=254), nullable=False),
        sa.Column("email_type", sa.String(length=30), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="PENDING",
            nullable=False,
        ),
        sa.Column(
            "idempotency_key",
            mysql.VARCHAR(length=255, collation="utf8mb4_bin"),
            nullable=False,
        ),
        sa.Column("customer_first_name", sa.String(length=100), nullable=False),
        sa.Column("ticket_number", sa.String(length=20), nullable=False),
        sa.Column("ticket_title", sa.String(length=200), nullable=False),
        sa.Column("resolution_summary", sa.Text(), nullable=True),
        sa.Column(
            "attempt_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
        sa.Column("next_attempt_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("processing_started_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("processing_token", sa.String(length=36), nullable=True),
        sa.Column("sent_at", mysql.DATETIME(fsp=6), nullable=True),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "attempt_count >= 0",
            name=op.f("ck_customer_email_deliveries_attempt_count_nonnegative"),
        ),
        sa.CheckConstraint(
            "email_type IN ('TICKET_CREATED', 'TICKET_RESOLVED')",
            name=op.f("ck_customer_email_deliveries_email_type"),
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')",
            name=op.f("ck_customer_email_deliveries_status"),
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_customer_email_deliveries_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_customer_email_deliveries_ticket_id_tickets"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer_email_deliveries")),
        sa.UniqueConstraint(
            "idempotency_key",
            name=op.f("uq_customer_email_deliveries_idempotency_key"),
        ),
    )
    op.create_index(
        "ix_customer_email_deliveries_customer_id",
        "customer_email_deliveries",
        ["customer_id"],
        unique=False,
    )
    op.create_index(
        "ix_customer_email_deliveries_due",
        "customer_email_deliveries",
        ["status", "next_attempt_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_customer_email_deliveries_processing_lease",
        "customer_email_deliveries",
        ["status", "processing_started_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_customer_email_deliveries_ticket_id",
        "customer_email_deliveries",
        ["ticket_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("customer_email_deliveries")
    op.drop_column("tickets", "resolution_summary")
