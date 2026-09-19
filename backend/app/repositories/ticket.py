from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.category import Category
from app.models.customer import Customer
from app.models.ticket import Ticket, TicketPriority, TicketStatus
from app.models.user import User
from app.repositories.exceptions import (
    DuplicateTicketNumberError,
    is_mysql_duplicate_constraint,
)
from app.schemas.ticket import TicketSearchKind

TICKET_NUMBER_UNIQUE_CONSTRAINT = "uq_tickets_ticket_number"
TICKET_DISPLAY_REFERENCE_OPTIONS = (
    joinedload(Ticket.category, innerjoin=True).load_only(
        Category.id,
        Category.name,
    ),
    joinedload(Ticket.creator, innerjoin=True).load_only(
        User.id,
        User.first_name,
        User.last_name,
    ),
    joinedload(Ticket.assignee).load_only(
        User.id,
        User.first_name,
        User.last_name,
    ),
    joinedload(Ticket.customer).load_only(
        Customer.id,
        Customer.customer_number,
        Customer.first_name,
        Customer.last_name,
    ),
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class TicketRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id_for_update(self, ticket_id: int) -> Ticket | None:
        statement = select(Ticket).where(Ticket.id == ticket_id).with_for_update()
        return self.db.scalar(statement)

    def get_visible_by_id(
        self,
        ticket_id: int,
        *,
        employee_id: int | None = None,
        created_by_id: int | None = None,
    ) -> Ticket | None:
        statement = (
            select(Ticket)
            .options(*TICKET_DISPLAY_REFERENCE_OPTIONS)
            .where(Ticket.id == ticket_id)
        )
        employee_scope = employee_id if employee_id is not None else created_by_id
        if employee_scope is not None:
            statement = statement.where(
                or_(
                    Ticket.created_by_id == employee_scope,
                    Ticket.customer_id.is_not(None),
                )
            )
        return self.db.scalar(statement)

    def get_customer_ticket_by_number(
        self,
        *,
        ticket_number: str,
        customer_id: int,
        employee_id: int | None,
    ) -> Ticket | None:
        statement = (
            select(Ticket)
            .options(*TICKET_DISPLAY_REFERENCE_OPTIONS)
            .where(
                Ticket.ticket_number == ticket_number,
                Ticket.customer_id == customer_id,
            )
        )
        if employee_id is not None:
            statement = statement.where(
                or_(
                    Ticket.created_by_id == employee_id,
                    Ticket.customer_id.is_not(None),
                )
            )
        return self.db.scalar(statement)

    def search(
        self,
        *,
        kind: TicketSearchKind,
        value: str,
        employee_id: int | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Ticket], int]:
        conditions = [
            Ticket.ticket_number == value
            if kind == TicketSearchKind.TICKET_NUMBER
            else Ticket.title.like(f"{_escape_like(value)}%", escape="\\")
        ]
        if employee_id is not None:
            conditions.append(
                or_(
                    Ticket.created_by_id == employee_id,
                    Ticket.customer_id.is_not(None),
                )
            )
        total = (
            self.db.scalar(select(func.count()).select_from(Ticket).where(*conditions))
            or 0
        )
        statement = (
            select(Ticket)
            .options(*TICKET_DISPLAY_REFERENCE_OPTIONS)
            .where(*conditions)
            .order_by(Ticket.created_at.desc(), Ticket.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(statement).all()), total

    def get_by_id_with_display_references(self, ticket_id: int) -> Ticket | None:
        statement = (
            select(Ticket)
            .options(*TICKET_DISPLAY_REFERENCE_OPTIONS)
            .where(Ticket.id == ticket_id)
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def list(
        self,
        *,
        status: TicketStatus | None,
        priority: TicketPriority | None,
        category_id: int | None,
        assigned_to_id: int | None,
        created_by_id: int | None,
        customer_id: int | None,
        unassigned: bool | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Ticket], int]:
        conditions = []
        if status is not None:
            conditions.append(Ticket.status == status.value)
        if priority is not None:
            conditions.append(Ticket.priority == priority.value)
        if category_id is not None:
            conditions.append(Ticket.category_id == category_id)
        if assigned_to_id is not None:
            conditions.append(Ticket.assigned_to_id == assigned_to_id)
        if created_by_id is not None:
            conditions.append(Ticket.created_by_id == created_by_id)
        if customer_id is not None:
            conditions.append(Ticket.customer_id == customer_id)
        if unassigned is True:
            conditions.append(Ticket.assigned_to_id.is_(None))
        elif unassigned is False:
            conditions.append(Ticket.assigned_to_id.is_not(None))

        count_statement = select(func.count()).select_from(Ticket).where(*conditions)
        total = self.db.scalar(count_statement) or 0

        statement = (
            select(Ticket)
            .options(*TICKET_DISPLAY_REFERENCE_OPTIONS)
            .where(*conditions)
            .order_by(Ticket.created_at.desc(), Ticket.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        tickets = list(self.db.scalars(statement).all())
        return tickets, total

    def save(self, ticket: Ticket) -> Ticket:
        self.db.add(ticket)
        try:
            self.db.flush()
        except IntegrityError as error:
            if is_mysql_duplicate_constraint(
                error,
                TICKET_NUMBER_UNIQUE_CONSTRAINT,
            ):
                raise DuplicateTicketNumberError from error
            raise

        self.db.refresh(ticket)
        return ticket
