class AuthenticationError(Exception):
    """Raised when credentials or an access token cannot be authenticated."""


class AuthorizationError(Exception):
    """Raised when an authenticated user lacks a required role or ownership."""
