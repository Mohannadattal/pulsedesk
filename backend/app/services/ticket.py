import base64
import secrets
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.exceptions.auth import AuthorizationError
from app.exceptions.category import CategoryNotFoundError, InactiveCategoryError
from app.exceptions.ticket import (
    InvalidTicketAssigneeError,
    InvalidTicketFilterError,
    InvalidTicketStatusTransitionError,
    TicketNumberAllocationError,
    TicketNotFoundError,
)
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.exceptions import DuplicateTicketNumberError
from app.repositories.ticket import TicketRepository
from app.repositories.user import UserRepository
from app.schemas.ticket import TicketCreate, TicketListFilters, TicketListResponse


TICKET_NUMBER_ATTEMPTS = 3
ALLOWED_STATUS_TRANSITIONS = {
    TicketStatus.OPEN.value: TicketStatus.IN_PROGRESS,
    TicketStatus.IN_PROGRESS.value: TicketStatus.RESOLVED,
    TicketStatus.RESOLVED.value: TicketStatus.CLOSED,
}


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _generate_ticket_number() -> str:
    random_part = base64.b32encode(secrets.token_bytes(10)).decode("ascii")
    return f"TKT-{random_part}"


class TicketService:
    def __init__(
        self,
        db: Session,
        ticket_repository: TicketRepository,
        category_repository: CategoryRepository,
        user_repository: UserRepository,
    ) -> None:
        self.db = db
        self.ticket_repository = ticket_repository
        self.category_repository = category_repository
        self.user_repository = user_repository

    def create_ticket(self, data: TicketCreate, actor: User) -> Ticket:
        last_collision: DuplicateTicketNumberError | None = None
        for _attempt in range(TICKET_NUMBER_ATTEMPTS):
            now = _utc_now()
            ticket = Ticket(
                ticket_number=_generate_ticket_number(),
                title=data.title,
                description=data.description,
                status=TicketStatus.OPEN.value,
                priority=TicketPriority.MEDIUM.value,
                category_id=data.category_id,
                created_by_id=actor.id,
                assigned_to_id=None,
                created_at=now,
                updated_at=now,
                resolved_at=None,
                closed_at=None,
            )
            try:
                self._get_active_category(data.category_id)
                ticket = self.ticket_repository.save(ticket)
                self.db.commit()
                return ticket
            except DuplicateTicketNumberError as error:
                self.db.rollback()
                last_collision = error
            except Exception:
                self.db.rollback()
                raise

        allocation_error = TicketNumberAllocationError(TICKET_NUMBER_ATTEMPTS)
        if last_collision is not None:
            raise allocation_error from last_collision
        raise allocation_error

    def get_ticket(self, ticket_id: int, actor: User) -> Ticket:
        creator_scope = actor.id if actor.role == UserRole.EMPLOYEE.value else None
        ticket = self.ticket_repository.get_visible_by_id(
            ticket_id,
            created_by_id=creator_scope,
        )
        if ticket is None:
            raise TicketNotFoundError(ticket_id)
        return ticket

    def list_tickets(
        self,
        filters: TicketListFilters,
        actor: User,
    ) -> TicketListResponse:
        if filters.assigned_to_id is not None and filters.unassigned is not None:
            raise InvalidTicketFilterError

        created_by_id = filters.created_by_id
        if actor.role == UserRole.EMPLOYEE.value:
            if created_by_id is not None and created_by_id != actor.id:
                raise AuthorizationError
            created_by_id = actor.id

        tickets, total = self.ticket_repository.list(
            status=filters.status,
            priority=filters.priority,
            category_id=filters.category_id,
            assigned_to_id=filters.assigned_to_id,
            created_by_id=created_by_id,
            unassigned=filters.unassigned,
            page=filters.page,
            page_size=filters.page_size,
        )
        return TicketListResponse(
            items=tickets,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def update_assignment(
        self,
        ticket_id: int,
        assigned_to_id: int | None,
        actor: User,
    ) -> Ticket:
        self._require_support(actor)
        try:
            ticket = self._get_ticket(ticket_id)
            if assigned_to_id is not None:
                assignee = self.user_repository.get_by_id(assigned_to_id)
                if (
                    assignee is None
                    or not assignee.is_active
                    or assignee.role != UserRole.AGENT.value
                ):
                    raise InvalidTicketAssigneeError(assigned_to_id)
            ticket.assigned_to_id = assigned_to_id
            return self._save_and_commit(ticket)
        except Exception:
            self.db.rollback()
            raise

    def update_priority(
        self,
        ticket_id: int,
        priority: TicketPriority,
        actor: User,
    ) -> Ticket:
        self._require_support(actor)
        try:
            ticket = self._get_ticket(ticket_id)
            ticket.priority = priority.value
            return self._save_and_commit(ticket)
        except Exception:
            self.db.rollback()
            raise

    def update_status(
        self,
        ticket_id: int,
        requested_status: TicketStatus,
        actor: User,
    ) -> Ticket:
        self._require_support(actor)
        try:
            ticket = self._get_ticket(ticket_id)
            if ALLOWED_STATUS_TRANSITIONS.get(ticket.status) != requested_status:
                raise InvalidTicketStatusTransitionError(
                    ticket.status,
                    requested_status,
                )

            now = _utc_now()
            ticket.status = requested_status.value
            if requested_status == TicketStatus.RESOLVED:
                ticket.resolved_at = now
            elif requested_status == TicketStatus.CLOSED:
                ticket.closed_at = now
            return self._save_and_commit(ticket, updated_at=now)
        except Exception:
            self.db.rollback()
            raise

    def update_category(
        self,
        ticket_id: int,
        category_id: int,
        actor: User,
    ) -> Ticket:
        self._require_support(actor)
        try:
            ticket = self._get_ticket(ticket_id)
            self._get_active_category(category_id)
            ticket.category_id = category_id
            return self._save_and_commit(ticket)
        except Exception:
            self.db.rollback()
            raise

    def _get_ticket(self, ticket_id: int) -> Ticket:
        ticket = self.ticket_repository.get_by_id_for_update(ticket_id)
        if ticket is None:
            raise TicketNotFoundError(ticket_id)
        return ticket

    def _get_active_category(self, category_id: int) -> None:
        category = self.category_repository.get_by_id_for_update(category_id)
        if category is None:
            raise CategoryNotFoundError(category_id)
        if not category.is_active:
            raise InactiveCategoryError(category_id)

    def _save_and_commit(
        self,
        ticket: Ticket,
        *,
        updated_at: datetime | None = None,
    ) -> Ticket:
        ticket.updated_at = updated_at or _utc_now()
        ticket = self.ticket_repository.save(ticket)
        self.db.commit()
        return ticket

    @staticmethod
    def _require_support(actor: User) -> None:
        if actor.role not in {UserRole.AGENT.value, UserRole.ADMIN.value}:
            raise AuthorizationError
