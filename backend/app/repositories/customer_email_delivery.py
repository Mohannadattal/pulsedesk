from datetime import datetime
from uuid import uuid4

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.customer_email_delivery import (
    CustomerEmailDelivery,
    CustomerEmailStatus,
)
from app.repositories.exceptions import (
    DuplicateCustomerEmailIdempotencyKeyError,
    is_mysql_duplicate_constraint,
)

IDEMPOTENCY_UNIQUE_CONSTRAINT = "uq_customer_email_deliveries_idempotency_key"


class CustomerEmailDeliveryRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, delivery: CustomerEmailDelivery) -> CustomerEmailDelivery:
        self.db.add(delivery)
        try:
            self.db.flush()
        except IntegrityError as error:
            sqlite_duplicate = (
                "UNIQUE constraint failed: "
                "customer_email_deliveries.idempotency_key" in str(error.orig)
            )
            if sqlite_duplicate or is_mysql_duplicate_constraint(
                error, IDEMPOTENCY_UNIQUE_CONSTRAINT
            ):
                raise DuplicateCustomerEmailIdempotencyKeyError from error
            raise
        self.db.refresh(delivery)
        return delivery

    def get_by_idempotency_key(self, key: str) -> CustomerEmailDelivery | None:
        return self.db.scalar(
            select(CustomerEmailDelivery).where(
                CustomerEmailDelivery.idempotency_key == key
            )
        )

    def claim_due(
        self,
        *,
        now: datetime,
        stale_before: datetime,
        batch_size: int,
        maximum_attempts: int,
    ) -> list[CustomerEmailDelivery]:
        due_unclaimed = and_(
            CustomerEmailDelivery.status.in_(
                [
                    CustomerEmailStatus.PENDING.value,
                    CustomerEmailStatus.FAILED.value,
                ]
            ),
            CustomerEmailDelivery.attempt_count < maximum_attempts,
            CustomerEmailDelivery.next_attempt_at.is_not(None),
            CustomerEmailDelivery.next_attempt_at <= now,
        )
        stale_processing = and_(
            CustomerEmailDelivery.status == CustomerEmailStatus.PROCESSING.value,
            CustomerEmailDelivery.attempt_count < maximum_attempts,
            CustomerEmailDelivery.processing_started_at.is_not(None),
            CustomerEmailDelivery.processing_started_at <= stale_before,
        )
        statement = (
            select(CustomerEmailDelivery)
            .where(or_(due_unclaimed, stale_processing))
            .order_by(
                CustomerEmailDelivery.next_attempt_at,
                CustomerEmailDelivery.created_at,
                CustomerEmailDelivery.id,
            )
            .limit(batch_size)
            .with_for_update(skip_locked=True)
        )
        deliveries = list(self.db.scalars(statement).all())
        for delivery in deliveries:
            delivery.status = CustomerEmailStatus.PROCESSING.value
            delivery.attempt_count += 1
            delivery.next_attempt_at = None
            delivery.processing_started_at = now
            delivery.processing_token = str(uuid4())
            delivery.updated_at = now
        self.db.flush()
        return deliveries

    def expire_exhausted_leases(
        self,
        *,
        now: datetime,
        stale_before: datetime,
        maximum_attempts: int,
        error_message: str,
    ) -> int:
        result = self.db.execute(
            update(CustomerEmailDelivery)
            .where(
                CustomerEmailDelivery.status == CustomerEmailStatus.PROCESSING.value,
                CustomerEmailDelivery.attempt_count >= maximum_attempts,
                CustomerEmailDelivery.processing_started_at.is_not(None),
                CustomerEmailDelivery.processing_started_at <= stale_before,
            )
            .values(
                status=CustomerEmailStatus.FAILED.value,
                processing_started_at=None,
                processing_token=None,
                next_attempt_at=None,
                last_error=error_message,
                updated_at=now,
            )
        )
        return int(result.rowcount or 0)

    def get_claimed_for_update(
        self, delivery_id: int, processing_token: str
    ) -> CustomerEmailDelivery | None:
        return self.db.scalar(
            select(CustomerEmailDelivery)
            .where(
                CustomerEmailDelivery.id == delivery_id,
                CustomerEmailDelivery.status == CustomerEmailStatus.PROCESSING.value,
                CustomerEmailDelivery.processing_token == processing_token,
            )
            .with_for_update()
        )
