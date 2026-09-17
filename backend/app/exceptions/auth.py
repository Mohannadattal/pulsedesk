class AuthenticationError(Exception):
    """Raised when credentials or an access token cannot be authenticated."""


class AuthorizationError(Exception):
    """Raised when an authenticated user lacks a required role or ownership."""


class PasswordConfirmationMismatchError(Exception):
    """Raised when a password and its confirmation differ."""


class PasswordReuseError(Exception):
    """Raised when mandatory replacement reuses the temporary password."""
