from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.security import (
    AccessTokenManager,
    InvalidAccessTokenError,
    PasswordHasher,
    TokenPurpose,
)
from app.exceptions.auth import (
    AuthenticationError,
    PasswordConfirmationMismatchError,
    PasswordReuseError,
)
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.auth import (
    AuthSessionResponse,
    AuthSessionStateResponse,
    CompletePasswordChangeRequest,
    LoginRequest,
    SessionType,
)
from app.utils.time import utc_now_naive


@dataclass(frozen=True)
class AuthenticatedSession:
    user: User
    purpose: TokenPurpose
    auth_version: int


class AuthenticationService:
    def __init__(
        self,
        db: Session,
        user_repository: UserRepository,
        password_hasher: PasswordHasher,
        access_token_manager: AccessTokenManager,
    ) -> None:
        self.db = db
        self.user_repository = user_repository
        self.password_hasher = password_hasher
        self.access_token_manager = access_token_manager

    def login(self, data: LoginRequest) -> AuthSessionResponse:
        user = self.user_repository.get_by_email(data.email)
        supplied_password = data.password.get_secret_value()

        if user is None:
            self.password_hasher.verify_dummy(supplied_password)
            raise AuthenticationError

        if not self.password_hasher.verify(
            supplied_password,
            user.password_hash,
        ):
            raise AuthenticationError

        if not user.is_active:
            raise AuthenticationError

        purpose = (
            TokenPurpose.PASSWORD_CHANGE
            if user.must_change_password
            else TokenPurpose.ACCESS
        )
        return self._response(user, purpose)

    def authenticate_session(self, token: str) -> AuthenticatedSession:
        try:
            claims = self.access_token_manager.decode(token)
        except InvalidAccessTokenError as error:
            raise AuthenticationError from error

        user = self.user_repository.get_by_id(claims.user_id)
        if (
            user is None
            or not user.is_active
            or user.auth_version != claims.auth_version
        ):
            raise AuthenticationError

        return AuthenticatedSession(
            user=user,
            purpose=claims.purpose,
            auth_version=claims.auth_version,
        )

    def complete_password_change(
        self,
        data: CompletePasswordChangeRequest,
        session: AuthenticatedSession,
    ) -> AuthSessionResponse:
        new_password = data.new_password.get_secret_value()
        confirmation = data.confirm_new_password.get_secret_value()
        if new_password != confirmation:
            raise PasswordConfirmationMismatchError

        candidate_hash = self.password_hasher.hash(new_password)
        try:
            user = self.user_repository.get_by_id_for_update(session.user.id)
            if (
                user is None
                or not user.is_active
                or session.purpose != TokenPurpose.PASSWORD_CHANGE
                or user.auth_version != session.auth_version
                or not user.must_change_password
            ):
                raise AuthenticationError

            if self.password_hasher.verify(new_password, user.password_hash):
                raise PasswordReuseError

            user.password_hash = candidate_hash
            user.must_change_password = False
            user.auth_version += 1
            user.updated_at = utc_now_naive()
            user = self.user_repository.save(user)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        return self._response(user, TokenPurpose.ACCESS)

    def restore_session(
        self,
        session: AuthenticatedSession,
    ) -> AuthSessionStateResponse:
        session_type = (
            SessionType.PASSWORD_CHANGE_REQUIRED
            if session.user.must_change_password
            else SessionType.NORMAL
        )
        return AuthSessionStateResponse(
            session_type=session_type,
            user=session.user,
        )

    def _response(
        self,
        user: User,
        purpose: TokenPurpose,
    ) -> AuthSessionResponse:
        session_type = (
            SessionType.NORMAL
            if purpose == TokenPurpose.ACCESS
            else SessionType.PASSWORD_CHANGE_REQUIRED
        )
        return AuthSessionResponse(
            access_token=self.access_token_manager.create(
                user.id,
                purpose=purpose,
                auth_version=user.auth_version,
            ),
            session_type=session_type,
            user=user,
        )
