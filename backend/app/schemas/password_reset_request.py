from pydantic import BaseModel, ConfigDict, Field

from app.models.password_reset_request import PasswordResetRequestStatus
from app.models.user import UserRole
from app.schemas.password import PasswordValue
from app.schemas.types import UtcDateTime


class PasswordResetRequestFilters(BaseModel):
    status: PasswordResetRequestStatus = PasswordResetRequestStatus.PENDING
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class PasswordResetUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    first_name: str
    last_name: str
    role: UserRole
    is_active: bool


class PasswordResetRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: PasswordResetRequestStatus
    requested_at: UtcDateTime
    resolved_at: UtcDateTime | None
    resolved_by_user_id: int | None
    user: PasswordResetUserResponse


class PasswordResetRequestListResponse(BaseModel):
    items: list[PasswordResetRequestResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class AdminResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temporary_password: PasswordValue
    confirm_temporary_password: PasswordValue
