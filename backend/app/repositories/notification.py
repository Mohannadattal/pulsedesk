from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, joinedload

from app.models.notification import Notification
from app.models.ticket import Ticket
from app.models.user import User

NOTIFICATION_REFERENCE_OPTIONS = (
    joinedload(Notification.actor).load_only(
        User.id,
        User.first_name,
        User.last_name,
    ),
    joinedload(Notification.ticket).load_only(
        Ticket.id,
        Ticket.ticket_number,
        Ticket.title,
    ),
)


class NotificationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, notification: Notification) -> Notification:
        self.db.add(notification)
        self.db.flush()
        self.db.refresh(notification)
        return notification

    def list_for_recipient(
        self,
        recipient_user_id: int,
        *,
        unread_only: bool,
        page: int,
        page_size: int,
    ) -> tuple[list[Notification], int]:
        conditions = [Notification.recipient_user_id == recipient_user_id]
        if unread_only:
            conditions.append(Notification.is_read.is_(False))
        total = (
            self.db.scalar(
                select(func.count()).select_from(Notification).where(*conditions)
            )
            or 0
        )
        statement = (
            select(Notification)
            .options(*NOTIFICATION_REFERENCE_OPTIONS)
            .where(*conditions)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(statement).all()), total

    def count_unread(self, recipient_user_id: int) -> int:
        statement = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.recipient_user_id == recipient_user_id,
                Notification.is_read.is_(False),
            )
        )
        return self.db.scalar(statement) or 0

    def get_owned_by_id_for_update(
        self,
        notification_id: int,
        recipient_user_id: int,
    ) -> Notification | None:
        statement = (
            select(Notification)
            .where(
                Notification.id == notification_id,
                Notification.recipient_user_id == recipient_user_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def get_owned_by_id_with_references(
        self,
        notification_id: int,
        recipient_user_id: int,
    ) -> Notification | None:
        statement = (
            select(Notification)
            .options(*NOTIFICATION_REFERENCE_OPTIONS)
            .where(
                Notification.id == notification_id,
                Notification.recipient_user_id == recipient_user_id,
            )
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def mark_all_read(self, recipient_user_id: int, read_at: datetime) -> int:
        result = self.db.execute(
            update(Notification)
            .where(
                Notification.recipient_user_id == recipient_user_id,
                Notification.is_read.is_(False),
            )
            .values(is_read=True, read_at=read_at)
        )
        return int(result.rowcount or 0)

    def delete_created_before(self, cutoff: datetime, batch_size: int) -> int:
        notification_ids = list(
            self.db.scalars(
                select(Notification.id)
                .where(Notification.created_at < cutoff)
                .order_by(Notification.created_at, Notification.id)
                .limit(batch_size)
            ).all()
        )
        if not notification_ids:
            return 0

        result = self.db.execute(
            delete(Notification).where(Notification.id.in_(notification_ids))
        )
        return int(result.rowcount or 0)
