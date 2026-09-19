from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, PositiveInt, SecretStr, field_validator, model_validator
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
