from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr

from app.schemas.password import PasswordValue
from app.schemas.user import UserResponse


class SessionType(StrEnum):
    NORMAL = "NORMAL"
    PASSWORD_CHANGE_REQUIRED = "PASSWORD_CHANGE_REQUIRED"


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr
    password: SecretStr = Field(min_length=1, max_length=128)


class AuthSessionResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    session_type: SessionType
    user: UserResponse


class AuthSessionStateResponse(BaseModel):
    session_type: SessionType
    user: UserResponse


class CompletePasswordChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    new_password: PasswordValue
    confirm_new_password: PasswordValue


class PasswordResetRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr


class PasswordResetRequestAcceptedResponse(BaseModel):
    detail: Literal[
        "If an account exists for this email, a password reset request has been submitted."
    ] = "If an account exists for this email, a password reset request has been submitted."
