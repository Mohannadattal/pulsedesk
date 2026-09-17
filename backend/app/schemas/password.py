from typing import Annotated

from pydantic import BeforeValidator, Field, SecretStr


def _protect_password_input(value: object) -> object:
    return SecretStr(value) if isinstance(value, str) else value


PasswordValue = Annotated[
    SecretStr,
    Field(min_length=8, max_length=128),
    BeforeValidator(_protect_password_input),
]
