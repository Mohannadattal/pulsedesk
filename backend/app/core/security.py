from datetime import UTC, datetime, timedelta
from dataclasses import dataclass
from enum import StrEnum

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


class TokenPurpose(StrEnum):
    ACCESS = "ACCESS"
    PASSWORD_CHANGE = "PASSWORD_CHANGE"


@dataclass(frozen=True)
class AccessTokenClaims:
    user_id: int
    purpose: TokenPurpose
    auth_version: int


class AccessTokenManager:
    def __init__(
        self,
        secret: str,
        algorithm: str,
        access_lifetime: timedelta,
        password_change_lifetime: timedelta,
    ) -> None:
        self._secret = secret
        self._algorithm = algorithm
        self._lifetimes = {
            TokenPurpose.ACCESS: access_lifetime,
            TokenPurpose.PASSWORD_CHANGE: password_change_lifetime,
        }

    def create(
        self,
        user_id: int,
        *,
        purpose: TokenPurpose = TokenPurpose.ACCESS,
        auth_version: int = 0,
    ) -> str:
        expires_at = datetime.now(UTC) + self._lifetimes[purpose]
        return jwt.encode(
            {
                "sub": str(user_id),
                "exp": expires_at,
                "purpose": purpose.value,
                "auth_version": auth_version,
            },
            self._secret,
            algorithm=self._algorithm,
        )

    def decode(self, token: str) -> AccessTokenClaims:
        try:
            payload = jwt.decode(
                token,
                self._secret,
                algorithms=[self._algorithm],
                options={
                    "require": ["sub", "exp", "purpose", "auth_version"],
                },
            )
            subject = payload["sub"]
            if not isinstance(subject, str) or not subject.isdecimal():
                raise InvalidAccessTokenError

            user_id = int(subject)
            if user_id < 1:
                raise InvalidAccessTokenError

            purpose = TokenPurpose(payload["purpose"])
            auth_version = payload["auth_version"]
            if (
                not isinstance(auth_version, int)
                or isinstance(auth_version, bool)
                or auth_version < 0
            ):
                raise InvalidAccessTokenError
            return AccessTokenClaims(
                user_id=user_id,
                purpose=purpose,
                auth_version=auth_version,
            )
        except (InvalidTokenError, KeyError, ValueError, TypeError) as error:
            raise InvalidAccessTokenError from error


password_hasher = PasswordHasher()
