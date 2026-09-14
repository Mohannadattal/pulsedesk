from typing import Literal

from pydantic import Field, PositiveInt, SecretStr
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

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore",
    )


settings = Settings()
