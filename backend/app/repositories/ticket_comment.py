from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.ticket_comment import CommentVisibility, TicketComment
from app.models.user import User


COMMENT_AUTHOR_REFERENCE_OPTION = selectinload(TicketComment.author).load_only(
    User.id,
    User.first_name,
    User.last_name,
)


class TicketCommentRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, comment: TicketComment) -> TicketComment:
        self.db.add(comment)
        self.db.flush()
        self.db.refresh(comment)
        return comment

    def get_by_id_with_author(self, comment_id: int) -> TicketComment | None:
        statement = (
            select(TicketComment)
            .options(COMMENT_AUTHOR_REFERENCE_OPTION)
            .where(TicketComment.id == comment_id)
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def list_for_ticket(
        self,
        ticket_id: int,
        *,
        visibility: CommentVisibility | None,
        page: int,
        page_size: int,
    ) -> tuple[list[TicketComment], int]:
        conditions = [TicketComment.ticket_id == ticket_id]
        if visibility is not None:
            conditions.append(TicketComment.visibility == visibility.value)

        count_statement = (
            select(func.count())
            .select_from(TicketComment)
            .where(*conditions)
        )
        total = self.db.scalar(count_statement) or 0

        statement = (
            select(TicketComment)
            .options(COMMENT_AUTHOR_REFERENCE_OPTION)
            .where(*conditions)
            .order_by(TicketComment.created_at.asc(), TicketComment.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        comments = list(self.db.scalars(statement).all())
        return comments, total
