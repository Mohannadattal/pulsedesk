from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.customer_email_delivery import (
    CustomerEmailDelivery,
    CustomerEmailStatus,
    CustomerEmailType,
)
from app.models.ticket import Ticket
from app.repositories.customer_email_delivery import CustomerEmailDeliveryRepository
from app.repositories.exceptions import DuplicateCustomerEmailIdempotencyKeyError
from app.services.customer_email_templates import CustomerEmailTemplateRenderer
from app.services.email_transport import (
    EmailTransport,
    build_customer_email_message,
)

MAXIMUM_DELIVERY_RETRIES = 5
MAXIMUM_DELIVERY_ATTEMPTS = 1 + MAXIMUM_DELIVERY_RETRIES
RETRY_DELAYS_AFTER_FAILED_ATTEMPTS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=15),
    timedelta(hours=1),
    timedelta(hours=6),
)
LEASE_EXHAUSTED_ERROR = "Delivery processing lease expired after final attempt."


class CustomerEmailOutboxService:
    """Stages deterministic customer email snapshots in the caller's transaction."""

    def __init__(
        self,
        db: Session,
        repository: CustomerEmailDeliveryRepository,
    ) -> None:
        self.db = db
        self.repository = repository

    def stage_ticket_created(
        self,
        ticket: Ticket,
        customer: Customer | None,
        *,
        created_at: datetime,
    ) -> CustomerEmailDelivery | None:
        if customer is None or customer.email is None:
            return None
        return self._stage(
            ticket=ticket,
            customer=customer,
            email_type=CustomerEmailType.TICKET_CREATED,
            resolution_summary=None,
            idempotency_key=f"ticket:{ticket.id}:created:v1",
            created_at=created_at,
        )

    def stage_ticket_resolved(
        self,
        ticket: Ticket,
        customer: Customer | None,
        *,
        resolution_summary: str,
        created_at: datetime,
    ) -> CustomerEmailDelivery | None:
        if customer is None or customer.email is None:
            return None
        return self._stage(
            ticket=ticket,
            customer=customer,
            email_type=CustomerEmailType.TICKET_RESOLVED,
            resolution_summary=resolution_summary,
            idempotency_key=f"ticket:{ticket.id}:resolved:cycle:1:v1",
            created_at=created_at,
        )

    def _stage(
        self,
        *,
        ticket: Ticket,
        customer: Customer,
        email_type: CustomerEmailType,
        resolution_summary: str | None,
        idempotency_key: str,
        created_at: datetime,
    ) -> CustomerEmailDelivery:
        delivery = CustomerEmailDelivery(
            ticket_id=ticket.id,
            customer_id=customer.id,
            recipient_email=customer.email,
            email_type=email_type.value,
            status=CustomerEmailStatus.PENDING.value,
            idempotency_key=idempotency_key,
            customer_first_name=customer.first_name,
            ticket_number=ticket.ticket_number,
            ticket_title=ticket.title,
            resolution_summary=resolution_summary,
            attempt_count=0,
            next_attempt_at=created_at,
            processing_started_at=None,
            processing_token=None,
            sent_at=None,
            last_error=None,
            created_at=created_at,
            updated_at=created_at,
        )
        try:
            with self.db.begin_nested():
                return self.repository.create(delivery)
        except DuplicateCustomerEmailIdempotencyKeyError:
            existing = self.repository.get_by_idempotency_key(idempotency_key)
            if existing is None:
                raise
            return existing


@dataclass(frozen=True)
class CustomerEmailBatchResult:
    claimed: int = 0
    sent: int = 0
    retry_scheduled: int = 0
    terminal_failed: int = 0
    stale_terminalized: int = 0
    disabled: bool = False


class CustomerEmailDeliveryProcessor:
    def __init__(
        self,
        *,
        db: Session,
        repository: CustomerEmailDeliveryRepository,
        renderer: CustomerEmailTemplateRenderer,
        transport: EmailTransport,
        delivery_enabled: bool,
        batch_size: int,
        lease_duration: timedelta,
        from_address: str,
        from_name: str,
        reply_to: str | None,
    ) -> None:
        self.db = db
        self.repository = repository
        self.renderer = renderer
        self.transport = transport
        self.delivery_enabled = delivery_enabled
        self.batch_size = batch_size
        self.lease_duration = lease_duration
        self.from_address = from_address
        self.from_name = from_name
        self.reply_to = reply_to

    def process_batch(self, *, now: datetime) -> CustomerEmailBatchResult:
        if not self.delivery_enabled:
            return CustomerEmailBatchResult(disabled=True)

        stale_before = now - self.lease_duration
        stale_terminalized = self.repository.expire_exhausted_leases(
            now=now,
            stale_before=stale_before,
            maximum_attempts=MAXIMUM_DELIVERY_ATTEMPTS,
            error_message=LEASE_EXHAUSTED_ERROR,
        )
        deliveries = self.repository.claim_due(
            now=now,
            stale_before=stale_before,
            batch_size=self.batch_size,
            maximum_attempts=MAXIMUM_DELIVERY_ATTEMPTS,
        )
        self.db.commit()

        sent = 0
        retry_scheduled = 0
        terminal_failed = 0
        for delivery in deliveries:
            token = delivery.processing_token
            assert token is not None
            try:
                rendered = self.renderer.render(delivery)
                message = build_customer_email_message(
                    delivery,
                    rendered,
                    from_address=self.from_address,
                    from_name=self.from_name,
                    reply_to=self.reply_to,
                )
                self.transport.send(message)
            # Transport implementations may surface library-specific exception
            # types; every send failure must become retry state for this row.
            except Exception as error:  # noqa: BLE001
                was_terminal = self._record_failure(
                    delivery.id,
                    token,
                    failed_at=now,
                    error_message=sanitize_delivery_error(error),
                )
                terminal_failed += int(was_terminal)
                retry_scheduled += int(not was_terminal)
            else:
                if self._record_sent(delivery.id, token, sent_at=now):
                    sent += 1

        return CustomerEmailBatchResult(
            claimed=len(deliveries),
            sent=sent,
            retry_scheduled=retry_scheduled,
            terminal_failed=terminal_failed,
            stale_terminalized=stale_terminalized,
        )

    def _record_sent(
        self,
        delivery_id: int,
        processing_token: str,
        *,
        sent_at: datetime,
    ) -> bool:
        claimed = self.repository.get_claimed_for_update(delivery_id, processing_token)
        if claimed is None:
            self.db.rollback()
            return False
        claimed.status = CustomerEmailStatus.SENT.value
        claimed.sent_at = sent_at
        claimed.next_attempt_at = None
        claimed.processing_started_at = None
        claimed.processing_token = None
        claimed.last_error = None
        claimed.updated_at = sent_at
        self.db.flush()
        self.db.commit()
        return True

    def _record_failure(
        self,
        delivery_id: int,
        processing_token: str,
        *,
        failed_at: datetime,
        error_message: str,
    ) -> bool:
        claimed = self.repository.get_claimed_for_update(delivery_id, processing_token)
        if claimed is None:
            self.db.rollback()
            return False
        terminal = claimed.attempt_count >= MAXIMUM_DELIVERY_ATTEMPTS
        claimed.status = CustomerEmailStatus.FAILED.value
        claimed.next_attempt_at = (
            None
            if terminal
            else failed_at
            + RETRY_DELAYS_AFTER_FAILED_ATTEMPTS[claimed.attempt_count - 1]
        )
        claimed.processing_started_at = None
        claimed.processing_token = None
        claimed.last_error = error_message
        claimed.updated_at = failed_at
        self.db.flush()
        self.db.commit()
        return terminal


def sanitize_delivery_error(error: Exception) -> str:
    return f"Email delivery failed ({type(error).__name__})."[:500]
