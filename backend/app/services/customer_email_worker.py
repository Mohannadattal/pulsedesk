import logging
import threading
from collections.abc import Callable

from app.services.customer_email_delivery import CustomerEmailBatchResult

logger = logging.getLogger(__name__)


class CustomerEmailWorker:
    def __init__(
        self,
        *,
        process_batch: Callable[[], CustomerEmailBatchResult],
        polling_interval_seconds: float,
        stop_event: threading.Event | None = None,
    ) -> None:
        self.process_batch = process_batch
        self.polling_interval_seconds = polling_interval_seconds
        self.stop_event = stop_event or threading.Event()

    def request_shutdown(self) -> None:
        self.stop_event.set()

    def run(self, *, delivery_enabled: bool) -> None:
        logger.info(
            "customer_email_worker_started enabled=%s polling_interval_seconds=%s",
            delivery_enabled,
            self.polling_interval_seconds,
        )
        while not self.stop_event.is_set():
            try:
                result = self.process_batch()
            except Exception as error:  # noqa: BLE001
                logger.error(
                    "customer_email_worker_batch_error error_type=%s "
                    "retry_delay_seconds=%s",
                    type(error).__name__,
                    self.polling_interval_seconds,
                )
                self.stop_event.wait(self.polling_interval_seconds)
                continue

            if result.claimed or result.stale_terminalized:
                logger.info(
                    "customer_email_worker_batch_complete claimed=%d sent=%d "
                    "retry_scheduled=%d terminal_failed=%d stale_terminalized=%d",
                    result.claimed,
                    result.sent,
                    result.retry_scheduled,
                    result.terminal_failed,
                    result.stale_terminalized,
                )
            else:
                logger.debug(
                    "customer_email_worker_batch_idle disabled=%s", result.disabled
                )

            if self.stop_event.is_set():
                break
            if result.claimed == 0:
                self.stop_event.wait(self.polling_interval_seconds)

        logger.info("customer_email_worker_stopped")
