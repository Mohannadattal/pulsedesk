from datetime import UTC, datetime, timedelta

import jwt
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash


class PasswordHasher:
    def __init__(self) -> None:
        self._password_hash = PasswordHash.recommended()
        self._dummy_hash = self._password_hash.hash(
            "pulsedesk-authentication-timing-placeholder"
        )

    def hash(self, password: str) -> str:
        return self._password_hash.hash(password)

    def verify(self, password: str, password_hash: str) -> bool:
        return self._password_hash.verify(password, password_hash)

    def verify_dummy(self, password: str) -> None:
        """Perform equivalent hash work when no user record was found."""
        self.verify(password, self._dummy_hash)


class InvalidAccessTokenError(Exception):
    """Raised when an access token cannot be securely validated."""


class AccessTokenManager:
    def __init__(
        self,
        secret: str,
        algorithm: str,
        lifetime: timedelta,
    ) -> None:
        self._secret = secret
        self._algorithm = algorithm
        self._lifetime = lifetime

    def create(self, user_id: int) -> str:
        expires_at = datetime.now(UTC) + self._lifetime
        return jwt.encode(
            {"sub": str(user_id), "exp": expires_at},
            self._secret,
            algorithm=self._algorithm,
        )

    def get_subject(self, token: str) -> int:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                options={"require": ["sub", "exp"]},
            )
            subject = payload["sub"]
            if not isinstance(subject, str) or not subject.isdecimal():
                raise InvalidAccessTokenError

            user_id = int(subject)
            if user_id < 1:
                raise InvalidAccessTokenError
            return user_id
        except (InvalidTokenError, KeyError, ValueError, TypeError) as error:
            raise InvalidAccessTokenError from error


password_hasher = PasswordHasher()
