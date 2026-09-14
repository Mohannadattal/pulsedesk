from app.core.security import (
    AccessTokenManager,
    InvalidAccessTokenError,
    PasswordHasher,
)
from app.exceptions.auth import AuthenticationError
from app.models.user import User
from app.repositories.user import UserRepository
from app.schemas.auth import AccessTokenResponse, LoginRequest


class AuthenticationService:
    def __init__(
        self,
        user_repository: UserRepository,
        password_hasher: PasswordHasher,
        access_token_manager: AccessTokenManager,
    ) -> None:
        self.user_repository = user_repository
        self.password_hasher = password_hasher
        self.access_token_manager = access_token_manager

    def login(self, data: LoginRequest) -> AccessTokenResponse:
        user = self.user_repository.get_by_email(data.email)

        if user is None:
            self.password_hasher.verify_dummy(data.password)
            raise AuthenticationError

        if not self.password_hasher.verify(data.password, user.password_hash):
            raise AuthenticationError

        if not user.is_active:
            raise AuthenticationError

        return AccessTokenResponse(
            access_token=self.access_token_manager.create(user.id),
        )

    def authenticate_access_token(self, token: str) -> User:
        try:
            user_id = self.access_token_manager.get_subject(token)
        except InvalidAccessTokenError as error:
            raise AuthenticationError from error

        user = self.user_repository.get_by_id(user_id)
        if user is None or not user.is_active:
            raise AuthenticationError

        return user
