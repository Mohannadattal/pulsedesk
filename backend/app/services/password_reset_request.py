from sqlalchemy.orm import Session

from app.core.security import PasswordHasher
from app.exceptions.auth import (
    AuthorizationError,
    PasswordConfirmationMismatchError,
)
from app.exceptions.password_reset_request import (
    PasswordResetRequestNotFoundError,
    PasswordResetRequestResolvedError,
    PasswordResetTargetInactiveError,
)
from app.models.password_reset_request import (
    PasswordResetRequest,
    PasswordResetRequestStatus,
)
from app.models.user import User, UserRole
from app.repositories.exceptions import (
    DuplicatePendingPasswordResetRequestError,
)
from app.repositories.password_reset_request import (
    PasswordResetRequestRepository,
)
from app.repositories.user import UserRepository
from app.schemas.auth import (
    PasswordResetRequestAcceptedResponse,
    PasswordResetRequestCreate,
)
from app.schemas.password_reset_request import (
    AdminResetPasswordRequest,
    PasswordResetRequestFilters,
    PasswordResetRequestListResponse,
    PasswordResetRequestResponse,
)
from app.utils.time import utc_now_naive


class PasswordResetService:
    def __init__(
        self,
        db: Session,
        password_reset_repository: PasswordResetRequestRepository,
        user_repository: UserRepository,
        password_hasher: PasswordHasher,
    ) -> None:
        self.db = db
        self.password_reset_repository = password_reset_repository
        self.user_repository = user_repository
        self.password_hasher = password_hasher

    def request_reset(
        self,
        data: PasswordResetRequestCreate,
    ) -> PasswordResetRequestAcceptedResponse:
        user = self.user_repository.get_by_email(data.email)
        if user is None or not user.is_active:
            return PasswordResetRequestAcceptedResponse()

        if self.password_reset_repository.pending_exists_for_user(user.id):
            return PasswordResetRequestAcceptedResponse()

        request = PasswordResetRequest(
            user_id=user.id,
            status=PasswordResetRequestStatus.PENDING.value,
            requested_at=utc_now_naive(),
            resolved_at=None,
            resolved_by_user_id=None,
        )
        try:
            self.password_reset_repository.create(request)
            self.db.commit()
        except DuplicatePendingPasswordResetRequestError:
            self.db.rollback()
        except Exception:
            self.db.rollback()
            raise
        return PasswordResetRequestAcceptedResponse()

    def list_requests(
        self,
        filters: PasswordResetRequestFilters,
        actor: User,
    ) -> PasswordResetRequestListResponse:
        self._require_admin(actor)
        requests, total = self.password_reset_repository.list(
            status=filters.status,
            page=filters.page,
            page_size=filters.page_size,
        )
        return PasswordResetRequestListResponse(
            items=requests,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def reset_password(
        self,
        request_id: int,
        data: AdminResetPasswordRequest,
        actor: User,
    ) -> PasswordResetRequestResponse:
        self._require_admin(actor)
        temporary_password = data.temporary_password.get_secret_value()
        confirmation = data.confirm_temporary_password.get_secret_value()
        if temporary_password != confirmation:
            raise PasswordConfirmationMismatchError

        candidate_hash = self.password_hasher.hash(temporary_password)
        try:
            request = self.password_reset_repository.get_by_id_for_update(request_id)
            if request is None:
                raise PasswordResetRequestNotFoundError
            if request.status != PasswordResetRequestStatus.PENDING.value:
                raise PasswordResetRequestResolvedError

            target_user_id = request.user_id
            locked_users = self.user_repository.lock_by_ids(
                {actor.id, target_user_id}
            )
            locked_by_id = {user.id: user for user in locked_users}
            locked_actor = locked_by_id.get(actor.id)
            if (
                locked_actor is None
                or not locked_actor.is_active
                or locked_actor.role != UserRole.ADMIN.value
            ):
                raise AuthorizationError

            target = locked_by_id.get(target_user_id)
            if target is None:
                raise PasswordResetRequestNotFoundError
            if not target.is_active:
                raise PasswordResetTargetInactiveError
            if (
                request.status != PasswordResetRequestStatus.PENDING.value
                or request.user_id != target_user_id
            ):
                raise PasswordResetRequestResolvedError

            now = utc_now_naive()
            target.password_hash = candidate_hash
            target.must_change_password = True
            target.auth_version += 1
            target.updated_at = now
            self.user_repository.save(target)

            request.status = PasswordResetRequestStatus.RESOLVED.value
            request.resolved_at = now
            request.resolved_by_user_id = locked_actor.id
            request = self.password_reset_repository.save(request)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        return PasswordResetRequestResponse(
            id=request.id,
            status=request.status,
            requested_at=request.requested_at,
            resolved_at=request.resolved_at,
            resolved_by_user_id=request.resolved_by_user_id,
            user=target,
        )

    @staticmethod
    def _require_admin(actor: User) -> None:
        if actor.role != UserRole.ADMIN.value:
            raise AuthorizationError
