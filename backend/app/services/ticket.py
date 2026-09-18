import base64
import secrets
from datetime import datetime

from sqlalchemy.orm import Session

from app.exceptions.auth import AuthorizationError
from app.exceptions.category import CategoryNotFoundError, InactiveCategoryError
from app.exceptions.customer import (
    CustomerNotFoundError,
    CustomerVerificationInvalidError,
    CustomerVerificationNotFoundError,
    InactiveCustomerError,
)
from app.exceptions.ticket import (
    CustomerTicketNotFoundError,
    InvalidTicketAssigneeError,
    InvalidTicketFilterError,
    InvalidTicketStatusTransitionError,
    TicketNotFoundError,
    TicketNumberAllocationError,
)
from app.models.category import Category
from app.models.customer import Customer
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.ticket_event import TicketEventType
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.exceptions import DuplicateTicketNumberError
from app.repositories.ticket import TicketRepository
from app.repositories.user import UserRepository
from app.schemas.ticket import (
    CustomerTicketLookupRequest,
    TicketCreate,
    TicketListFilters,
    TicketListResponse,
    TicketSearchRequest,
)
from app.services.ticket_event import TicketEventRecorder, display_name
from app.utils.time import utc_now_naive

TICKET_NUMBER_ATTEMPTS = 3
ALLOWED_STATUS_TRANSITIONS = {
    TicketStatus.OPEN.value: TicketStatus.IN_PROGRESS,
    TicketStatus.IN_PROGRESS.value: TicketStatus.RESOLVED,
    TicketStatus.RESOLVED.value: TicketStatus.CLOSED,
}


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
        ticket_event_recorder: TicketEventRecorder,
        customer_repository: CustomerRepository | None = None,
        customer_verification_repository: CustomerVerificationRepository | None = None,
    ) -> None:
        self.db = db
        self.ticket_repository = ticket_repository
        self.category_repository = category_repository
        self.user_repository = user_repository
        self.ticket_event_recorder = ticket_event_recorder
        self.customer_repository = customer_repository or CustomerRepository(db)
        self.customer_verification_repository = (
            customer_verification_repository or CustomerVerificationRepository(db)
        )

    def create_ticket(self, data: TicketCreate, actor: User) -> Ticket:
        if actor.role not in {UserRole.EMPLOYEE.value, UserRole.ADMIN.value}:
            raise AuthorizationError
        last_collision: DuplicateTicketNumberError | None = None
        for _attempt in range(TICKET_NUMBER_ATTEMPTS):
            try:
                self._get_active_category(data.category_id)
                customer = self._lock_active_customer(data.customer_id)
                now = self._validate_customer_verification(data, actor, customer)
                ticket = Ticket(
                    ticket_number=_generate_ticket_number(),
                    title=data.title,
                    description=data.description,
                    status=TicketStatus.OPEN.value,
                    priority=TicketPriority.MEDIUM.value,
                    category_id=data.category_id,
                    created_by_id=actor.id,
                    assigned_to_id=None,
                    customer_id=data.customer_id,
                    customer_verification_id=data.customer_verification_id,
                    created_at=now,
                    updated_at=now,
                    resolved_at=None,
                    closed_at=None,
                )
                ticket = self.ticket_repository.save(ticket)
                self.ticket_event_recorder.record(
                    ticket_id=ticket.id,
                    actor=actor,
                    event_type=TicketEventType.TICKET_CREATED,
                    metadata=(
                        {
                            "customer_id": customer.id,
                            "customer_number": customer.customer_number,
                            **(
                                {
                                    "customer_verification_id": (
                                        data.customer_verification_id
                                    )
                                }
                                if data.customer_verification_id is not None
                                else {}
                            ),
                        }
                        if customer is not None
                        else None
                    ),
                    created_at=now,
                )
                return self._commit_with_display_references(ticket)
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
        employee_scope = actor.id if actor.role == UserRole.EMPLOYEE.value else None
        ticket = self.ticket_repository.get_visible_by_id(
            ticket_id,
            employee_id=employee_scope,
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
            customer_id=filters.customer_id,
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

    def list_customer_tickets(
        self,
        customer_id: int,
        filters: TicketListFilters,
        actor: User,
    ) -> TicketListResponse:
        if actor.role not in {UserRole.EMPLOYEE.value, UserRole.ADMIN.value}:
            raise AuthorizationError
        if filters.assigned_to_id is not None and filters.unassigned is not None:
            raise InvalidTicketFilterError
        customer = self.customer_repository.get_by_id(customer_id)
        if customer is None:
            raise CustomerNotFoundError
        tickets, total = self.ticket_repository.list(
            status=filters.status,
            priority=filters.priority,
            category_id=filters.category_id,
            assigned_to_id=filters.assigned_to_id,
            created_by_id=filters.created_by_id,
            customer_id=customer_id,
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

    def lookup_customer_ticket(
        self,
        customer_id: int,
        data: CustomerTicketLookupRequest,
        actor: User,
    ) -> Ticket:
        if actor.role not in {UserRole.EMPLOYEE.value, UserRole.ADMIN.value}:
            raise AuthorizationError
        customer = self.customer_repository.get_by_id_for_update(customer_id)
        if customer is None:
            raise CustomerNotFoundError
        verification = self.customer_verification_repository.get_by_id_for_update(
            data.customer_verification_id
        )
        if verification is None:
            raise CustomerVerificationNotFoundError
        now = utc_now_naive()
        if (
            verification.customer_id != customer.id
            or verification.verified_by_user_id != actor.id
            or verification.expires_at <= now
        ):
            raise CustomerVerificationInvalidError

        employee_scope = actor.id if actor.role == UserRole.EMPLOYEE.value else None
        ticket = self.ticket_repository.get_customer_ticket_by_number(
            ticket_number=data.ticket_number,
            customer_id=customer.id,
            employee_id=employee_scope,
        )
        if ticket is None:
            raise CustomerTicketNotFoundError
        return ticket

    def search_tickets(
        self,
        data: TicketSearchRequest,
        actor: User,
    ) -> TicketListResponse:
        self._require_support(actor)
        tickets, total = self.ticket_repository.search(
            kind=data.kind,
            value=data.value,
            page=data.page,
            page_size=data.page_size,
        )
        return TicketListResponse(
            items=tickets,
            page=data.page,
            page_size=data.page_size,
            total=total,
            total_pages=(total + data.page_size - 1) // data.page_size,
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
            assignee = None
            if assigned_to_id is not None:
                assignee = self.user_repository.get_by_id(assigned_to_id)
                if (
                    assignee is None
                    or not assignee.is_active
                    or assignee.role != UserRole.AGENT.value
                ):
                    raise InvalidTicketAssigneeError(assigned_to_id)

            old_assigned_to_id = ticket.assigned_to_id
            if old_assigned_to_id == assigned_to_id:
                return self._commit_with_display_references(ticket)

            old_assignee = (
                self.user_repository.get_by_id(old_assigned_to_id)
                if old_assigned_to_id is not None
                else None
            )

            ticket.assigned_to_id = assigned_to_id
            return self._save_and_commit(
                ticket,
                actor=actor,
                event_type=TicketEventType.ASSIGNEE_CHANGED,
                field_name="assigned_to_id",
                old_value=self._serialize_id(old_assigned_to_id),
                new_value=self._serialize_id(assigned_to_id),
                metadata={
                    **(
                        {
                            TicketEventRecorder.OLD_ASSIGNEE_DISPLAY_NAME: display_name(
                                old_assignee
                            )
                        }
                        if old_assignee is not None
                        else {}
                    ),
                    **(
                        {
                            TicketEventRecorder.NEW_ASSIGNEE_DISPLAY_NAME: display_name(
                                assignee
                            )
                        }
                        if assignee is not None
                        else {}
                    ),
                },
            )
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
            old_priority = ticket.priority
            if old_priority == priority.value:
                return self._commit_with_display_references(ticket)

            ticket.priority = priority.value
            return self._save_and_commit(
                ticket,
                actor=actor,
                event_type=TicketEventType.PRIORITY_CHANGED,
                field_name="priority",
                old_value=old_priority,
                new_value=priority.value,
            )
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

            now = utc_now_naive()
            old_status = ticket.status
            ticket.status = requested_status.value
            if requested_status == TicketStatus.RESOLVED:
                ticket.resolved_at = now
            elif requested_status == TicketStatus.CLOSED:
                ticket.closed_at = now
            lifecycle_event_type = None
            if requested_status == TicketStatus.RESOLVED:
                lifecycle_event_type = TicketEventType.TICKET_RESOLVED
            elif requested_status == TicketStatus.CLOSED:
                lifecycle_event_type = TicketEventType.TICKET_CLOSED

            return self._save_and_commit(
                ticket,
                actor=actor,
                event_type=TicketEventType.STATUS_CHANGED,
                field_name="status",
                old_value=old_status,
                new_value=requested_status.value,
                lifecycle_event_type=lifecycle_event_type,
                updated_at=now,
            )
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
            new_category = self._get_active_category(category_id)
            old_category_id = ticket.category_id
            if old_category_id == category_id:
                return self._commit_with_display_references(ticket)

            # The locked ticket row only carries the FK. Resolve its historical
            # display value explicitly before changing it; this is one bounded
            # lookup and avoids relationship lazy loading.
            old_category = self.category_repository.get_by_id(old_category_id)

            ticket.category_id = category_id
            return self._save_and_commit(
                ticket,
                actor=actor,
                event_type=TicketEventType.CATEGORY_CHANGED,
                field_name="category_id",
                old_value=str(old_category_id),
                new_value=str(category_id),
                metadata={
                    **(
                        {
                            TicketEventRecorder.OLD_CATEGORY_DISPLAY_NAME: (
                                old_category.name
                            )
                        }
                        if old_category is not None
                        else {}
                    ),
                    TicketEventRecorder.NEW_CATEGORY_DISPLAY_NAME: new_category.name,
                },
            )
        except Exception:
            self.db.rollback()
            raise

    def _get_ticket(self, ticket_id: int) -> Ticket:
        ticket = self.ticket_repository.get_by_id_for_update(ticket_id)
        if ticket is None:
            raise TicketNotFoundError(ticket_id)
        return ticket

    def _get_active_category(self, category_id: int) -> Category:
        category = self.category_repository.get_by_id_for_update(category_id)
        if category is None:
            raise CategoryNotFoundError(category_id)
        if not category.is_active:
            raise InactiveCategoryError(category_id)
        return category

    def _lock_active_customer(self, customer_id: int | None) -> Customer | None:
        if customer_id is None:
            return None
        customer = self.customer_repository.get_by_id_for_update(customer_id)
        if customer is None:
            raise CustomerNotFoundError
        if not customer.is_active:
            raise InactiveCustomerError
        return customer

    def _validate_customer_verification(
        self,
        data: TicketCreate,
        actor: User,
        customer: Customer | None,
    ) -> datetime:
        if data.customer_verification_id is None:
            return utc_now_naive()
        assert customer is not None
        verification = self.customer_verification_repository.get_by_id(
            data.customer_verification_id
        )
        if verification is None:
            raise CustomerVerificationNotFoundError
        if (
            verification.customer_id != customer.id
            or verification.verified_by_user_id != actor.id
        ):
            raise CustomerVerificationInvalidError
        now = utc_now_naive()
        if verification.expires_at <= now:
            raise CustomerVerificationInvalidError
        return now

    def _save_and_commit(
        self,
        ticket: Ticket,
        *,
        actor: User,
        event_type: TicketEventType,
        field_name: str,
        old_value: str | None,
        new_value: str | None,
        metadata: dict[str, str] | None = None,
        lifecycle_event_type: TicketEventType | None = None,
        updated_at: datetime | None = None,
    ) -> Ticket:
        event_created_at = updated_at or utc_now_naive()
        ticket.updated_at = event_created_at
        ticket = self.ticket_repository.save(ticket)
        self.ticket_event_recorder.record(
            ticket_id=ticket.id,
            actor=actor,
            event_type=event_type,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            metadata=metadata,
            created_at=event_created_at,
        )
        if lifecycle_event_type is not None:
            self.ticket_event_recorder.record(
                ticket_id=ticket.id,
                actor=actor,
                event_type=lifecycle_event_type,
                created_at=event_created_at,
            )
        return self._commit_with_display_references(ticket)

    def _commit_with_display_references(self, ticket: Ticket) -> Ticket:
        response_ticket = self.ticket_repository.get_by_id_with_display_references(
            ticket.id,
        )
        if response_ticket is None:
            raise TicketNotFoundError(ticket.id)
        self.db.commit()
        return response_ticket

    @staticmethod
    def _serialize_id(value: int | None) -> str | None:
        return str(value) if value is not None else None

    @staticmethod
    def _require_support(actor: User) -> None:
        if actor.role not in {UserRole.AGENT.value, UserRole.ADMIN.value}:
            raise AuthorizationError
