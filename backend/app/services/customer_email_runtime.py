from datetime import timedelta

from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.repositories.customer_email_delivery import CustomerEmailDeliveryRepository
from app.services.customer_email_delivery import (
    CustomerEmailBatchResult,
    CustomerEmailDeliveryProcessor,
)
from app.services.customer_email_templates import CustomerEmailTemplateRenderer
from app.services.email_transport import SmtpEmailTransport
from app.utils.time import utc_now_naive


class ConfiguredCustomerEmailBatchProcessor:
    """Builds one bounded processor batch from the application's configuration."""

    def __init__(
        self,
        *,
        config: Settings,
        session_factory: sessionmaker[Session],
    ) -> None:
        self.config = config
        self.session_factory = session_factory
        self.transport = (
            self._build_transport() if config.email_delivery_enabled else None
        )

    def __call__(self) -> CustomerEmailBatchResult:
        if not self.config.email_delivery_enabled:
            return CustomerEmailBatchResult(disabled=True)

        assert self.transport is not None
        assert self.config.email_from_address is not None
        with self.session_factory() as db:
            return CustomerEmailDeliveryProcessor(
                db=db,
                repository=CustomerEmailDeliveryRepository(db),
                renderer=CustomerEmailTemplateRenderer(
                    product_name=self.config.email_product_name,
                    support_name=self.config.email_support_name,
                ),
                transport=self.transport,
                delivery_enabled=True,
                batch_size=self.config.email_delivery_batch_size,
                lease_duration=timedelta(
                    minutes=self.config.email_processing_lease_minutes
                ),
                from_address=str(self.config.email_from_address),
                from_name=self.config.email_from_name,
                reply_to=(
                    str(self.config.email_reply_to)
                    if self.config.email_reply_to is not None
                    else None
                ),
            ).process_batch(now=utc_now_naive())

    def _build_transport(self) -> SmtpEmailTransport:
        assert self.config.smtp_host is not None
        return SmtpEmailTransport(
            host=self.config.smtp_host,
            port=self.config.smtp_port,
            username=self.config.smtp_username,
            password=(
                self.config.smtp_password.get_secret_value()
                if self.config.smtp_password is not None
                else None
            ),
            use_tls=self.config.smtp_use_tls,
            timeout_seconds=self.config.smtp_timeout_seconds,
        )
