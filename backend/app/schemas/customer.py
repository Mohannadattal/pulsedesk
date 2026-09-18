import re
import unicodedata
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Self

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)

from app.models.customer_verification import VerificationFactor
from app.schemas.types import UtcDateTime

E164_PATTERN = re.compile(r"^\+[1-9][0-9]{1,14}$")
EMAIL_ADAPTER = TypeAdapter(EmailStr)
ISO_3166_ALPHA_2 = frozenset(
    [
        "AD",
        "AE",
        "AF",
        "AG",
        "AI",
        "AL",
        "AM",
        "AO",
        "AQ",
        "AR",
        "AS",
        "AT",
        "AU",
        "AW",
        "AX",
        "AZ",
        "BA",
        "BB",
        "BD",
        "BE",
        "BF",
        "BG",
        "BH",
        "BI",
        "BJ",
        "BL",
        "BM",
        "BN",
        "BO",
        "BR",
        "BS",
        "BT",
        "BV",
        "BW",
        "BY",
        "BZ",
        "CA",
        "CC",
        "CD",
        "CF",
        "CG",
        "CH",
        "CI",
        "CK",
        "CL",
        "CM",
        "CN",
        "CO",
        "CR",
        "CU",
        "CV",
        "CW",
        "CX",
        "CY",
        "CZ",
        "DE",
        "DJ",
        "DK",
        "DM",
        "DO",
        "DZ",
        "EC",
        "EE",
        "EG",
        "EH",
        "ER",
        "ES",
        "ET",
        "FI",
        "FJ",
        "FK",
        "FM",
        "FO",
        "FR",
        "GA",
        "GB",
        "GD",
        "GE",
        "GF",
        "GG",
        "GH",
        "GI",
        "GL",
        "GM",
        "GN",
        "GP",
        "GQ",
        "GR",
        "GS",
        "GT",
        "GU",
        "GW",
        "GY",
        "HK",
        "HM",
        "HN",
        "HR",
        "HT",
        "HU",
        "ID",
        "IE",
        "IL",
        "IM",
        "IN",
        "IO",
        "IQ",
        "IR",
        "IS",
        "IT",
        "JE",
        "JM",
        "JO",
        "JP",
        "KE",
        "KG",
        "KH",
        "KI",
        "KM",
        "KN",
        "KP",
        "KR",
        "KW",
        "KY",
        "KZ",
        "LA",
        "LB",
        "LC",
        "LI",
        "LK",
        "LR",
        "LS",
        "LT",
        "LU",
        "LV",
        "LY",
        "MA",
        "MC",
        "MD",
        "ME",
        "MF",
        "MG",
        "MH",
        "MK",
        "ML",
        "MM",
        "MN",
        "MO",
        "MP",
        "MQ",
        "MR",
        "MS",
        "MT",
        "MU",
        "MV",
        "MW",
        "MX",
        "MY",
        "MZ",
        "NA",
        "NC",
        "NE",
        "NF",
        "NG",
        "NI",
        "NL",
        "NO",
        "NP",
        "NR",
        "NU",
        "NZ",
        "OM",
        "PA",
        "PE",
        "PF",
        "PG",
        "PH",
        "PK",
        "PL",
        "PM",
        "PN",
        "PR",
        "PS",
        "PT",
        "PW",
        "PY",
        "QA",
        "RE",
        "RO",
        "RS",
        "RU",
        "RW",
        "SA",
        "SB",
        "SC",
        "SD",
        "SE",
        "SG",
        "SH",
        "SI",
        "SJ",
        "SK",
        "SL",
        "SM",
        "SN",
        "SO",
        "SR",
        "SS",
        "ST",
        "SV",
        "SX",
        "SY",
        "SZ",
        "TC",
        "TD",
        "TF",
        "TG",
        "TH",
        "TJ",
        "TK",
        "TL",
        "TM",
        "TN",
        "TO",
        "TR",
        "TT",
        "TV",
        "TW",
        "TZ",
        "UA",
        "UG",
        "UM",
        "US",
        "UY",
        "UZ",
        "VA",
        "VC",
        "VE",
        "VG",
        "VI",
        "VN",
        "VU",
        "WF",
        "WS",
        "YE",
        "YT",
        "ZA",
        "ZM",
        "ZW",
    ]
)


def normalize_text(value: str) -> str:
    return unicodedata.normalize("NFC", value.strip())


def normalize_optional_text(value: object) -> object:
    if isinstance(value, str):
        return normalize_text(value) or None
    return value


def normalize_email(value: object) -> object:
    normalized = normalize_optional_text(value)
    return normalized.lower() if isinstance(normalized, str) else normalized


def normalize_phone(value: object) -> object:
    normalized = normalize_optional_text(value)
    if isinstance(normalized, str) and not E164_PATTERN.fullmatch(normalized):
        raise ValueError("Phone must be a canonical international E.164 number.")
    return normalized


class CustomerFields(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    date_of_birth: date | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=16)
    street: str | None = Field(default=None, max_length=150)
    house_number: str | None = Field(default=None, max_length=30)
    postal_code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, min_length=2, max_length=2)

    @field_validator("first_name", "last_name", mode="before")
    @classmethod
    def normalize_required_text(cls, value: object) -> object:
        return normalize_text(value) if isinstance(value, str) else value

    @field_validator("street", "house_number", "postal_code", "city", mode="before")
    @classmethod
    def normalize_nullable_text(cls, value: object) -> object:
        return normalize_optional_text(value)

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email_field(cls, value: object) -> object:
        return normalize_email(value)

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone_field(cls, value: object) -> object:
        return normalize_phone(value)

    @field_validator("country", mode="before")
    @classmethod
    def normalize_country(cls, value: object) -> object:
        normalized = normalize_optional_text(value)
        if normalized is None:
            return None
        if not isinstance(normalized, str):
            return normalized
        country = normalized.upper()
        if country not in ISO_3166_ALPHA_2:
            raise ValueError("Country must be an ISO 3166-1 alpha-2 code.")
        return country

    @field_validator("date_of_birth")
    @classmethod
    def reject_future_birth_date(cls, value: date | None) -> date | None:
        if value is not None and value > datetime.now(UTC).date():
            raise ValueError("Date of birth cannot be in the future.")
        return value


class CustomerCreate(CustomerFields):
    confirm_possible_duplicate: bool = False

    @model_validator(mode="after")
    def require_contact(self) -> Self:
        if self.email is None and self.phone is None:
            raise ValueError("At least one contact method is required.")
        return self


class CustomerUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    date_of_birth: date | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=16)
    street: str | None = Field(default=None, max_length=150)
    house_number: str | None = Field(default=None, max_length=30)
    postal_code: str | None = Field(default=None, max_length=20)
    city: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    confirm_possible_duplicate: bool = False

    _required_text = field_validator("first_name", "last_name", mode="before")(
        CustomerFields.normalize_required_text.__func__
    )
    _nullable_text = field_validator(
        "street", "house_number", "postal_code", "city", mode="before"
    )(CustomerFields.normalize_nullable_text.__func__)
    _email = field_validator("email", mode="before")(
        CustomerFields.normalize_email_field.__func__
    )
    _phone = field_validator("phone", mode="before")(
        CustomerFields.normalize_phone_field.__func__
    )
    _country = field_validator("country", mode="before")(
        CustomerFields.normalize_country.__func__
    )
    _birth_date = field_validator("date_of_birth")(
        CustomerFields.reject_future_birth_date.__func__
    )

    @model_validator(mode="after")
    def validate_patch(self) -> Self:
        mutable = self.model_fields_set - {"confirm_possible_duplicate"}
        if not mutable:
            raise ValueError("At least one customer field must be provided.")
        if "first_name" in mutable and self.first_name is None:
            raise ValueError("First name cannot be null.")
        if "last_name" in mutable and self.last_name is None:
            raise ValueError("Last name cannot be null.")
        return self


class CustomerActivationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool


class CustomerSearchKind(StrEnum):
    CUSTOMER_NUMBER = "CUSTOMER_NUMBER"
    EMAIL = "EMAIL"
    PHONE = "PHONE"
    NAME = "NAME"


class CustomerSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: CustomerSearchKind
    value: str = Field(min_length=1, max_length=254)
    is_active: bool | None = True
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)

    @field_validator("value", mode="before")
    @classmethod
    def normalize_value(cls, value: object) -> object:
        return normalize_text(value) if isinstance(value, str) else value

    @model_validator(mode="after")
    def normalize_for_kind(self) -> Self:
        if self.kind == CustomerSearchKind.EMAIL:
            self.value = str(EMAIL_ADAPTER.validate_python(self.value)).lower()
        elif self.kind == CustomerSearchKind.PHONE:
            self.value = str(normalize_phone(self.value))
        elif self.kind == CustomerSearchKind.CUSTOMER_NUMBER:
            self.value = self.value.upper()
            if not re.fullmatch(r"CUS-[0-9A-HJKMNP-TV-Z]{16}", self.value):
                raise ValueError("Customer number format is invalid.")
        else:
            tokens = self.value.split()
            if len(tokens) > 2:
                raise ValueError("Name search accepts at most two tokens.")
        return self


class CustomerDirectoryFilters(BaseModel):
    is_active: bool | None = True
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class CustomerDirectoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_number: str
    first_name: str
    last_name: str
    email: EmailStr | None
    phone: str | None
    city: str | None
    country: str | None
    is_active: bool


class CustomerDirectoryListResponse(BaseModel):
    items: list[CustomerDirectoryResponse]
    page: int
    page_size: int
    total: int
    total_pages: int


class CustomerProfileResponse(CustomerDirectoryResponse):
    date_of_birth: date | None
    street: str | None
    house_number: str | None
    postal_code: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class CustomerReference(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_number: str
    first_name: str
    last_name: str


class CustomerVerificationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    factors: list[VerificationFactor] = Field(min_length=2, max_length=2)

    @field_validator("factors")
    @classmethod
    def require_distinct_factors(
        cls, value: list[VerificationFactor]
    ) -> list[VerificationFactor]:
        if len(set(value)) != len(value):
            raise ValueError("Verification factors must be distinct.")
        return value


class CustomerVerificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    verified_by_user_id: int
    factors: list[VerificationFactor]
    verified_at: UtcDateTime
    expires_at: UtcDateTime


class CurrentCustomerVerification(BaseModel):
    """Safe projection for restoring the current actor's verification."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int
    verified_at: UtcDateTime
    expires_at: UtcDateTime


class CurrentCustomerVerificationResponse(BaseModel):
    verification: CurrentCustomerVerification | None
