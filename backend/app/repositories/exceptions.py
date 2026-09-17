import re

from sqlalchemy.exc import IntegrityError


MYSQL_DUPLICATE_ENTRY_ERROR_CODE = 1062


def is_mysql_duplicate_constraint(
    error: IntegrityError,
    constraint_name: str,
) -> bool:
    """Return whether MySQL reported a duplicate for a named unique constraint."""
    original_error_arguments = getattr(error.orig, "args", ())
    if (
        len(original_error_arguments) < 2
        or original_error_arguments[0] != MYSQL_DUPLICATE_ENTRY_ERROR_CODE
    ):
        return False

    message = str(original_error_arguments[1])
    constraint_pattern = rf"for key ['`](?:[^'`]+\.)?{re.escape(constraint_name)}['`]"
    return re.search(constraint_pattern, message) is not None


class DuplicateUserEmailError(Exception):
    """Raised when persistence rejects a duplicate user email."""


class DuplicateCategoryNameError(Exception):
    """Raised when persistence rejects a duplicate category name."""


class DuplicateTicketNumberError(Exception):
    """Raised when persistence rejects a duplicate ticket number."""


class DuplicatePendingPasswordResetRequestError(Exception):
    """Raised when a pending reset request already exists for the user."""
