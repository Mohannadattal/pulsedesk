from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.exceptions.notification import NotificationNotFoundError
from app.models.notification import Notification, NotificationType
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_comment import CommentVisibility
from app.models.user import User, UserRole
from app.repositories.notification import NotificationRepository
from app.repositories.user import UserRepository
from app.schemas.notification import (
    NotificationListFilters,
    NotificationListResponse,
    NotificationReadAllResponse,
    NotificationUnreadCountResponse,
)
from app.utils.time import utc_now_naive

STATUS_NOTIFICATION_TYPES = {
    TicketStatus.IN_PROGRESS: NotificationType.TICKET_IN_PROGRESS,
    TicketStatus.RESOLVED: NotificationType.TICKET_RESOLVED,
    TicketStatus.CLOSED: NotificationType.TICKET_CLOSED,
}


class NotificationService:
    def __init__(
        self,
        db: Session,
        notification_repository: NotificationRepository,
        user_repository: UserRepository,
    ) -> None:
        self.db = db
        self.notification_repository = notification_repository
        self.user_repository = user_repository

    def create(
        self,
        *,
        recipient_user_id: int,
        notification_type: NotificationType,
        actor_user_id: int | None,
        ticket_id: int | None = None,
    ) -> Notification | None:
        if actor_user_id is not None and recipient_user_id == actor_user_id:
            return None
        return self.notification_repository.create(
            Notification(
                recipient_user_id=recipient_user_id,
                type=notification_type.value,
                ticket_id=ticket_id,
                actor_user_id=actor_user_id,
                is_read=False,
                created_at=utc_now_naive(),
                read_at=None,
            )
        )

    def notify_ticket_assignment(
        self,
        ticket: Ticket,
        actor: User,
        *,
        was_assigned: bool,
    ) -> Notification | None:
        if ticket.assigned_to_id is None:
            return None
        notification_type = (
            NotificationType.TICKET_REASSIGNED
            if was_assigned
            else NotificationType.TICKET_ASSIGNED
        )
        return self.create(
            recipient_user_id=ticket.assigned_to_id,
            notification_type=notification_type,
            actor_user_id=actor.id,
            ticket_id=ticket.id,
        )

    def notify_ticket_comment(
        self,
        ticket: Ticket,
        actor: User,
        visibility: CommentVisibility,
    ) -> Notification | None:
        if visibility != CommentVisibility.PUBLIC:
            return None
        recipient_user_id: int | None = None
        if actor.role == UserRole.EMPLOYEE.value:
            recipient_user_id = ticket.assigned_to_id
        elif actor.role == UserRole.AGENT.value:
            creator = self.user_repository.get_by_id(ticket.created_by_id)
            if creator is not None and creator.role == UserRole.EMPLOYEE.value:
                recipient_user_id = creator.id
        if recipient_user_id is None:
            return None
        return self.create(
            recipient_user_id=recipient_user_id,
            notification_type=NotificationType.TICKET_PUBLIC_COMMENT,
            actor_user_id=actor.id,
            ticket_id=ticket.id,
        )

    def notify_ticket_status(
        self,
        ticket: Ticket,
        actor: User,
        status: TicketStatus,
    ) -> Notification | None:
        creator = self.user_repository.get_by_id(ticket.created_by_id)
        if creator is None or creator.role != UserRole.EMPLOYEE.value:
            return None
        return self.create(
            recipient_user_id=creator.id,
            notification_type=STATUS_NOTIFICATION_TYPES[status],
            actor_user_id=actor.id,
            ticket_id=ticket.id,
        )

    def notify_password_reset_requested(self) -> list[Notification]:
        notifications = []
        for admin in self.user_repository.list_active_admins():
            created = self.create(
                recipient_user_id=admin.id,
                notification_type=NotificationType.PASSWORD_RESET_REQUESTED,
                actor_user_id=None,
            )
            if created is not None:
                notifications.append(created)
        return notifications

    def notify_password_reset_completed(
        self,
        target: User,
        actor: User,
    ) -> Notification | None:
        return self.create(
            recipient_user_id=target.id,
            notification_type=NotificationType.PASSWORD_RESET_COMPLETED,
            actor_user_id=actor.id,
        )

    def list_notifications(
        self,
        filters: NotificationListFilters,
        actor: User,
    ) -> NotificationListResponse:
        notifications, total = self.notification_repository.list_for_recipient(
            actor.id,
            unread_only=filters.unread_only,
            page=filters.page,
            page_size=filters.page_size,
        )
        return NotificationListResponse(
            items=notifications,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def unread_count(self, actor: User) -> NotificationUnreadCountResponse:
        return NotificationUnreadCountResponse(
            unread_count=self.notification_repository.count_unread(actor.id)
        )

    def mark_read(self, notification_id: int, actor: User) -> Notification:
        try:
            notification = self.notification_repository.get_owned_by_id_for_update(
                notification_id,
                actor.id,
            )
            if notification is None:
                raise NotificationNotFoundError
            if not notification.is_read:
                notification.is_read = True
                notification.read_at = utc_now_naive()
                self.db.flush()
            response = self.notification_repository.get_owned_by_id_with_references(
                notification_id,
                actor.id,
            )
            if response is None:
                raise NotificationNotFoundError
            self.db.commit()
            return response
        except Exception:
            self.db.rollback()
            raise

    def mark_all_read(self, actor: User) -> NotificationReadAllResponse:
        try:
            updated_count = self.notification_repository.mark_all_read(
                actor.id,
                utc_now_naive(),
            )
            self.db.commit()
            return NotificationReadAllResponse(updated_count=updated_count)
        except Exception:
            self.db.rollback()
            raise


class NotificationRetentionService:
    def __init__(
        self,
        db: Session,
        notification_repository: NotificationRepository,
        *,
        retention_days: int,
        batch_size: int,
    ) -> None:
        self.db = db
        self.notification_repository = notification_repository
        self.retention_period = timedelta(days=retention_days)
        self.batch_size = batch_size

    def cleanup_expired_batch(self, *, as_of: datetime | None = None) -> int:
        cutoff = (as_of or utc_now_naive()) - self.retention_period
        try:
            deleted_count = self.notification_repository.delete_created_before(
                cutoff,
                self.batch_size,
            )
            self.db.commit()
            return deleted_count
        except Exception:
            self.db.rollback()
            raise
