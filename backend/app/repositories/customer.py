from __future__ import annotations

from datetime import date

from sqlalchemy import and_, func, or_, select, union
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, load_only

from app.models.customer import Customer
from app.repositories.exceptions import (
    DuplicateCustomerNumberError,
    is_mysql_duplicate_constraint,
)
from app.schemas.customer import CustomerSearchKind

CUSTOMER_NUMBER_UNIQUE_CONSTRAINT = "uq_customers_customer_number"
DIRECTORY_COLUMNS = (
    Customer.id,
    Customer.customer_number,
    Customer.first_name,
    Customer.last_name,
    Customer.email,
    Customer.phone,
    Customer.city,
    Customer.country,
    Customer.is_active,
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CustomerRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, customer_id: int) -> Customer | None:
        return self.db.get(Customer, customer_id)

    def get_by_id_for_update(self, customer_id: int) -> Customer | None:
        statement = select(Customer).where(Customer.id == customer_id).with_for_update()
        return self.db.scalar(statement)

    def has_possible_duplicate(
        self,
        *,
        email: str | None,
        phone: str | None,
        first_name: str,
        last_name: str,
        date_of_birth: date | None,
        exclude_customer_id: int | None = None,
    ) -> bool:
        signals = []
        if email is not None:
            signals.append(Customer.email == email)
        if phone is not None:
            signals.append(Customer.phone == phone)
        if date_of_birth is not None:
            signals.append(
                and_(
                    Customer.first_name == first_name,
                    Customer.last_name == last_name,
                    Customer.date_of_birth == date_of_birth,
                )
            )
        if not signals:
            return False
        statement = select(Customer.id).where(or_(*signals)).limit(1)
        if exclude_customer_id is not None:
            statement = statement.where(Customer.id != exclude_customer_id)
        return self.db.scalar(statement) is not None

    def list(
        self,
        *,
        is_active: bool | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Customer], int]:
        conditions = []
        if is_active is not None:
            conditions.append(Customer.is_active.is_(is_active))
        return self._page(conditions, page=page, page_size=page_size)

    def search(
        self,
        *,
        kind: CustomerSearchKind,
        value: str,
        is_active: bool | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Customer], int]:
        conditions = []
        if is_active is not None:
            conditions.append(Customer.is_active.is_(is_active))
        if kind == CustomerSearchKind.CUSTOMER_NUMBER:
            conditions.append(Customer.customer_number == value)
        elif kind == CustomerSearchKind.EMAIL:
            conditions.append(Customer.email == value)
        elif kind == CustomerSearchKind.PHONE:
            conditions.append(Customer.phone == value)
        else:
            tokens = value.split()
            first = f"{_escape_like(tokens[0])}%"
            if len(tokens) == 1:
                return self._page_one_token_name(
                    first,
                    is_active=is_active,
                    page=page,
                    page_size=page_size,
                )
            second = f"{_escape_like(tokens[1])}%"
            conditions.append(
                or_(
                    and_(
                        Customer.first_name.like(first, escape="\\"),
                        Customer.last_name.like(second, escape="\\"),
                    ),
                    and_(
                        Customer.last_name.like(first, escape="\\"),
                        Customer.first_name.like(second, escape="\\"),
                    ),
                )
            )
        return self._page(conditions, page=page, page_size=page_size)

    def _page_one_token_name(
        self,
        prefix: str,
        *,
        is_active: bool | None,
        page: int,
        page_size: int,
    ) -> tuple[list[Customer], int]:
        # Each UNION branch has equality on the leading activity column and a
        # range on one name column, allowing the matching composite index to
        # bound the scan. Splitting the two activity values also preserves that
        # shape for the include-all case. UNION removes customers matching both
        # their first and last name before counting and paging.
        activity_values = (True, False) if is_active is None else (is_active,)
        branches = []
        for activity_value in activity_values:
            branches.extend(
                (
                    select(Customer.id).where(
                        Customer.is_active.is_(activity_value),
                        Customer.first_name.like(prefix, escape="\\"),
                    ),
                    select(Customer.id).where(
                        Customer.is_active.is_(activity_value),
                        Customer.last_name.like(prefix, escape="\\"),
                    ),
                )
            )
        matches = union(*branches).subquery("customer_name_matches")
        total = self.db.scalar(select(func.count()).select_from(matches)) or 0
        statement = (
            select(Customer)
            .options(load_only(*DIRECTORY_COLUMNS))
            .join(matches, matches.c.id == Customer.id)
            .order_by(
                Customer.last_name.asc(), Customer.first_name.asc(), Customer.id.asc()
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(statement).all()), total

    def _page(
        self,
        conditions: list[object],
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[Customer], int]:
        count_statement = select(func.count()).select_from(Customer).where(*conditions)
        total = self.db.scalar(count_statement) or 0
        statement = (
            select(Customer)
            .options(load_only(*DIRECTORY_COLUMNS))
            .where(*conditions)
            .order_by(
                Customer.last_name.asc(), Customer.first_name.asc(), Customer.id.asc()
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(self.db.scalars(statement).all()), total

    def save(self, customer: Customer) -> Customer:
        self.db.add(customer)
        try:
            self.db.flush()
        except IntegrityError as error:
            if is_mysql_duplicate_constraint(error, CUSTOMER_NUMBER_UNIQUE_CONSTRAINT):
                raise DuplicateCustomerNumberError from error
            raise
        self.db.refresh(customer)
        return customer
