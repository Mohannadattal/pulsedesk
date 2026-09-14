from collections.abc import Callable
from typing import Annotated

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.dependencies.services import get_authentication_service
from app.exceptions.auth import AuthenticationError, AuthorizationError
from app.models.user import User, UserRole
from app.services.auth import AuthenticationService


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    authentication_service: Annotated[
        AuthenticationService,
        Depends(get_authentication_service),
    ],
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AuthenticationError

    return authentication_service.authenticate_access_token(credentials.credentials)


def require_roles(*allowed_roles: UserRole) -> Callable[..., User]:
    allowed_role_values = frozenset(role.value for role in allowed_roles)

    def authorize_role(
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.role not in allowed_role_values:
            raise AuthorizationError
        return current_user

    return authorize_role


def require_self_or_roles(*allowed_roles: UserRole) -> Callable[..., User]:
    allowed_role_values = frozenset(role.value for role in allowed_roles)

    def authorize_user_access(
        user_id: int,
        current_user: Annotated[User, Depends(get_current_user)],
    ) -> User:
        if current_user.id != user_id and current_user.role not in allowed_role_values:
            raise AuthorizationError
        return current_user

    return authorize_user_access
