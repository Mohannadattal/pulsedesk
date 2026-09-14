from typing import Annotated

from fastapi import APIRouter, Depends, Path, status

from app.dependencies.auth import get_current_user
from app.dependencies.services import (
    get_ticket_comment_service,
    get_ticket_event_service,
    get_ticket_service,
)
from app.models.user import User
from app.schemas.error import ErrorResponse, ValidationErrorResponse
from app.schemas.ticket import (
    TicketAssignmentUpdate,
    TicketCategoryUpdate,
    TicketCreate,
    TicketListFilters,
    TicketListResponse,
    TicketPriorityUpdate,
    TicketResponse,
    TicketStatusUpdate,
)
from app.schemas.ticket_comment import (
    TicketCommentCreate,
    TicketCommentListFilters,
    TicketCommentListResponse,
    TicketCommentResponse,
)
from app.schemas.ticket_event import TicketEventListFilters, TicketEventListResponse
from app.services.ticket import TicketService
from app.services.ticket_comment import TicketCommentService
from app.services.ticket_event import TicketEventService


router = APIRouter(prefix="/tickets", tags=["Tickets"])

AUTH_RESPONSES = {
    status.HTTP_401_UNAUTHORIZED: {
        "description": "Authentication is required.",
        "model": ErrorResponse,
    },
    status.HTTP_403_FORBIDDEN: {
        "description": "Insufficient ticket permissions.",
        "model": ErrorResponse,
    },
}


@router.post(
    "",
    response_model=TicketResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Category not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "Category is inactive.",
            "model": ErrorResponse,
        },
    },
)
def create_ticket(
    data: TicketCreate,
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.create_ticket(data, current_user)


@router.get(
    "",
    response_model=TicketListResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation or ticket filters are invalid.",
            "model": ErrorResponse | ValidationErrorResponse,
        },
    },
)
def list_tickets(
    filters: Annotated[TicketListFilters, Depends()],
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketListResponse:
    return ticket_service.list_tickets(filters, current_user)


@router.get(
    "/{ticket_id}",
    response_model=TicketResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Visible ticket not found.",
            "model": ErrorResponse,
        },
    },
)
def get_ticket(
    ticket_id: Annotated[int, Path(gt=0)],
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.get_ticket(ticket_id, current_user)


@router.post(
    "/{ticket_id}/comments",
    response_model=TicketCommentResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Visible ticket not found.",
            "model": ErrorResponse,
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation failed.",
            "model": ValidationErrorResponse,
        },
    },
)
def create_ticket_comment(
    ticket_id: Annotated[int, Path(gt=0)],
    data: TicketCommentCreate,
    ticket_comment_service: Annotated[
        TicketCommentService,
        Depends(get_ticket_comment_service),
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketCommentResponse:
    return ticket_comment_service.create_comment(ticket_id, data, current_user)


@router.get(
    "/{ticket_id}/comments",
    response_model=TicketCommentListResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Visible ticket not found.",
            "model": ErrorResponse,
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation failed.",
            "model": ValidationErrorResponse,
        },
    },
)
def list_ticket_comments(
    ticket_id: Annotated[int, Path(gt=0)],
    filters: Annotated[TicketCommentListFilters, Depends()],
    ticket_comment_service: Annotated[
        TicketCommentService,
        Depends(get_ticket_comment_service),
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketCommentListResponse:
    return ticket_comment_service.list_comments(ticket_id, filters, current_user)


@router.get(
    "/{ticket_id}/events",
    response_model=TicketEventListResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Visible ticket not found.",
            "model": ErrorResponse,
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation failed.",
            "model": ValidationErrorResponse,
        },
    },
)
def list_ticket_events(
    ticket_id: Annotated[int, Path(gt=0)],
    filters: Annotated[TicketEventListFilters, Depends()],
    ticket_event_service: Annotated[
        TicketEventService,
        Depends(get_ticket_event_service),
    ],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketEventListResponse:
    return ticket_event_service.list_events(ticket_id, filters, current_user)


@router.patch(
    "/{ticket_id}/assignment",
    response_model=TicketResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Ticket not found.",
            "model": ErrorResponse,
        },
        status.HTTP_422_UNPROCESSABLE_CONTENT: {
            "description": "Request validation or ticket assignee is invalid.",
            "model": ErrorResponse | ValidationErrorResponse,
        },
    },
)
def update_ticket_assignment(
    ticket_id: Annotated[int, Path(gt=0)],
    data: TicketAssignmentUpdate,
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.update_assignment(
        ticket_id,
        data.assigned_to_id,
        current_user,
    )


@router.patch(
    "/{ticket_id}/priority",
    response_model=TicketResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Ticket not found.",
            "model": ErrorResponse,
        },
    },
)
def update_ticket_priority(
    ticket_id: Annotated[int, Path(gt=0)],
    data: TicketPriorityUpdate,
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.update_priority(ticket_id, data.priority, current_user)


@router.patch(
    "/{ticket_id}/status",
    response_model=TicketResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Ticket not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "Invalid status transition.",
            "model": ErrorResponse,
        },
    },
)
def update_ticket_status(
    ticket_id: Annotated[int, Path(gt=0)],
    data: TicketStatusUpdate,
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.update_status(ticket_id, data.status, current_user)


@router.patch(
    "/{ticket_id}/category",
    response_model=TicketResponse,
    responses={
        **AUTH_RESPONSES,
        status.HTTP_404_NOT_FOUND: {
            "description": "Ticket or category not found.",
            "model": ErrorResponse,
        },
        status.HTTP_409_CONFLICT: {
            "description": "Category is inactive.",
            "model": ErrorResponse,
        },
    },
)
def update_ticket_category(
    ticket_id: Annotated[int, Path(gt=0)],
    data: TicketCategoryUpdate,
    ticket_service: Annotated[TicketService, Depends(get_ticket_service)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> TicketResponse:
    return ticket_service.update_category(ticket_id, data.category_id, current_user)
