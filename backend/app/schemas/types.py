from datetime import UTC, datetime
from typing import Annotated

from pydantic import PlainSerializer, WithJsonSchema


def serialize_utc_datetime(value: datetime) -> str:
    """Serialize an application UTC datetime with an explicit UTC designator."""

    utc_value = (
        value.replace(tzinfo=UTC)
        if value.tzinfo is None
        else value.astimezone(UTC)
    )
    return utc_value.isoformat().replace("+00:00", "Z")


UtcDateTime = Annotated[
    datetime,
    PlainSerializer(
        serialize_utc_datetime,
        return_type=str,
        when_used="json",
    ),
    WithJsonSchema(
        {"type": "string", "format": "date-time"},
        mode="serialization",
    ),
]
