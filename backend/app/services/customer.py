import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.exceptions.auth import AuthorizationError
from app.exceptions.customer import (
    CustomerContactRequiredError,
    CustomerNotFoundError,
    CustomerNumberAllocationError,
    CustomerPotentialDuplicateError,
    CustomerVerificationFactorUnavailableError,
    InactiveCustomerError,
)
from app.models.customer import Customer
from app.models.customer_verification import CustomerVerification, VerificationFactor
from app.models.user import User, UserRole
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.exceptions import DuplicateCustomerNumberError
from app.schemas.customer import (
    CustomerCreate,
    CustomerDirectoryFilters,
    CustomerDirectoryListResponse,
    CustomerSearchRequest,
    CustomerUpdate,
    CurrentCustomerVerification,
    CustomerVerificationCreate,
)
from app.utils.time import utc_now_naive

CUSTOMER_NUMBER_ATTEMPTS = 3
CUSTOMER_NUMBER_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
VERIFICATION_VALIDITY = timedelta(minutes=30)
CUSTOMER_MUTABLE_FIELDS = (
    "first_name",
    "last_name",
    "date_of_birth",
    "email",
    "phone",
    "street",
    "house_number",
    "postal_code",
    "city",
    "country",
)
DUPLICATE_SIGNAL_FIELDS = {
    "first_name",
    "last_name",
    "date_of_birth",
    "email",
    "phone",
}


def _generate_customer_number() -> str:
    number = int.from_bytes(secrets.token_bytes(10), "big")
    encoded = "".join(
        CUSTOMER_NUMBER_ALPHABET[(number >> shift) & 31] for shift in range(75, -1, -5)
    )
    return f"CUS-{encoded}"


class CustomerService:
    def __init__(
        self,
        db: Session,
        customer_repository: CustomerRepository,
        verification_repository: CustomerVerificationRepository,
    ) -> None:
        self.db = db
        self.customer_repository = customer_repository
        self.verification_repository = verification_repository

    def create_customer(self, data: CustomerCreate, actor: User) -> Customer:
        self._require_directory_role(actor)
        if not data.confirm_possible_duplicate and self._has_duplicate(data):
            self.db.rollback()
            raise CustomerPotentialDuplicateError

        last_collision: DuplicateCustomerNumberError | None = None
        for _attempt in range(CUSTOMER_NUMBER_ATTEMPTS):
            now = utc_now_naive()
            customer = Customer(
                customer_number=_generate_customer_number(),
                first_name=data.first_name,
                last_name=data.last_name,
                date_of_birth=data.date_of_birth,
                email=str(data.email) if data.email is not None else None,
                phone=data.phone,
                street=data.street,
                house_number=data.house_number,
                postal_code=data.postal_code,
                city=data.city,
                country=data.country,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            try:
                customer = self.customer_repository.save(customer)
                self.db.commit()
                return customer
            except DuplicateCustomerNumberError as error:
                self.db.rollback()
                last_collision = error
            except Exception:
                self.db.rollback()
                raise
        allocation_error = CustomerNumberAllocationError(CUSTOMER_NUMBER_ATTEMPTS)
        if last_collision is not None:
            raise allocation_error from last_collision
        raise allocation_error

    def list_customers(
        self, filters: CustomerDirectoryFilters, actor: User
    ) -> CustomerDirectoryListResponse:
        self._require_directory_role(actor)
        customers, total = self.customer_repository.list(
            is_active=filters.is_active,
            page=filters.page,
            page_size=filters.page_size,
        )
        return CustomerDirectoryListResponse(
            items=customers,
            page=filters.page,
            page_size=filters.page_size,
            total=total,
            total_pages=(total + filters.page_size - 1) // filters.page_size,
        )

    def search_customers(
        self, data: CustomerSearchRequest, actor: User
    ) -> CustomerDirectoryListResponse:
        self._require_directory_role(actor)
        customers, total = self.customer_repository.search(
            kind=data.kind,
            value=data.value,
            is_active=data.is_active,
            page=data.page,
            page_size=data.page_size,
        )
        return CustomerDirectoryListResponse(
            items=customers,
            page=data.page,
            page_size=data.page_size,
            total=total,
            total_pages=(total + data.page_size - 1) // data.page_size,
        )

    def get_customer(self, customer_id: int, actor: User) -> Customer:
        self._require_directory_role(actor)
        customer = self.customer_repository.get_by_id(customer_id)
        if customer is None:
            raise CustomerNotFoundError
        return customer

    def update_customer(
        self, customer_id: int, data: CustomerUpdate, actor: User
    ) -> Customer:
        self._require_directory_role(actor)
        try:
            customer = self.customer_repository.get_by_id_for_update(customer_id)
            if customer is None:
                raise CustomerNotFoundError
            if actor.role == UserRole.EMPLOYEE.value and not customer.is_active:
                raise AuthorizationError

            submitted = data.model_fields_set - {"confirm_possible_duplicate"}
            for field in CUSTOMER_MUTABLE_FIELDS:
                if field in submitted:
                    value = getattr(data, field)
                    if field == "email" and value is not None:
                        value = str(value)
                    setattr(customer, field, value)
            if customer.email is None and customer.phone is None:
                raise CustomerContactRequiredError
            if (
                submitted & DUPLICATE_SIGNAL_FIELDS
                and not data.confirm_possible_duplicate
                and self.customer_repository.has_possible_duplicate(
                    email=customer.email,
                    phone=customer.phone,
                    first_name=customer.first_name,
                    last_name=customer.last_name,
                    date_of_birth=customer.date_of_birth,
                    exclude_customer_id=customer.id,
                )
            ):
                raise CustomerPotentialDuplicateError

            customer.updated_at = utc_now_naive()
            customer = self.customer_repository.save(customer)
            self.db.commit()
            return customer
        except Exception:
            self.db.rollback()
            raise

    def update_activation(
        self, customer_id: int, is_active: bool, actor: User
    ) -> Customer:
        if actor.role != UserRole.ADMIN.value:
            raise AuthorizationError
        try:
            customer = self.customer_repository.get_by_id_for_update(customer_id)
            if customer is None:
                raise CustomerNotFoundError
            if customer.is_active != is_active:
                customer.is_active = is_active
                customer.updated_at = utc_now_naive()
                customer = self.customer_repository.save(customer)
            self.db.commit()
            return customer
        except Exception:
            self.db.rollback()
            raise

    def create_verification(
        self,
        customer_id: int,
        data: CustomerVerificationCreate,
        actor: User,
    ) -> CustomerVerification:
        self._require_directory_role(actor)
        try:
            customer = self.customer_repository.get_by_id_for_update(customer_id)
            if customer is None:
                raise CustomerNotFoundError
            if not customer.is_active:
                raise InactiveCustomerError
            unavailable = [
                factor
                for factor in data.factors
                if not self._factor_available(customer, factor)
            ]
            if unavailable:
                raise CustomerVerificationFactorUnavailableError
            now = utc_now_naive()
            verification = self.verification_repository.create(
                CustomerVerification(
                    customer_id=customer.id,
                    verified_by_user_id=actor.id,
                    factors=[factor.value for factor in data.factors],
                    verified_at=now,
                    expires_at=now + VERIFICATION_VALIDITY,
                )
            )
            self.db.commit()
            return verification
        except Exception:
            self.db.rollback()
            raise

    def get_current_verification(
        self, customer_id: int, actor: User
    ) -> CurrentCustomerVerification | None:
        self.get_customer(customer_id, actor)
        verification = self.verification_repository.get_current(
            customer_id=customer_id,
            verified_by_user_id=actor.id,
            now=utc_now_naive(),
        )
        if verification is None:
            return None
        return CurrentCustomerVerification.model_validate(verification)

    def _has_duplicate(self, data: CustomerCreate) -> bool:
        return self.customer_repository.has_possible_duplicate(
            email=str(data.email) if data.email is not None else None,
            phone=data.phone,
            first_name=data.first_name,
            last_name=data.last_name,
            date_of_birth=data.date_of_birth,
        )

    @staticmethod
    def _factor_available(customer: Customer, factor: VerificationFactor) -> bool:
        if factor == VerificationFactor.DATE_OF_BIRTH:
            return customer.date_of_birth is not None
        if factor == VerificationFactor.POSTAL_CODE:
            return customer.postal_code is not None
        if factor == VerificationFactor.PHONE:
            return customer.phone is not None
        return customer.street is not None and customer.city is not None

    @staticmethod
    def _require_directory_role(actor: User) -> None:
        if actor.role not in {UserRole.EMPLOYEE.value, UserRole.ADMIN.value}:
            raise AuthorizationError
