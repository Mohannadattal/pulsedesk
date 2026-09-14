from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.exceptions.auth import AuthorizationError
from app.models.ticket_event import TicketEvent, TicketEventType
from app.models.user import User, UserRole
from app.repositories.ticket_event import TicketEventRepository
from app.schemas.ticket_event import TicketEventListFilters, TicketEventListResponse

if TYPE_CHECKING:
    from app.services.ticket import TicketService


class TicketEventRecorder:
    """Persists events inside the transaction owned by the calling service."""

    def __init__(self, ticket_event_repository: TicketEventRepository) -> None:
        self.ticket_event_repository = ticket_event_repository

    def record(
        self,
        *,
        ticket_id: int,
        actor_id: int | None,
        event_type: TicketEventType,
        created_at: datetime,
        field_name: str | None = None,
        old_value: str | None = None,
        new_value: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> TicketEvent:
        event = TicketEvent(
            ticket_id=ticket_id,
            actor_id=actor_id,
            event_type=event_type.value,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            event_metadata=metadata,
            created_at=created_at,
        )
        return self.ticket_event_repository.create(event)


class TicketEventService:
    def __init__(
        self,
        ticket_service: "TicketService",
        ticket_event_repository: TicketEventRepository,
    ) -> None:
        self.ticket_service = ticket_service
        self.ticket_event_repository = ticket_event_repository

    def list_events(
        self,
        ticket_id: int,
        filters: TicketEventListFilters,
        actor: User,
    ) -> TicketEventListResponse:
        self.ticket_service.get_ticket(ticket_id, actor)
        if actor.role not in {UserRole.AGENT.value, UserRole.ADMIN.value}:
            raise AuthorizationError

        events, total = self.ticket_event_repository.list_for_ticket(
            ticket_id,
            page=filters.page,
            page_size=filters.page_size,
        )
        return TicketEventListResponse(
            items=events,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )
