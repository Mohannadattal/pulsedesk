from enum import StrEnum

from pymysql import err as pymysql_errors
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError


MYSQL_AVAILABILITY_ERROR_CODES = frozenset(
    {
        1040,  # Too many connections.
        1203,  # User connection limit reached.
        2002,  # Local connection failure.
        2003,  # Cannot connect to server.
        2005,  # Unknown server host.
        2006,  # Server has gone away.
        2013,  # Connection lost during query.
    }
)
MYSQL_CONTENTION_ERROR_CODES = frozenset(
    {
        1205,  # Lock wait timeout.
        1213,  # Deadlock.
    }
)


class DatabaseFailureKind(StrEnum):
    AVAILABILITY = "availability"
    CONTENTION = "contention"
    INTERNAL = "internal"


def get_mysql_error_code(error: SQLAlchemyError) -> int | None:
    if not isinstance(error, DBAPIError):
        return None

    arguments = getattr(error.orig, "args", ())
    if arguments and isinstance(arguments[0], int):
        return arguments[0]
    return None


def classify_database_error(error: SQLAlchemyError) -> DatabaseFailureKind:
    if isinstance(error, SQLAlchemyTimeoutError):
        return DatabaseFailureKind.AVAILABILITY

    if not isinstance(error, DBAPIError):
        return DatabaseFailureKind.INTERNAL

    if error.connection_invalidated:
        return DatabaseFailureKind.AVAILABILITY

    if not isinstance(
        error.orig,
        (pymysql_errors.InterfaceError, pymysql_errors.OperationalError),
    ):
        return DatabaseFailureKind.INTERNAL

    mysql_error_code = get_mysql_error_code(error)
    if mysql_error_code in MYSQL_CONTENTION_ERROR_CODES:
        return DatabaseFailureKind.CONTENTION

    if mysql_error_code in MYSQL_AVAILABILITY_ERROR_CODES:
        return DatabaseFailureKind.AVAILABILITY

    return DatabaseFailureKind.INTERNAL
