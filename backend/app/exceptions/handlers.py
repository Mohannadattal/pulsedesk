from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from app.exceptions.auth import AuthenticationError, AuthorizationError
from app.exceptions.user import (
    UserAlreadyExistsError,
    UserNotFoundError,
)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AuthenticationError)
    async def handle_authentication_error(
        request: Request,
        exc: AuthenticationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Could not validate credentials."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(AuthorizationError)
    async def handle_authorization_error(
        request: Request,
        exc: AuthorizationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Insufficient permissions."},
        )

    @app.exception_handler(UserAlreadyExistsError)
    async def handle_user_already_exists(
        request: Request,
        exc: UserAlreadyExistsError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": str(exc)},
        )

    @app.exception_handler(UserNotFoundError)
    async def handle_user_not_found(
        request: Request,
        exc: UserNotFoundError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": str(exc)},
        )
