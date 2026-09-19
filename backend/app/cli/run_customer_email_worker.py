import logging
import signal

from app.core.config import settings
from app.database.session import SessionLocal
from app.services.customer_email_runtime import ConfiguredCustomerEmailBatchProcessor
from app.services.customer_email_worker import CustomerEmailWorker


def run() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    worker = CustomerEmailWorker(
        process_batch=ConfiguredCustomerEmailBatchProcessor(
            config=settings,
            session_factory=SessionLocal,
        ),
        polling_interval_seconds=settings.email_delivery_poll_interval_seconds,
    )

    def request_shutdown(signum: int, _frame: object) -> None:
        logging.getLogger(__name__).info(
            "customer_email_worker_shutdown_requested signal=%d", signum
        )
        worker.request_shutdown()

    signal.signal(signal.SIGTERM, request_shutdown)
    signal.signal(signal.SIGINT, request_shutdown)
    worker.run(delivery_enabled=settings.email_delivery_enabled)
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
