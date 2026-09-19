from typing import Literal
from urllib.parse import urlsplit

from pydantic import (
    EmailStr,
    Field,
    PositiveInt,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    database_connect_timeout_seconds: PositiveInt = 10
    database_pool_timeout_seconds: PositiveInt = 30
    database_read_timeout_seconds: PositiveInt = 60
    database_write_timeout_seconds: PositiveInt = 60
    jwt_secret: SecretStr = Field(min_length=32)
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    access_token_expire_minutes: PositiveInt = 30
    password_change_token_expire_minutes: PositiveInt = 10
    notification_retention_days: PositiveInt = 90
    notification_cleanup_batch_size: PositiveInt = 1000
    notification_cleanup_max_batches: PositiveInt = 100
    email_delivery_enabled: bool = False
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65_535)
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_use_tls: bool = True
    smtp_timeout_seconds: PositiveInt = 30
    email_from_address: EmailStr | None = None
    email_from_name: str = Field(default="PulseDesk", min_length=1, max_length=100)
    email_reply_to: EmailStr | None = None
    email_support_name: str = Field(
        default="PulseDesk Support", min_length=1, max_length=100
    )
    email_product_name: str = Field(default="PulseDesk", min_length=1, max_length=100)
    email_delivery_batch_size: PositiveInt = 50
    email_processing_lease_minutes: PositiveInt = 10
    email_delivery_poll_interval_seconds: float = Field(default=5.0, gt=0, le=300)
    cors_allowed_origins: list[str] = [
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ]

    @model_validator(mode="after")
    def validate_token_lifetimes(self) -> "Settings":
        if (
            self.password_change_token_expire_minutes
            >= self.access_token_expire_minutes
        ):
            raise ValueError("Password-change tokens must expire before access tokens.")
        return self

    @model_validator(mode="after")
    def validate_email_delivery_configuration(self) -> "Settings":
        if self.email_delivery_enabled:
            if not self.smtp_host:
                raise ValueError(
                    "SMTP_HOST is required when EMAIL_DELIVERY_ENABLED is true."
                )
            if self.email_from_address is None:
                raise ValueError(
                    "EMAIL_FROM_ADDRESS is required when EMAIL_DELIVERY_ENABLED is true."
                )
            if (self.smtp_username is None) != (self.smtp_password is None):
                raise ValueError(
                    "SMTP_USERNAME and SMTP_PASSWORD must be configured together."
                )
        return self

    @field_validator(
        "smtp_host",
        "smtp_username",
        "email_from_address",
        "email_reply_to",
        "email_from_name",
        "email_support_name",
        "email_product_name",
        mode="before",
    )
    @classmethod
    def strip_email_configuration(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("smtp_password", mode="before")
    @classmethod
    def normalize_empty_smtp_password(cls, value: object) -> object:
        return None if value == "" else value

    @field_validator("cors_allowed_origins")
    @classmethod
    def validate_cors_allowed_origins(cls, origins: list[str]) -> list[str]:
        if not origins:
            raise ValueError("At least one CORS origin must be configured.")

        normalized_origins: list[str] = []
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                origin == "*"
                or parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path not in {"", "/"}
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(f"Invalid CORS origin: {origin!r}.")

            normalized_origin = f"{parsed.scheme}://{parsed.netloc}"
            if normalized_origin not in normalized_origins:
                normalized_origins.append(normalized_origin)

        return normalized_origins

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )


settings = Settings()
