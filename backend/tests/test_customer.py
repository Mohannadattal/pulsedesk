import unittest
from datetime import UTC, date, datetime, timedelta
from unittest.mock import Mock, patch

from pydantic import ValidationError
from sqlalchemy import create_engine, event, inspect, select
from sqlalchemy.dialects.mysql import BIGINT
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker

import app.models
from app.database.base import Base
from app.exceptions.auth import AuthorizationError
from app.exceptions.customer import (
    CustomerContactRequiredError,
    CustomerNumberAllocationError,
    CustomerPotentialDuplicateError,
    CustomerVerificationFactorUnavailableError,
    CustomerVerificationInvalidError,
    InactiveCustomerError,
)
from app.main import app as fastapi_app
from app.models.category import Category
from app.models.customer import Customer
from app.models.customer_verification import CustomerVerification
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.exceptions import DuplicateCustomerNumberError
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_comment import TicketCommentRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.customer import (
    CustomerCreate,
    CustomerDirectoryFilters,
    CustomerDirectoryResponse,
    CustomerSearchRequest,
    CustomerUpdate,
    CustomerVerificationCreate,
)
from app.schemas.ticket import TicketCreate, TicketListFilters, TicketResponse
from app.schemas.ticket_comment import TicketCommentCreate, TicketCommentListFilters
from app.schemas.ticket_event import TicketEventListFilters
from app.services.customer import CustomerService
from app.services.ticket import TicketService
from app.services.ticket_comment import TicketCommentService
from app.services.ticket_event import TicketEventRecorder, TicketEventService


@compiles(BIGINT, "sqlite")
def compile_bigint_for_sqlite(
    _type: BIGINT, _compiler: object, **_kwargs: object
) -> str:
    return "INTEGER"


class CustomerTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        self.now = datetime(2026, 9, 17, 10, 0, 0)  # noqa: DTZ001
        with self.session_factory() as db:
            db.add_all(
                [
                    self.user(1, UserRole.EMPLOYEE),
                    self.user(2, UserRole.AGENT),
                    self.user(3, UserRole.ADMIN),
                    Category(
                        id=10,
                        name="Support",
                        description=None,
                        is_active=True,
                        created_at=self.now,
                        updated_at=self.now,
                    ),
                ]
            )
            db.commit()

    def tearDown(self) -> None:
        self.engine.dispose()

    def user(self, user_id: int, role: UserRole) -> User:
        return User(
            id=user_id,
            email=f"user{user_id}@example.com",
            password_hash="hash",
            first_name="User",
            last_name=str(user_id),
            role=role.value,
            is_active=True,
            created_at=self.now,
            updated_at=self.now,
        )

    def service(self, db: Session) -> CustomerService:
        return CustomerService(
            db,
            CustomerRepository(db),
            CustomerVerificationRepository(db),
        )

    def ticket_service(self, db: Session) -> TicketService:
        return TicketService(
            db,
            TicketRepository(db),
            CategoryRepository(db),
            UserRepository(db),
            TicketEventRecorder(TicketEventRepository(db)),
            CustomerRepository(db),
            CustomerVerificationRepository(db),
        )

    def create(
        self,
        db: Session,
        *,
        email: str | None = "customer@example.net",
        phone: str | None = None,
        first_name: str = "Éva",
        last_name: str = "Müller",
        date_of_birth: date | None = date(1990, 1, 2),
        confirm: bool = False,
    ) -> Customer:
        actor = db.get(User, 1)
        assert actor is not None
        return self.service(db).create_customer(
            CustomerCreate(
                first_name=first_name,
                last_name=last_name,
                date_of_birth=date_of_birth,
                email=email,
                phone=phone,
                street=" Main Street ",
                postal_code=" 10001 ",
                city=" New York ",
                country="us",
                confirm_possible_duplicate=confirm,
            ),
            actor,
        )


class CustomerSchemaTests(CustomerTestCase):
    def test_contact_normalization_and_validation(self) -> None:
        value = CustomerCreate(
            first_name="  E\u0301va ",
            last_name=" Test ",
            email=" Person@External.Example ",
            phone=" +14155552671 ",
            country="de",
        )
        self.assertEqual(value.first_name, "Éva")
        self.assertEqual(str(value.email), "person@external.example")
        self.assertEqual(value.phone, "+14155552671")
        self.assertEqual(value.country, "DE")
        for values in (
            {"email": None, "phone": None},
            {"email": None, "phone": "01761234567"},
            {"email": None, "phone": "+01"},
        ):
            with self.assertRaises(ValidationError):
                CustomerCreate(first_name="A", last_name="B", **values)
        with self.assertRaises(ValidationError):
            CustomerCreate(
                first_name="A",
                last_name="B",
                email="a@example.com",
                date_of_birth=datetime.now(UTC).date() + timedelta(days=1),
            )

    def test_update_rejects_empty_immutable_and_invalid_country(self) -> None:
        for values in (
            {},
            {"confirm_possible_duplicate": True},
            {"customer_number": "x"},
        ):
            with self.assertRaises(ValidationError):
                CustomerUpdate(**values)
        with self.assertRaises(ValidationError):
            CustomerUpdate(country="ZZ")

    def test_verification_contract_allows_only_two_distinct_controlled_factors(
        self,
    ) -> None:
        valid = CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "PHONE"])
        self.assertEqual(len(valid.factors), 2)
        for factors in (
            ["PHONE"],
            ["PHONE", "PHONE"],
            ["PHONE", "OTHER"],
            ["PHONE", "POSTAL_CODE", "ADDRESS"],
        ):
            with self.assertRaises(ValidationError):
                CustomerVerificationCreate(factors=factors)

    def test_ticket_create_forbids_creator_and_requires_customer_for_verification(
        self,
    ) -> None:
        with self.assertRaises(ValidationError):
            TicketCreate(title="No", description="No", category_id=10, created_by_id=1)
        with self.assertRaises(ValidationError):
            TicketCreate(
                title="No",
                description="No",
                category_id=10,
                customer_verification_id=1,
            )


class CustomerServiceTests(CustomerTestCase):
    def test_creation_variants_number_and_directory_projection(self) -> None:
        with self.session_factory() as db:
            email_only = self.create(db)
            phone_only = self.create(
                db,
                email=None,
                phone="+442071838750",
                first_name="Ada",
                last_name="Lovelace",
                date_of_birth=None,
            )
            both = self.create(
                db,
                email="shared@outside.org",
                phone="+33142345678",
                first_name="Grace",
                last_name="Hopper",
                date_of_birth=None,
            )
            for customer in (email_only, phone_only, both):
                self.assertRegex(
                    customer.customer_number,
                    r"^CUS-[0-9A-HJKMNP-TV-Z]{16}$",
                )
            projection = CustomerDirectoryResponse.model_validate(email_only)
            dumped = projection.model_dump()
            for field in (
                "date_of_birth",
                "street",
                "house_number",
                "postal_code",
            ):
                self.assertNotIn(field, dumped)

    def test_duplicate_signals_require_confirmation_but_name_or_dob_alone_do_not(
        self,
    ) -> None:
        with self.session_factory() as db:
            original = self.create(db, phone="+14155552671")
            with self.assertRaises(CustomerPotentialDuplicateError):
                self.create(
                    db,
                    email=str(original.email),
                    first_name="Different",
                    last_name="Person",
                    date_of_birth=None,
                )
            with self.assertRaises(CustomerPotentialDuplicateError):
                self.create(
                    db,
                    email="phone-duplicate@example.net",
                    phone="+14155552671",
                    first_name="Phone",
                    last_name="Duplicate",
                    date_of_birth=None,
                )
            with self.assertRaises(CustomerPotentialDuplicateError):
                self.create(
                    db,
                    email="different@example.net",
                    first_name=original.first_name,
                    last_name=original.last_name,
                    date_of_birth=original.date_of_birth,
                )
            allowed = self.create(
                db,
                email=str(original.email),
                first_name="Different",
                last_name="Person",
                date_of_birth=None,
                confirm=True,
            )
            self.assertNotEqual(original.id, allowed.id)
            actor = db.get(User, 1)
            assert actor is not None
            shared_email = self.service(db).search_customers(
                CustomerSearchRequest(kind="EMAIL", value=str(original.email)),
                actor,
            )
            self.assertEqual(shared_email.total, 2)
            same_name = self.create(
                db,
                email="name-only@example.net",
                first_name=original.first_name,
                last_name=original.last_name,
                date_of_birth=None,
            )
            same_dob = self.create(
                db,
                email="dob-only@example.net",
                first_name="Other",
                last_name="Name",
                date_of_birth=original.date_of_birth,
            )
            self.assertIsNotNone(same_name.id)
            self.assertIsNotNone(same_dob.id)

    def test_search_pagination_order_and_private_projection(self) -> None:
        with self.session_factory() as db:
            first = self.create(db)
            self.create(
                db,
                email="second@example.net",
                first_name="Eva",
                last_name="Müller",
                date_of_birth=None,
            )
            actor = db.get(User, 1)
            assert actor is not None
            service = self.service(db)
            by_number = service.search_customers(
                CustomerSearchRequest(
                    kind="CUSTOMER_NUMBER", value=first.customer_number.lower()
                ),
                actor,
            )
            by_email = service.search_customers(
                CustomerSearchRequest(kind="EMAIL", value="CUSTOMER@EXAMPLE.NET"),
                actor,
            )
            by_name = service.search_customers(
                CustomerSearchRequest(kind="NAME", value="Mü É", page_size=1),
                actor,
            )
            self.assertEqual(by_number.total, 1)
            self.assertEqual(by_email.total, 1)
            self.assertEqual(by_name.total, 1)
            self.assertEqual(by_name.items[0].id, first.id)
            page = service.list_customers(
                CustomerDirectoryFilters(page=1, page_size=1), actor
            )
            self.assertEqual(page.total, 2)
            self.assertEqual(page.total_pages, 2)

    def test_one_token_name_search_deduplicates_filters_orders_and_pages(self) -> None:
        with self.session_factory() as db:
            first_name_match = self.create(
                db,
                email="first-name-match@example.net",
                first_name="Alex",
                last_name="Zulu",
                date_of_birth=None,
            )
            last_name_match = self.create(
                db,
                email="last-name-match@example.net",
                first_name="Beth",
                last_name="Alexanderson",
                date_of_birth=None,
            )
            both_branches = self.create(
                db,
                email="both-name-branches@example.net",
                first_name="Alexis",
                last_name="Alexandria",
                date_of_birth=None,
            )
            inactive = self.create(
                db,
                email="inactive-name-match@example.net",
                first_name="Alexa",
                last_name="Able",
                date_of_birth=None,
            )
            inactive.is_active = False
            db.commit()
            actor = db.get(User, 1)
            assert actor is not None

            active = self.service(db).search_customers(
                CustomerSearchRequest(kind="NAME", value="Alex"), actor
            )
            self.assertEqual(active.total, 3)
            self.assertEqual(
                [item.id for item in active.items],
                [last_name_match.id, both_branches.id, first_name_match.id],
            )
            self.assertEqual(
                [item.id for item in active.items].count(both_branches.id), 1
            )
            inactive_only = self.service(db).search_customers(
                CustomerSearchRequest(kind="NAME", value="Alex", is_active=False),
                actor,
            )
            self.assertEqual([item.id for item in inactive_only.items], [inactive.id])

            first_page = self.service(db).search_customers(
                CustomerSearchRequest(
                    kind="NAME", value="Alex", is_active=None, page=1, page_size=2
                ),
                actor,
            )
            second_page = self.service(db).search_customers(
                CustomerSearchRequest(
                    kind="NAME", value="Alex", is_active=None, page=2, page_size=2
                ),
                actor,
            )
            self.assertEqual(first_page.total, 4)
            self.assertEqual(first_page.total_pages, 2)
            self.assertEqual(
                [item.id for item in first_page.items + second_page.items],
                [
                    inactive.id,
                    last_name_match.id,
                    both_branches.id,
                    first_name_match.id,
                ],
            )

    def test_update_contact_activation_and_role_policy(self) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            employee = db.get(User, 1)
            agent = db.get(User, 2)
            admin = db.get(User, 3)
            assert employee and agent and admin
            service = self.service(db)
            updated = service.update_customer(
                customer.id,
                CustomerUpdate(email=None, phone="+12025550123", city=" Montréal "),
                employee,
            )
            self.assertIsNone(updated.email)
            self.assertEqual(updated.city, "Montréal")
            with self.assertRaises(CustomerContactRequiredError):
                service.update_customer(
                    customer.id, CustomerUpdate(phone=None), employee
                )
            service.update_activation(customer.id, False, admin)
            with self.assertRaises(AuthorizationError):
                service.update_customer(
                    customer.id, CustomerUpdate(city="Paris"), employee
                )
            service.update_customer(customer.id, CustomerUpdate(city="Paris"), admin)
            service.update_activation(customer.id, True, admin)
            with self.assertRaises(AuthorizationError):
                service.list_customers(CustomerDirectoryFilters(), agent)

    def test_relevant_update_runs_duplicate_detection(self) -> None:
        with self.session_factory() as db:
            first = self.create(db)
            second = self.create(
                db,
                email="second-update@example.net",
                first_name="Second",
                last_name="Customer",
                date_of_birth=None,
            )
            actor = db.get(User, 1)
            assert actor is not None
            with self.assertRaises(CustomerPotentialDuplicateError):
                self.service(db).update_customer(
                    second.id, CustomerUpdate(email=str(first.email)), actor
                )
            updated = self.service(db).update_customer(
                second.id,
                CustomerUpdate(email=str(first.email), confirm_possible_duplicate=True),
                actor,
            )
            self.assertEqual(updated.email, first.email)

    def test_number_collision_retries_three_times_and_exhausts(self) -> None:
        db = Mock(spec=Session)
        repository = Mock(spec=CustomerRepository)
        repository.has_possible_duplicate.return_value = False
        repository.save.side_effect = DuplicateCustomerNumberError
        service = CustomerService(db, repository, Mock())
        actor = Mock(id=1, role=UserRole.EMPLOYEE.value)
        with self.assertRaises(CustomerNumberAllocationError):
            service.create_customer(
                CustomerCreate(first_name="A", last_name="B", email="a@example.net"),
                actor,
            )
        self.assertEqual(repository.save.call_count, 3)
        self.assertEqual(db.rollback.call_count, 3)

    def test_number_collision_can_recover_on_third_attempt(self) -> None:
        db = Mock(spec=Session)
        repository = Mock(spec=CustomerRepository)
        repository.has_possible_duplicate.return_value = False
        saved: list[Customer] = []

        def save(customer: Customer) -> Customer:
            if len(saved) < 2:
                saved.append(customer)
                raise DuplicateCustomerNumberError
            return customer

        repository.save.side_effect = save
        service = CustomerService(db, repository, Mock())
        actor = Mock(id=1, role=UserRole.EMPLOYEE.value)
        customer = service.create_customer(
            CustomerCreate(first_name="A", last_name="B", email="a@example.net"),
            actor,
        )
        self.assertRegex(customer.customer_number, r"^CUS-[0-9A-HJKMNP-TV-Z]{16}$")
        self.assertEqual(repository.save.call_count, 3)
        db.commit.assert_called_once()

    def test_verification_records_only_factors_actor_and_thirty_minutes(self) -> None:
        with self.session_factory() as db:
            customer = self.create(db, phone="+14155552671")
            actor = db.get(User, 1)
            assert actor is not None
            with patch("app.services.customer.utc_now_naive", return_value=self.now):
                verification = self.service(db).create_verification(
                    customer.id,
                    CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "PHONE"]),
                    actor,
                )
            self.assertEqual(verification.verified_by_user_id, actor.id)
            self.assertEqual(
                verification.expires_at - verification.verified_at,
                timedelta(minutes=30),
            )
            self.assertEqual(set(verification.factors), {"DATE_OF_BIRTH", "PHONE"})
            self.assertFalse(hasattr(verification, "answers"))
            customer.postal_code = None
            customer.street = None
            customer.city = None
            customer.country = None
            db.commit()
            with self.assertRaises(CustomerVerificationFactorUnavailableError):
                self.service(db).create_verification(
                    customer.id,
                    CustomerVerificationCreate(factors=["POSTAL_CODE", "ADDRESS"]),
                    actor,
                )

    def test_current_verification_returns_newest_unexpired_for_customer_and_actor(
        self,
    ) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            other_customer = self.create(
                db,
                email="other-verification@example.net",
                first_name="Other",
            )
            employee = db.get(User, 1)
            admin = db.get(User, 3)
            assert employee is not None and admin is not None
            records = [
                CustomerVerification(
                    customer_id=customer.id,
                    verified_by_user_id=employee.id,
                    factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                    verified_at=self.now - timedelta(minutes=15),
                    expires_at=self.now + timedelta(minutes=15),
                ),
                CustomerVerification(
                    customer_id=customer.id,
                    verified_by_user_id=employee.id,
                    factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                    verified_at=self.now - timedelta(minutes=5),
                    expires_at=self.now + timedelta(minutes=25),
                ),
                CustomerVerification(
                    customer_id=customer.id,
                    verified_by_user_id=employee.id,
                    factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                    verified_at=self.now - timedelta(hours=1),
                    expires_at=self.now,
                ),
                CustomerVerification(
                    customer_id=customer.id,
                    verified_by_user_id=admin.id,
                    factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                    verified_at=self.now - timedelta(minutes=1),
                    expires_at=self.now + timedelta(minutes=29),
                ),
                CustomerVerification(
                    customer_id=other_customer.id,
                    verified_by_user_id=employee.id,
                    factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                    verified_at=self.now - timedelta(minutes=1),
                    expires_at=self.now + timedelta(minutes=29),
                ),
            ]
            db.add_all(records)
            db.commit()

            with patch("app.services.customer.utc_now_naive", return_value=self.now):
                current = self.service(db).get_current_verification(
                    customer.id, employee
                )

            assert current is not None
            self.assertEqual(current.id, records[1].id)
            self.assertEqual(current.customer_id, customer.id)
            self.assertEqual(current.expires_at, records[1].expires_at)
            self.assertEqual(
                set(current.model_dump()),
                {"id", "customer_id", "verified_at", "expires_at"},
            )

    def test_current_verification_returns_empty_for_expired_foreign_or_other_customer(
        self,
    ) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            other_customer = self.create(
                db,
                email="other-current@example.net",
                first_name="Other",
            )
            employee = db.get(User, 1)
            admin = db.get(User, 3)
            assert employee is not None and admin is not None
            db.add_all(
                [
                    CustomerVerification(
                        customer_id=customer.id,
                        verified_by_user_id=employee.id,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now - timedelta(hours=1),
                        expires_at=self.now,
                    ),
                    CustomerVerification(
                        customer_id=customer.id,
                        verified_by_user_id=admin.id,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now - timedelta(minutes=1),
                        expires_at=self.now + timedelta(minutes=29),
                    ),
                    CustomerVerification(
                        customer_id=other_customer.id,
                        verified_by_user_id=employee.id,
                        factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                        verified_at=self.now - timedelta(minutes=1),
                        expires_at=self.now + timedelta(minutes=29),
                    ),
                ]
            )
            db.commit()

            with patch("app.services.customer.utc_now_naive", return_value=self.now):
                current = self.service(db).get_current_verification(
                    customer.id, employee
                )

            self.assertIsNone(current)

    def test_current_verification_preserves_customer_role_authorization(self) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            agent = db.get(User, 2)
            assert agent is not None
            with self.assertRaises(AuthorizationError):
                self.service(db).get_current_verification(customer.id, agent)


class CustomerTicketIntegrationTests(CustomerTestCase):
    def test_customer_ticket_projection_verification_and_audit_privacy(self) -> None:
        with self.session_factory() as db:
            customer = self.create(db, phone="+14155552671")
            employee = db.get(User, 1)
            assert employee is not None
            verification = self.service(db).create_verification(
                customer.id,
                CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "PHONE"]),
                employee,
            )
            ticket = self.ticket_service(db).create_ticket(
                TicketCreate(
                    title="External request",
                    description="Needs help",
                    category_id=10,
                    customer_id=customer.id,
                    customer_verification_id=verification.id,
                ),
                employee,
            )
            response = TicketResponse.model_validate(ticket).model_dump(mode="json")
            self.assertEqual(response["customer_id"], customer.id)
            self.assertTrue(response["customer_was_verified"])
            self.assertEqual(
                response["customer"]["customer_number"], customer.customer_number
            )
            serialized = str(response)
            for private in (
                str(customer.date_of_birth),
                str(customer.email),
                str(customer.phone),
                str(customer.street),
                str(customer.postal_code),
            ):
                self.assertNotIn(private, serialized)

            event_row = db.scalar(
                select(app.models.TicketEvent).where(
                    app.models.TicketEvent.ticket_id == ticket.id
                )
            )
            assert event_row is not None
            self.assertEqual(
                set(event_row.event_metadata),
                {
                    "actor_display_name",
                    "customer_id",
                    "customer_number",
                    "customer_verification_id",
                },
            )

    def test_ticket_verification_rejects_expiry_boundary_and_accepts_unexpired(
        self,
    ) -> None:
        with self.session_factory() as db:
            customer = self.create(db, phone="+14155552671")
            employee = db.get(User, 1)
            assert employee is not None
            verification = self.service(db).create_verification(
                customer.id,
                CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "PHONE"]),
                employee,
            )
            data = TicketCreate(
                title="Expiry boundary",
                description="Verification boundary behavior",
                category_id=10,
                customer_id=customer.id,
                customer_verification_id=verification.id,
            )

            with (
                patch(
                    "app.services.ticket.utc_now_naive",
                    return_value=verification.expires_at,
                ),
                self.assertRaises(CustomerVerificationInvalidError),
            ):
                self.ticket_service(db).create_ticket(data, employee)

            with patch(
                "app.services.ticket.utc_now_naive",
                return_value=verification.expires_at - timedelta(microseconds=1),
            ):
                ticket = self.ticket_service(db).create_ticket(data, employee)
            self.assertEqual(ticket.customer_verification_id, verification.id)

    def test_ticket_validation_roles_history_and_employee_visibility(self) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            employee = db.get(User, 1)
            agent = db.get(User, 2)
            admin = db.get(User, 3)
            assert employee and agent and admin
            service = self.ticket_service(db)
            linked = service.create_ticket(
                TicketCreate(
                    title="Call",
                    description="Recorded",
                    category_id=10,
                    customer_id=customer.id,
                ),
                admin,
            )
            self.assertEqual(service.get_ticket(linked.id, employee).id, linked.id)
            history = service.list_customer_tickets(
                customer.id, TicketListFilters(), employee
            )
            self.assertEqual(history.total, 1)
            event_repository = TicketEventRepository(db)
            comment_service = TicketCommentService(
                db,
                service,
                TicketCommentRepository(db),
                TicketEventRecorder(event_repository),
            )
            comment_service.create_comment(
                linked.id,
                TicketCommentCreate(content="Public", visibility="PUBLIC"),
                admin,
            )
            comment_service.create_comment(
                linked.id,
                TicketCommentCreate(content="Internal", visibility="INTERNAL"),
                admin,
            )
            employee_comments = comment_service.list_comments(
                linked.id, TicketCommentListFilters(), employee
            )
            self.assertEqual(
                [comment.content for comment in employee_comments.items], ["Public"]
            )
            with self.assertRaises(AuthorizationError):
                TicketEventService(
                    service,
                    event_repository,
                    UserRepository(db),
                    CategoryRepository(db),
                ).list_events(linked.id, TicketEventListFilters(), employee)
            legacy = service.create_ticket(
                TicketCreate(title="Legacy", description="Internal", category_id=10),
                employee,
            )
            legacy_response = TicketResponse.model_validate(legacy)
            self.assertIsNone(legacy_response.customer_id)
            self.assertIsNone(legacy_response.customer)
            self.assertFalse(legacy_response.customer_was_verified)
            with self.assertRaises(AuthorizationError):
                service.create_ticket(
                    TicketCreate(title="No", description="No", category_id=10),
                    agent,
                )
            second_customer = self.create(
                db,
                email="second-ticket-customer@example.net",
                first_name="Second",
                last_name="Ticket Customer",
            )
            mismatched = self.service(db).create_verification(
                second_customer.id,
                CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "POSTAL_CODE"]),
                employee,
            )
            with self.assertRaises(CustomerVerificationInvalidError):
                service.create_ticket(
                    TicketCreate(
                        title="Mismatch",
                        description="No",
                        category_id=10,
                        customer_id=customer.id,
                        customer_verification_id=mismatched.id,
                    ),
                    employee,
                )
            foreign_actor = self.service(db).create_verification(
                customer.id,
                CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "POSTAL_CODE"]),
                admin,
            )
            with self.assertRaises(CustomerVerificationInvalidError):
                service.create_ticket(
                    TicketCreate(
                        title="Foreign actor",
                        description="No",
                        category_id=10,
                        customer_id=customer.id,
                        customer_verification_id=foreign_actor.id,
                    ),
                    employee,
                )
            verification = CustomerVerification(
                customer_id=customer.id,
                verified_by_user_id=admin.id,
                factors=["DATE_OF_BIRTH", "POSTAL_CODE"],
                verified_at=self.now - timedelta(hours=1),
                expires_at=self.now - timedelta(minutes=30),
            )
            db.add(verification)
            db.commit()
            with self.assertRaises(CustomerVerificationInvalidError):
                service.create_ticket(
                    TicketCreate(
                        title="Expired",
                        description="No",
                        category_id=10,
                        customer_id=customer.id,
                        customer_verification_id=verification.id,
                    ),
                    admin,
                )
            self.service(db).update_activation(customer.id, False, admin)
            with self.assertRaises(InactiveCustomerError):
                service.create_ticket(
                    TicketCreate(
                        title="Inactive",
                        description="No",
                        category_id=10,
                        customer_id=customer.id,
                    ),
                    employee,
                )
            self.assertEqual(service.get_ticket(linked.id, employee).id, linked.id)

    def test_ticket_eager_loads_only_narrow_customer_reference_without_n_plus_one(
        self,
    ) -> None:
        with self.session_factory() as db:
            customer = self.create(db)
            employee = db.get(User, 1)
            assert employee is not None
            service = self.ticket_service(db)
            for suffix in ("A", "B"):
                service.create_ticket(
                    TicketCreate(
                        title=suffix,
                        description=suffix,
                        category_id=10,
                        customer_id=customer.id,
                    ),
                    employee,
                )
            db.expunge_all()
            statements: list[str] = []

            def record(
                _conn: object,
                _cursor: object,
                statement: str,
                _params: object,
                _context: object,
                _many: object,
            ) -> None:
                statements.append(statement)

            event.listen(self.engine, "before_cursor_execute", record)
            try:
                tickets, total = TicketRepository(db).list(
                    status=None,
                    priority=None,
                    category_id=None,
                    assigned_to_id=None,
                    created_by_id=None,
                    customer_id=customer.id,
                    unassigned=None,
                    page=1,
                    page_size=20,
                )
                loaded_count = len(statements)
                payload = [TicketResponse.model_validate(item) for item in tickets]
            finally:
                event.remove(self.engine, "before_cursor_execute", record)
            self.assertEqual(total, 2)
            self.assertEqual(len(statements), loaded_count)
            self.assertEqual(len(payload), 2)
            for ticket in tickets:
                self.assertTrue(
                    {
                        "email",
                        "phone",
                        "date_of_birth",
                        "street",
                        "postal_code",
                    }.issubset(inspect(ticket.customer).unloaded)
                )


class CustomerOpenApiTests(unittest.TestCase):
    @staticmethod
    def response_schema(path: str, method: str, status_code: str) -> dict[str, object]:
        schema = fastapi_app.openapi()
        return schema["paths"][path][method]["responses"][status_code]["content"][
            "application/json"
        ]["schema"]

    def test_domain_422_responses_allow_error_and_validation_bodies(self) -> None:
        expected_refs = {
            "#/components/schemas/ErrorResponse",
            "#/components/schemas/ValidationErrorResponse",
        }
        for path, method in (
            ("/api/v1/tickets", "post"),
            ("/api/v1/customers/{customer_id}", "patch"),
            ("/api/v1/customers/{customer_id}/verifications", "post"),
            ("/api/v1/customers/{customer_id}/tickets", "get"),
        ):
            with self.subTest(path=path, method=method):
                response_schema = self.response_schema(path, method, "422")
                self.assertEqual(
                    {item["$ref"] for item in response_schema["anyOf"]},
                    expected_refs,
                )

    def test_ticket_create_describes_customer_404_and_409_failures(self) -> None:
        responses = fastapi_app.openapi()["paths"]["/api/v1/tickets"]["post"][
            "responses"
        ]
        self.assertIn("Customer", responses["404"]["description"])
        self.assertIn("verification", responses["404"]["description"])
        self.assertIn("Customer", responses["409"]["description"])

    def test_current_verification_contract_excludes_actor_and_factor_values(
        self,
    ) -> None:
        schemas = fastapi_app.openapi()["components"]["schemas"]
        properties = schemas["CurrentCustomerVerification"]["properties"]
        self.assertEqual(
            set(properties), {"id", "customer_id", "verified_at", "expires_at"}
        )
        self.assertNotIn("factors", properties)
        self.assertNotIn("verified_by_user_id", properties)


if __name__ == "__main__":
    unittest.main()
