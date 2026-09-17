from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.dependencies.auth import require_roles
from app.dependencies.services import get_customer_service, get_ticket_service
from app.models.user import User, UserRole
from app.schemas.customer import (
    CustomerActivationUpdate,
    CustomerCreate,
    CustomerDirectoryFilters,
    CustomerDirectoryListResponse,
    CustomerProfileResponse,
    CustomerSearchRequest,
    CustomerUpdate,
    CustomerVerificationCreate,
    CustomerVerificationResponse,
)
from app.schemas.error import ErrorResponse, ValidationErrorResponse
from app.schemas.ticket import TicketListFilters, TicketListResponse
from app.services.customer import CustomerService
from app.services.ticket import TicketService

router = APIRouter(prefix="/customers", tags=["Customers"])

AUTH_RESPONSES = {
    status.HTTP_401_UNAUTHORIZED: {
        "description": "Authentication is required.",
        "model": ErrorResponse,
    },
    status.HTTP_403_FORBIDDEN: {
        "description": "Employee or administrator access is required.",
        "model": ErrorResponse,
    },
}


@router.post(
    "",
    response_model=CustomerProfileResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="create_customer",
    responses={**AUTH_RESPONSES, status.HTTP_409_CONFLICT: {"model": ErrorResponse}},
)
def create_customer(
    data: CustomerCreate,
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerProfileResponse:
    return customer_service.create_customer(data, current_user)


@router.get(
    "",
    response_model=CustomerDirectoryListResponse,
    operation_id="list_customers",
    responses=AUTH_RESPONSES,
)
def list_customers(
    filters: Annotated[CustomerDirectoryFilters, Depends()],
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerDirectoryListResponse:
    return customer_service.list_customers(filters, current_user)


@router.post(
    "/search",
    response_model=CustomerDirectoryListResponse,
    operation_id="search_customers",
    responses={
        **AUTH_RESPONSES,
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "model": ErrorResponse | ValidationErrorResponse
        },
    },
)
def search_customers(
    data: CustomerSearchRequest,
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerDirectoryListResponse:
    return customer_service.search_customers(data, current_user)


@router.get(
    "/{customer_id}",
    response_model=CustomerProfileResponse,
    operation_id="get_customer",
    responses={**AUTH_RESPONSES, status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
)
def get_customer(
    customer_id: Annotated[int, Path(gt=0)],
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerProfileResponse:
    return customer_service.get_customer(customer_id, current_user)


@router.patch(
    "/{customer_id}",
    response_model=CustomerProfileResponse,
    operation_id="update_customer",
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation failed or a Customer contact method is required.",
            "model": ErrorResponse | ValidationErrorResponse,
        },
    },
)
def update_customer(
    customer_id: Annotated[int, Path(gt=0)],
    data: CustomerUpdate,
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerProfileResponse:
    return customer_service.update_customer(customer_id, data, current_user)


@router.patch(
    "/{customer_id}/activation",
    response_model=CustomerProfileResponse,
    operation_id="update_customer_activation",
    responses={**AUTH_RESPONSES, status.HTTP_404_NOT_FOUND: {"model": ErrorResponse}},
)
def update_customer_activation(
    customer_id: Annotated[int, Path(gt=0)],
    data: CustomerActivationUpdate,
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[User, Depends(require_roles(UserRole.ADMIN))],
) -> CustomerProfileResponse:
    return customer_service.update_activation(customer_id, data.is_active, current_user)


@router.post(
    "/{customer_id}/verifications",
    response_model=CustomerVerificationResponse,
    status_code=status.HTTP_201_CREATED,
    operation_id="create_customer_verification",
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_409_CONFLICT: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation failed or a verification factor is unavailable.",
            "model": ErrorResponse | ValidationErrorResponse,
        },
    },
)
def create_customer_verification(
    customer_id: Annotated[int, Path(gt=0)],
    data: CustomerVerificationCreate,
    customer_service: Annotated[CustomerService, Depends(get_customer_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> CustomerVerificationResponse:
    return customer_service.create_verification(customer_id, data, current_user)


@router.get(
    "/{customer_id}/tickets",
    response_model=TicketListResponse,
    operation_id="list_customer_tickets",
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {"model": ErrorResponse},
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation or ticket filters are invalid.",
            "model": ErrorResponse | ValidationErrorResponse,
        },
    },
)
def list_customer_tickets(
    customer_id: Annotated[int, Path(gt=0)],
    filters: Annotated[TicketListFilters, Depends()],
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[
        User, Depends(require_roles(UserRole.EMPLOYEE, UserRole.ADMIN))
    ],
) -> TicketListResponse:
    return ticket_service.list_customer_tickets(customer_id, filters, current_user)
