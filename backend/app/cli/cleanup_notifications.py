import sys

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.database.session import SessionLocal
from app.repositories.notification import NotificationRepository
from app.services.notification import NotificationRetentionService
from app.utils.time import utc_now_naive


def run() -> int:
    as_of = utc_now_naive()
    deleted_total = 0

    try:
        with SessionLocal() as db:
            service = NotificationRetentionService(
                db,
                NotificationRepository(db),
                retention_days=settings.notification_retention_days,
                batch_size=settings.notification_cleanup_batch_size,
            )
            for _ in range(settings.notification_cleanup_max_batches):
                deleted_count = service.cleanup_expired_batch(as_of=as_of)
                deleted_total += deleted_count
                if deleted_count < settings.notification_cleanup_batch_size:
                    break
    except SQLAlchemyError as error:
        print(f"Notification cleanup failed: {error}", file=sys.stderr)
        return 1

    print(f"Deleted {deleted_total} expired notifications.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
