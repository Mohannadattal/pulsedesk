import logging
import traceback
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.exceptions.auth import (
    AuthenticationError,
    AuthorizationError,
    PasswordConfirmationMismatchError,
    PasswordReuseError,
)
from app.exceptions.category import (
    CategoryAlreadyExistsError,
    CategoryNotFoundError,
    InactiveCategoryError,
)
from app.exceptions.customer import (
    CustomerContactRequiredError,
    CustomerNotFoundError,
    CustomerNumberAllocationError,
    CustomerPotentialDuplicateError,
    CustomerVerificationFactorUnavailableError,
    CustomerVerificationInvalidError,
    CustomerVerificationNotFoundError,
    InactiveCustomerError,
)
from app.exceptions.database import (
    DatabaseFailureKind,
    classify_database_error,
    get_mysql_error_code,
)
from app.exceptions.password_reset_request import (
    PasswordResetRequestNotFoundError,
    PasswordResetRequestResolvedError,
    PasswordResetTargetInactiveError,
)
from app.exceptions.ticket import (
    InvalidTicketAssigneeError,
    InvalidTicketFilterError,
    InvalidTicketStatusTransitionError,
    TicketNotFoundError,
    TicketNumberAllocationError,
)
from app.exceptions.user import (
    LastActiveAdminRequiredError,
    UserAlreadyExistsError,
    UserNotFoundError,
    UserSelfDeactivationForbiddenError,
)
from app.schemas.error import ErrorCode

logger = logging.getLogger(__name__)

INTERNAL_ERROR_DETAIL = "An unexpected error occurred."
SERVICE_UNAVAILABLE_DETAIL = "Service temporarily unavailable."

FRAMEWORK_ERROR_DETAILS: dict[int, tuple[ErrorCode, str]] = {
    status.HTTP_400_BAD_REQUEST: (ErrorCode.BAD_REQUEST, "Bad request."),
    status.HTTP_401_UNAUTHORIZED: (
        ErrorCode.AUTHENTICATION_FAILED,
        "Could not validate credentials.",
    ),
    status.HTTP_403_FORBIDDEN: (ErrorCode.FORBIDDEN, "Insufficient permissions."),
    status.HTTP_404_NOT_FOUND: (ErrorCode.NOT_FOUND, "Resource was not found."),
    status.HTTP_405_METHOD_NOT_ALLOWED: (
        ErrorCode.METHOD_NOT_ALLOWED,
        "Method not allowed.",
    ),
}

DOMAIN_ERROR_DETAILS: dict[type[Exception], tuple[int, ErrorCode, str]] = {
    UserAlreadyExistsError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.USER_ALREADY_EXISTS,
        "A user with this email already exists.",
    ),
    UserNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        "User was not found.",
    ),
    UserSelfDeactivationForbiddenError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.USER_SELF_DEACTIVATION_FORBIDDEN,
        "Administrators cannot deactivate their own account.",
    ),
    LastActiveAdminRequiredError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.LAST_ACTIVE_ADMIN_REQUIRED,
        "At least one administrator must remain active.",
    ),
    PasswordConfirmationMismatchError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.PASSWORD_CONFIRMATION_MISMATCH,
        "Password confirmation does not match.",
    ),
    PasswordReuseError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.PASSWORD_REUSE_NOT_ALLOWED,
        "The new password must differ from the temporary password.",
    ),
    PasswordResetRequestNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.PASSWORD_RESET_REQUEST_NOT_FOUND,
        "Password reset request was not found.",
    ),
    PasswordResetRequestResolvedError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.PASSWORD_RESET_REQUEST_RESOLVED,
        "Password reset request has already been resolved.",
    ),
    PasswordResetTargetInactiveError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.PASSWORD_RESET_TARGET_INACTIVE,
        "Password reset target is inactive.",
    ),
    CategoryNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CATEGORY_NOT_FOUND,
        "Category was not found.",
    ),
    CategoryAlreadyExistsError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATEGORY_ALREADY_EXISTS,
        "A category with this name already exists.",
    ),
    InactiveCategoryError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CATEGORY_INACTIVE,
        "Category is inactive.",
    ),
    TicketNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.TICKET_NOT_FOUND,
        "Ticket was not found.",
    ),
    InvalidTicketStatusTransitionError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.INVALID_TICKET_STATUS_TRANSITION,
        "Invalid ticket status transition.",
    ),
    InvalidTicketAssigneeError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.INVALID_TICKET_ASSIGNEE,
        "Ticket assignee is invalid.",
    ),
    InvalidTicketFilterError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.INVALID_TICKET_FILTER,
        "Ticket filters are invalid.",
    ),
    CustomerNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CUSTOMER_NOT_FOUND,
        "Customer was not found.",
    ),
    InactiveCustomerError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CUSTOMER_INACTIVE,
        "Customer is inactive.",
    ),
    CustomerContactRequiredError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CUSTOMER_CONTACT_REQUIRED,
        "At least one customer contact method is required.",
    ),
    CustomerPotentialDuplicateError: (
        status.HTTP_409_CONFLICT,
        ErrorCode.CUSTOMER_POTENTIAL_DUPLICATE,
        "A potential duplicate customer requires explicit confirmation.",
    ),
    CustomerVerificationNotFoundError: (
        status.HTTP_404_NOT_FOUND,
        ErrorCode.CUSTOMER_VERIFICATION_NOT_FOUND,
        "Customer verification was not found.",
    ),
    CustomerVerificationInvalidError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CUSTOMER_VERIFICATION_INVALID,
        "Customer verification is not valid for this ticket.",
    ),
    CustomerVerificationFactorUnavailableError: (
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        ErrorCode.CUSTOMER_VERIFICATION_FACTOR_UNAVAILABLE,
        "A selected verification factor is unavailable.",
    ),
}


def _error_response(
    *,
    status_code: int,
    code: ErrorCode,
    detail: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code.value, "detail": detail},
        headers=headers,
    )


def _log_expected_error(
    request: Request,
    code: ErrorCode,
    *,
    level: int = logging.DEBUG,
) -> None:
    logger.log(
        level,
        "Request rejected with %s (method=%s, path=%s)",
        code.value,
        request.method,
        request.url.path,
    )


def _safe_traceback(exc: Exception) -> str:
    parts: list[str] = []
    current: Exception | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        parts.append(f"{type(current).__module__}.{type(current).__qualname__}\n")
        parts.extend(traceback.format_tb(current.__traceback__))
        next_exception = current.__cause__ or current.__context__
        current = next_exception if isinstance(next_exception, Exception) else None
    return "".join(parts).rstrip()


def _safe_validation_errors(exc: RequestValidationError) -> list[dict[str, Any]]:
    sanitized_errors: list[dict[str, Any]] = []
    for error in exc.errors():
        location = [
            part if isinstance(part, (str, int)) else str(part)
            for part in error.get("loc", ())
        ]
        sanitized_errors.append(
            {
                "location": location,
                "message": str(error.get("msg", "Invalid input.")),
                "type": str(error.get("type", "validation_error")),
            }
        )
    return sanitized_errors


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        _log_expected_error(request, ErrorCode.VALIDATION_ERROR)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "code": ErrorCode.VALIDATION_ERROR.value,
                "detail": "Request validation failed.",
                "errors": _safe_validation_errors(exc),
            },
        )

    @app.exception_handler(AuthenticationError)
    async def handle_authentication_error(
        request: Request,
        exc: AuthenticationError,
    ) -> JSONResponse:
        _log_expected_error(
            request,
            ErrorCode.AUTHENTICATION_FAILED,
            level=logging.INFO,
        )
        return _error_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code=ErrorCode.AUTHENTICATION_FAILED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.exception_handler(AuthorizationError)
    async def handle_authorization_error(
        request: Request,
        exc: AuthorizationError,
    ) -> JSONResponse:
        _log_expected_error(request, ErrorCode.FORBIDDEN, level=logging.INFO)
        return _error_response(
            status_code=status.HTTP_403_FORBIDDEN,
            code=ErrorCode.FORBIDDEN,
            detail="Insufficient permissions.",
        )

    async def handle_domain_error(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        status_code, error_code, detail = DOMAIN_ERROR_DETAILS[type(exc)]
        _log_expected_error(request, error_code)
        return _error_response(
            status_code=status_code,
            code=error_code,
            detail=detail,
        )

    for exception_type in DOMAIN_ERROR_DETAILS:
        app.add_exception_handler(exception_type, handle_domain_error)

    @app.exception_handler(TicketNumberAllocationError)
    async def handle_ticket_number_allocation_error(
        request: Request,
        exc: TicketNumberAllocationError,
    ) -> JSONResponse:
        logger.error(
            "Ticket-number allocation exhausted after %s attempts "
            "(method=%s, path=%s)\n%s",
            exc.attempt_count,
            request.method,
            request.url.path,
            _safe_traceback(exc),
        )
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            detail=INTERNAL_ERROR_DETAIL,
        )

    @app.exception_handler(CustomerNumberAllocationError)
    async def handle_customer_number_allocation_error(
        request: Request,
        exc: CustomerNumberAllocationError,
    ) -> JSONResponse:
        logger.error(
            "Customer-number allocation exhausted after %s attempts "
            "(method=%s, path=%s)\n%s",
            exc.attempt_count,
            request.method,
            request.url.path,
            _safe_traceback(exc),
        )
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            detail=INTERNAL_ERROR_DETAIL,
        )

    @app.exception_handler(SQLAlchemyError)
    async def handle_sqlalchemy_error(
        request: Request,
        exc: SQLAlchemyError,
    ) -> JSONResponse:
        failure_kind = classify_database_error(exc)
        mysql_error_code = get_mysql_error_code(exc)
        logger.error(
            "Database failure classified as %s "
            "(exception=%s, mysql_code=%s, connection_invalidated=%s, "
            "method=%s, path=%s)\n%s",
            failure_kind.value,
            type(exc).__name__,
            mysql_error_code,
            getattr(exc, "connection_invalidated", False),
            request.method,
            request.url.path,
            _safe_traceback(exc),
        )

        if failure_kind in {
            DatabaseFailureKind.AVAILABILITY,
            DatabaseFailureKind.CONTENTION,
        }:
            return _error_response(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code=ErrorCode.SERVICE_UNAVAILABLE,
                detail=SERVICE_UNAVAILABLE_DETAIL,
            )
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            detail=INTERNAL_ERROR_DETAIL,
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        error_code, detail = FRAMEWORK_ERROR_DETAILS.get(
            exc.status_code,
            (
                ErrorCode.HTTP_ERROR,
                _http_status_detail(exc.status_code),
            ),
        )
        _log_expected_error(
            request,
            error_code,
            level=(
                logging.ERROR
                if exc.status_code >= status.HTTP_500_INTERNAL_SERVER_ERROR
                else logging.DEBUG
            ),
        )
        return _error_response(
            status_code=exc.status_code,
            code=error_code,
            detail=detail,
            headers=dict(exc.headers) if exc.headers is not None else None,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.error(
            "Unexpected application failure (exception=%s, method=%s, path=%s)\n%s",
            type(exc).__name__,
            request.method,
            request.url.path,
            _safe_traceback(exc),
        )
        return _error_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_ERROR,
            detail=INTERNAL_ERROR_DETAIL,
        )


def _http_status_detail(status_code: int) -> str:
    try:
        return f"{HTTPStatus(status_code).phrase}."
    except ValueError:
        return "Request failed."
