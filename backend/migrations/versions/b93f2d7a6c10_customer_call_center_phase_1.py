"""customer call center phase 1

Revision ID: b93f2d7a6c10
Revises: 4a8e2f6c91bd
Create Date: 2026-09-17 20:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "b93f2d7a6c10"
down_revision: str | Sequence[str] | None = "4a8e2f6c91bd"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column(
            "id", mysql.BIGINT(unsigned=True), autoincrement=True, nullable=False
        ),
        sa.Column("customer_number", sa.String(length=20), nullable=False),
        sa.Column("first_name", sa.String(length=100), nullable=False),
        sa.Column("last_name", sa.String(length=100), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
        sa.Column(
            "email",
            sa.String(length=254, collation="utf8mb4_bin"),
            nullable=True,
        ),
        sa.Column("phone", sa.String(length=16), nullable=True),
        sa.Column("street", sa.String(length=150), nullable=True),
        sa.Column("house_number", sa.String(length=30), nullable=True),
        sa.Column("postal_code", sa.String(length=20), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("country", mysql.CHAR(length=2), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("updated_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.CheckConstraint(
            "email IS NOT NULL OR phone IS NOT NULL",
            name=op.f("ck_customers_contact_present"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
        sa.UniqueConstraint(
            "customer_number", name=op.f("uq_customers_customer_number")
        ),
    )
    op.create_index("ix_customers_email", "customers", ["email"], unique=False)
    op.create_index("ix_customers_phone", "customers", ["phone"], unique=False)
    op.create_index(
        "ix_customers_active_last_first_id",
        "customers",
        ["is_active", "last_name", "first_name", "id"],
        unique=False,
    )
    op.create_index(
        "ix_customers_active_first_last_id",
        "customers",
        ["is_active", "first_name", "last_name", "id"],
        unique=False,
    )

    op.create_table(
        "customer_verifications",
        sa.Column(
            "id", mysql.BIGINT(unsigned=True), autoincrement=True, nullable=False
        ),
        sa.Column("customer_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("verified_by_user_id", mysql.BIGINT(unsigned=True), nullable=False),
        sa.Column("factors", sa.JSON(), nullable=False),
        sa.Column("verified_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.Column("expires_at", mysql.DATETIME(fsp=6), nullable=False),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_customer_verifications_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["verified_by_user_id"],
            ["users.id"],
            name=op.f("fk_customer_verifications_verified_by_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer_verifications")),
    )
    op.create_index(
        "ix_customer_verifications_customer_expires_id",
        "customer_verifications",
        ["customer_id", "expires_at", "id"],
        unique=False,
    )

    op.add_column(
        "tickets",
        sa.Column("customer_id", mysql.BIGINT(unsigned=True), nullable=True),
    )
    op.add_column(
        "tickets",
        sa.Column(
            "customer_verification_id", mysql.BIGINT(unsigned=True), nullable=True
        ),
    )
    op.create_index(
        "ix_tickets_customer_created_at_id",
        "tickets",
        ["customer_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_tickets_customer_verification_id",
        "tickets",
        ["customer_verification_id"],
        unique=False,
    )
    op.create_foreign_key(
        op.f("fk_tickets_customer_id_customers"),
        "tickets",
        "customers",
        ["customer_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_tickets_customer_verification_id_customer_verifications"),
        "tickets",
        "customer_verifications",
        ["customer_verification_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # Customer records created after upgrade cannot be preserved by this downgrade.
    op.drop_constraint(
        op.f("fk_tickets_customer_verification_id_customer_verifications"),
        "tickets",
        type_="foreignkey",
    )
    op.drop_constraint(
        op.f("fk_tickets_customer_id_customers"),
        "tickets",
        type_="foreignkey",
    )
    op.drop_index("ix_tickets_customer_verification_id", table_name="tickets")
    op.drop_index("ix_tickets_customer_created_at_id", table_name="tickets")
    op.drop_column("tickets", "customer_verification_id")
    op.drop_column("tickets", "customer_id")
    op.drop_table("customer_verifications")
    op.drop_index("ix_customers_active_first_last_id", table_name="customers")
    op.drop_index("ix_customers_active_last_first_id", table_name="customers")
    op.drop_index("ix_customers_phone", table_name="customers")
    op.drop_index("ix_customers_email", table_name="customers")
    op.drop_table("customers")
