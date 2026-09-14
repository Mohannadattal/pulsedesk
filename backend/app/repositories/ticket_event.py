from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.ticket_event import TicketEvent


class TicketEventRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, event: TicketEvent) -> TicketEvent:
        self.db.add(event)
        self.db.flush()
        return event

    def list_for_ticket(
        self,
        ticket_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[TicketEvent], int]:
        condition = TicketEvent.ticket_id == ticket_id
        count_statement = (
            select(func.count())
            .select_from(TicketEvent)
            .where(condition)
        )
        total = self.db.scalar(count_statement) or 0

        statement = (
            select(TicketEvent)
            .where(condition)
            .order_by(TicketEvent.created_at.asc(), TicketEvent.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        events = list(self.db.scalars(statement).all())
        return events, total
