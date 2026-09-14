from datetime import UTC, datetime


def utc_now_naive() -> datetime:
    """Return the current UTC time using the persistence layer's naive convention."""

    return datetime.now(UTC).replace(tzinfo=None)
