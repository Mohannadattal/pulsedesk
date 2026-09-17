class PasswordResetRequestNotFoundError(Exception):
    """Raised when a reset request ID does not exist."""


class PasswordResetRequestResolvedError(Exception):
    """Raised when an administrator attempts to resolve a completed request."""


class PasswordResetTargetInactiveError(Exception):
    """Raised when the subject account is no longer eligible for reset."""
