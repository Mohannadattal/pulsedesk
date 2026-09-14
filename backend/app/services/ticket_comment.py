from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.exceptions.auth import AuthorizationError
from app.models.ticket_comment import CommentVisibility, TicketComment
from app.models.ticket_event import TicketEventType
from app.models.user import User, UserRole
from app.repositories.ticket_comment import TicketCommentRepository
from app.schemas.ticket_comment import (
    TicketCommentCreate,
    TicketCommentListFilters,
    TicketCommentListResponse,
)
from app.services.ticket import TicketService
from app.services.ticket_event import TicketEventRecorder


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class TicketCommentService:
    def __init__(
        self,
        db: Session,
        ticket_service: TicketService,
        ticket_comment_repository: TicketCommentRepository,
        ticket_event_recorder: TicketEventRecorder,
    ) -> None:
        self.db = db
        self.ticket_service = ticket_service
        self.ticket_comment_repository = ticket_comment_repository
        self.ticket_event_recorder = ticket_event_recorder

    def create_comment(
        self,
        ticket_id: int,
        data: TicketCommentCreate,
        actor: User,
    ) -> TicketComment:
        try:
            self.ticket_service.get_ticket(ticket_id, actor)
            if (
                actor.role == UserRole.EMPLOYEE.value
                and data.visibility == CommentVisibility.INTERNAL
            ):
                raise AuthorizationError
            if actor.role not in {
                UserRole.EMPLOYEE.value,
                UserRole.AGENT.value,
                UserRole.ADMIN.value,
            }:
                raise AuthorizationError

            now = _utc_now()
            comment = TicketComment(
                ticket_id=ticket_id,
                author_id=actor.id,
                content=data.content,
                visibility=data.visibility.value,
                created_at=now,
                updated_at=now,
            )
            comment = self.ticket_comment_repository.create(comment)
            self.ticket_event_recorder.record(
                ticket_id=ticket_id,
                actor_id=actor.id,
                event_type=TicketEventType.COMMENT_ADDED,
                metadata={
                    "comment_id": comment.id,
                    "visibility": data.visibility.value,
                },
                created_at=now,
            )
            self.db.commit()
            return comment
        except Exception:
            self.db.rollback()
            raise

    def list_comments(
        self,
        ticket_id: int,
        filters: TicketCommentListFilters,
        actor: User,
    ) -> TicketCommentListResponse:
        self.ticket_service.get_ticket(ticket_id, actor)
        if actor.role not in {
            UserRole.EMPLOYEE.value,
            UserRole.AGENT.value,
            UserRole.ADMIN.value,
        }:
            raise AuthorizationError
        visibility = (
            CommentVisibility.PUBLIC
            if actor.role == UserRole.EMPLOYEE.value
            else None
        )
        comments, total = self.ticket_comment_repository.list_for_ticket(
            ticket_id,
            visibility=visibility,
            page=filters.page,
            page_size=filters.page_size,
        )
        return TicketCommentListResponse(
            items=comments,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )
