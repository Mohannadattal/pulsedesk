import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.database.session import SessionLocal
from app.services.customer_email_runtime import ConfiguredCustomerEmailBatchProcessor


def run() -> int:
    if not settings.email_delivery_enabled:
        print("Customer email delivery is disabled; no deliveries were claimed.")
        return 0

    try:
        result = ConfiguredCustomerEmailBatchProcessor(
            config=settings,
            session_factory=SessionLocal,
        )()
    except SQLAlchemyError:
        print(
            "Customer email processing failed because the database is unavailable.",
            file=sys.stderr,
        )
        return 1

    print(
        "Customer email batch complete: "
        f"claimed={result.claimed}, sent={result.sent}, "
        f"retry_scheduled={result.retry_scheduled}, "
        f"terminal_failed={result.terminal_failed}, "
        f"stale_terminalized={result.stale_terminalized}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
