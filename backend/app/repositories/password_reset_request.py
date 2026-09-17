from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from app.repositories.exceptions import (
    DuplicatePendingPasswordResetRequestError,
    is_mysql_duplicate_constraint,
)


PENDING_USER_UNIQUE_CONSTRAINT = "uq_password_reset_requests_pending_user_id"


class PasswordResetRequestRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def pending_exists_for_user(self, user_id: int) -> bool:
        statement = (
            select(PasswordResetRequest.id)
            .where(
                PasswordResetRequest.user_id == user_id,
                PasswordResetRequest.status == PasswordResetRequestStatus.PENDING.value,
            )
            .limit(1)
        )
        return self.db.scalar(statement) is not None

    def create(self, request: PasswordResetRequest) -> PasswordResetRequest:
        self.db.add(request)
        try:
            self.db.flush()
        except IntegrityError as error:
            if is_mysql_duplicate_constraint(
                error,
                PENDING_USER_UNIQUE_CONSTRAINT,
            ) or self._is_sqlite_pending_duplicate(error):
                raise DuplicatePendingPasswordResetRequestError from error
            raise
        self.db.refresh(request)
        return request

    def list(
        self,
        *,
        status: PasswordResetRequestStatus,
        page: int,
        page_size: int,
    ) -> tuple[list[PasswordResetRequest], int]:
        condition = PasswordResetRequest.status == status.value
        total = (
            self.db.scalar(
                select(func.count()).select_from(PasswordResetRequest).where(condition)
            )
            or 0
        )
        statement = (
            select(PasswordResetRequest)
            .options(joinedload(PasswordResetRequest.user))
            .where(condition)
            .order_by(
                PasswordResetRequest.requested_at.asc(),
                PasswordResetRequest.id.asc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(statement).all()), total

    def get_by_id_for_update(
        self,
        request_id: int,
    ) -> PasswordResetRequest | None:
        statement = (
            select(PasswordResetRequest)
            .where(PasswordResetRequest.id == request_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        return self.db.scalar(statement)

    def save(self, request: PasswordResetRequest) -> PasswordResetRequest:
        self.db.add(request)
        self.db.flush()
        self.db.refresh(request)
        return request

    @staticmethod
    def _is_sqlite_pending_duplicate(error: IntegrityError) -> bool:
        message = str(error.orig)
        return (
            "UNIQUE constraint failed: password_reset_requests.pending_user_id"
        ) in message
