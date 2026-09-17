import json
import logging
import os
import queue
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, delete, event, inspect, select, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.orm import Session, sessionmaker

import app.models  # noqa: F401
from app.core.config import settings
from app.exceptions.customer import (
    CustomerNumberAllocationError,
    CustomerVerificationInvalidError,
    InactiveCustomerError,
)
from app.models.category import Category
from app.models.customer import Customer
from app.models.customer_verification import CustomerVerification
from app.models.ticket import Ticket
from app.models.ticket_event import TicketEvent
from app.models.user import User, UserRole
from app.repositories.category import CategoryRepository
from app.repositories.customer import CustomerRepository
from app.repositories.customer_verification import CustomerVerificationRepository
from app.repositories.ticket import TicketRepository
from app.repositories.ticket_event import TicketEventRepository
from app.repositories.user import UserRepository
from app.schemas.customer import (
    CustomerCreate,
    CustomerSearchRequest,
    CustomerVerificationCreate,
)
from app.schemas.ticket import TicketCreate
from app.services.customer import CustomerService
from app.services.ticket import TicketService
from app.services.ticket_event import TicketEventRecorder


class PausingCustomerRepository(CustomerRepository):
    def __init__(
        self,
        db: Session,
        locked: threading.Event,
        release: threading.Event,
    ) -> None:
        super().__init__(db)
        self.locked = locked
        self.release = release

    def get_by_id_for_update(self, customer_id: int) -> Customer | None:
        customer = super().get_by_id_for_update(customer_id)
        self.locked.set()
        if not self.release.wait(timeout=10):
            raise RuntimeError("Timed out waiting to release customer lock.")
        return customer


class MySqlCustomerConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")
        self.engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=4,
            max_overflow=0,
        )
        self.factory = sessionmaker(
            bind=self.engine, autoflush=False, expire_on_commit=False
        )
        self.email_prefix = f"customer-mysql-{uuid4().hex}"
        with self.factory() as db:
            now = datetime(2026, 9, 17, 12, 0, 0)  # noqa: DTZ001
            user = User(
                email=f"{self.email_prefix}@example.com",
                password_hash="test-hash",
                first_name="MySQL",
                last_name="Employee",
                role=UserRole.EMPLOYEE.value,
                is_active=True,
                must_change_password=False,
                auth_version=0,
                created_at=now,
                updated_at=now,
            )
            category = Category(
                name=f"mysql-{uuid4().hex}",
                description=None,
                is_active=True,
                created_at=now,
                updated_at=now,
            )
            db.add_all([user, category])
            db.commit()
            self.user_id = user.id
            self.category_id = category.id
            customer = CustomerService(
                db,
                CustomerRepository(db),
                CustomerVerificationRepository(db),
            ).create_customer(
                CustomerCreate(
                    first_name="Concurrent",
                    last_name="Customer",
                    date_of_birth="1990-01-02",
                    email=f"{self.email_prefix}-customer@example.net",
                    phone="+14155552671",
                    postal_code="10001",
                ),
                user,
            )
            self.customer_id = customer.id
            self.customer_ids = [customer.id]

    def tearDown(self) -> None:
        if not hasattr(self, "factory"):
            return
        with self.factory() as db:
            ticket_ids = list(
                db.scalars(
                    select(Ticket.id).where(Ticket.customer_id == self.customer_id)
                )
            )
            if ticket_ids:
                db.execute(
                    delete(TicketEvent).where(TicketEvent.ticket_id.in_(ticket_ids))
                )
                db.execute(delete(Ticket).where(Ticket.id.in_(ticket_ids)))
            db.execute(
                delete(CustomerVerification).where(
                    CustomerVerification.customer_id == self.customer_id
                )
            )
            db.execute(delete(Customer).where(Customer.id.in_(self.customer_ids)))
            db.execute(delete(Category).where(Category.id == self.category_id))
            db.execute(delete(User).where(User.id == self.user_id))
            db.commit()
        self.engine.dispose()

    def test_deactivation_serializes_before_ticket_creation(self) -> None:
        locked = threading.Event()
        release = threading.Event()

        def deactivate() -> None:
            with self.factory() as db:
                actor = db.get(User, self.user_id)
                assert actor is not None
                actor.role = UserRole.ADMIN.value
                CustomerService(
                    db,
                    PausingCustomerRepository(db, locked, release),
                    CustomerVerificationRepository(db),
                ).update_activation(self.customer_id, False, actor)

        def create_ticket() -> str:
            with self.factory() as db:
                actor = db.get(User, self.user_id)
                assert actor is not None
                service = TicketService(
                    db,
                    TicketRepository(db),
                    CategoryRepository(db),
                    UserRepository(db),
                    TicketEventRecorder(TicketEventRepository(db)),
                    CustomerRepository(db),
                    CustomerVerificationRepository(db),
                )
                try:
                    service.create_ticket(
                        TicketCreate(
                            title="Racing ticket",
                            description="Must recheck active state",
                            category_id=self.category_id,
                            customer_id=self.customer_id,
                        ),
                        actor,
                    )
                    return "created"
                except InactiveCustomerError:
                    return "inactive"

        with ThreadPoolExecutor(max_workers=2) as executor:
            deactivation = executor.submit(deactivate)
            self.assertTrue(locked.wait(timeout=5))
            creation = executor.submit(create_ticket)
            time.sleep(0.2)
            self.assertFalse(creation.done())
            release.set()
            deactivation.result(timeout=10)
            self.assertEqual(creation.result(timeout=10), "inactive")

    def test_deactivation_serializes_before_verification_creation(self) -> None:
        with self.factory() as db:
            actor = db.get(User, self.user_id)
            assert actor is not None
            actor.role = UserRole.ADMIN.value
            db.commit()

        locked = threading.Event()
        release = threading.Event()

        def deactivate() -> None:
            with self.factory() as db:
                actor = db.get(User, self.user_id)
                assert actor is not None
                CustomerService(
                    db,
                    PausingCustomerRepository(db, locked, release),
                    CustomerVerificationRepository(db),
                ).update_activation(self.customer_id, False, actor)

        def verify() -> str:
            with self.factory() as db:
                actor = db.get(User, self.user_id)
                assert actor is not None
                try:
                    CustomerService(
                        db,
                        CustomerRepository(db),
                        CustomerVerificationRepository(db),
                    ).create_verification(
                        self.customer_id,
                        CustomerVerificationCreate(factors=["DATE_OF_BIRTH", "PHONE"]),
                        actor,
                    )
                    return "verified"
                except InactiveCustomerError:
                    return "inactive"

        with ThreadPoolExecutor(max_workers=2) as executor:
            deactivation = executor.submit(deactivate)
            self.assertTrue(locked.wait(timeout=5))
            verification = executor.submit(verify)
            time.sleep(0.2)
            self.assertFalse(verification.done())
            release.set()
            deactivation.result(timeout=10)
            self.assertEqual(verification.result(timeout=10), "inactive")

    def test_ticket_rechecks_expiry_after_customer_lock_wait(self) -> None:
        before_expiry = datetime(2026, 9, 17, 12, 29, 59)  # noqa: DTZ001
        expiry = before_expiry + timedelta(seconds=1)
        after_expiry = expiry + timedelta(microseconds=1)
        with self.factory() as db:
            verification = CustomerVerification(
                customer_id=self.customer_id,
                verified_by_user_id=self.user_id,
                factors=["DATE_OF_BIRTH", "PHONE"],
                verified_at=expiry - timedelta(minutes=30),
                expires_at=expiry,
            )
            db.add(verification)
            db.commit()
            verification_id = verification.id

        worker_connection_ids: queue.Queue[int] = queue.Queue(maxsize=1)
        expiry_reached = threading.Event()

        def create_ticket() -> str:
            with self.factory() as db:
                worker_connection_id = db.scalar(text("SELECT CONNECTION_ID()"))
                assert worker_connection_id is not None
                worker_connection_ids.put(worker_connection_id)
                actor = db.get(User, self.user_id)
                assert actor is not None
                service = TicketService(
                    db,
                    TicketRepository(db),
                    CategoryRepository(db),
                    UserRepository(db),
                    TicketEventRecorder(TicketEventRepository(db)),
                    CustomerRepository(db),
                    CustomerVerificationRepository(db),
                )

                def synchronized_now() -> datetime:
                    return after_expiry if expiry_reached.is_set() else before_expiry

                try:
                    with patch(
                        "app.services.ticket.utc_now_naive",
                        side_effect=synchronized_now,
                    ):
                        service.create_ticket(
                            TicketCreate(
                                title="Expiry lock race",
                                description="Must use the post-lock timestamp",
                                category_id=self.category_id,
                                customer_id=self.customer_id,
                                customer_verification_id=verification_id,
                            ),
                            actor,
                        )
                    return "created"
                except CustomerVerificationInvalidError:
                    return "expired"

        with self.factory() as lock_holder:
            controller_connection_id = lock_holder.scalar(
                text("SELECT CONNECTION_ID()")
            )
            assert controller_connection_id is not None
            locked_customer = lock_holder.scalar(
                select(Customer)
                .where(Customer.id == self.customer_id)
                .with_for_update()
            )
            assert locked_customer is not None
            with ThreadPoolExecutor(max_workers=1) as executor:
                creation = executor.submit(create_ticket)
                try:
                    worker_connection_id = worker_connection_ids.get(timeout=5)
                    observed_wait = self._wait_for_customer_lock_wait(
                        worker_connection_id=worker_connection_id,
                        controller_connection_id=controller_connection_id,
                        timeout=5,
                    )
                    self.assertIsNotNone(
                        observed_wait,
                        "MySQL did not report the ticket worker waiting for the "
                        "controller's Customer row lock within 5 seconds.",
                    )
                    assert observed_wait is not None
                    self.assertEqual(
                        observed_wait["waiting_connection_id"], worker_connection_id
                    )
                    self.assertEqual(observed_wait["object_name"], "customers")
                    self.assertEqual(observed_wait["index_name"], "PRIMARY")
                    self.assertEqual(observed_wait["lock_status"], "WAITING")
                    expiry_reached.set()
                    lock_holder.commit()
                    self.assertEqual(creation.result(timeout=10), "expired")
                finally:
                    if lock_holder.in_transaction():
                        lock_holder.rollback()

    def _wait_for_customer_lock_wait(
        self,
        *,
        worker_connection_id: int,
        controller_connection_id: int,
        timeout: float,
    ) -> dict[str, object] | None:
        deadline = time.monotonic() + timeout
        lock_wait_query = text(
            """
            SELECT
                requesting_thread.PROCESSLIST_ID AS waiting_connection_id,
                blocking_thread.PROCESSLIST_ID AS blocking_connection_id,
                requested.OBJECT_SCHEMA AS object_schema,
                requested.OBJECT_NAME AS object_name,
                requested.INDEX_NAME AS index_name,
                requested.LOCK_TYPE AS lock_type,
                requested.LOCK_MODE AS lock_mode,
                requested.LOCK_STATUS AS lock_status,
                requested.LOCK_DATA AS lock_data
            FROM performance_schema.data_lock_waits AS waits
            JOIN performance_schema.data_locks AS requested
              ON requested.ENGINE = waits.ENGINE
             AND requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
            JOIN performance_schema.data_locks AS blocking
              ON blocking.ENGINE = waits.ENGINE
             AND blocking.ENGINE_LOCK_ID = waits.BLOCKING_ENGINE_LOCK_ID
            JOIN performance_schema.threads AS requesting_thread
              ON requesting_thread.THREAD_ID = requested.THREAD_ID
            JOIN performance_schema.threads AS blocking_thread
              ON blocking_thread.THREAD_ID = blocking.THREAD_ID
            WHERE requesting_thread.PROCESSLIST_ID = :worker_connection_id
              AND blocking_thread.PROCESSLIST_ID = :controller_connection_id
              AND requested.OBJECT_SCHEMA = DATABASE()
              AND requested.OBJECT_NAME = 'customers'
              AND requested.INDEX_NAME = 'PRIMARY'
              AND requested.LOCK_TYPE = 'RECORD'
              AND requested.LOCK_STATUS = 'WAITING'
              AND blocking.LOCK_STATUS = 'GRANTED'
              AND requested.LOCK_DATA = CAST(:customer_id AS CHAR)
            LIMIT 1
            """
        )

        with self.factory() as observer:
            while time.monotonic() < deadline:
                try:
                    observed = (
                        observer.execute(
                            lock_wait_query,
                            {
                                "worker_connection_id": worker_connection_id,
                                "controller_connection_id": controller_connection_id,
                                "customer_id": self.customer_id,
                            },
                        )
                        .mappings()
                        .first()
                    )
                except (OperationalError, ProgrammingError) as exc:
                    observer.rollback()
                    if exc.orig.args[0] != 1142:
                        raise
                    return self._wait_for_customer_lock_wait_via_processlist(
                        observer,
                        worker_connection_id=worker_connection_id,
                        deadline=deadline,
                    )
                if observed is not None:
                    return dict(observed)
                time.sleep(0.02)
        return None

    def _wait_for_customer_lock_wait_via_processlist(
        self,
        observer: Session,
        *,
        worker_connection_id: int,
        deadline: float,
    ) -> dict[str, object] | None:
        # The application user in the default MySQL container cannot read
        # performance_schema.data_lock_waits. The global InnoDB wait gauge proves
        # that a row-lock wait exists, while PROCESSLIST ties the still-running
        # SELECT FOR UPDATE to this worker connection and exact Customer row.
        while time.monotonic() < deadline:
            current_waits = int(
                observer.execute(
                    text("SHOW GLOBAL STATUS LIKE 'Innodb_row_lock_current_waits'")
                ).one()[1]
            )
            processes = observer.execute(text("SHOW FULL PROCESSLIST")).mappings()
            worker = next(
                (
                    process
                    for process in processes
                    if process["Id"] == worker_connection_id
                    and process["Command"] == "Query"
                ),
                None,
            )
            worker_sql = str(worker["Info"] or "") if worker is not None else ""
            normalized_sql = " ".join(worker_sql.lower().split())
            targets_customer_lock = (
                "from customers" in normalized_sql
                and "for update" in normalized_sql
                and f"customers.id = {self.customer_id}" in normalized_sql
            )
            if current_waits > 0 and targets_customer_lock:
                return {
                    "waiting_connection_id": worker_connection_id,
                    "object_schema": make_url(settings.database_url).database,
                    "object_name": "customers",
                    "index_name": "PRIMARY",
                    "lock_type": "RECORD",
                    "lock_status": "WAITING",
                    "observation": "SHOW GLOBAL STATUS + SHOW FULL PROCESSLIST",
                }
            time.sleep(0.02)
        return None

    def test_named_customer_number_collision_is_retried_three_times(self) -> None:
        fixed_number = "CUS-0123456789ABCDEF"
        with self.factory() as db:
            existing = db.get(Customer, self.customer_id)
            assert existing is not None
            existing.customer_number = fixed_number
            db.commit()
            actor = db.get(User, self.user_id)
            assert actor is not None
            service = CustomerService(
                db,
                CustomerRepository(db),
                CustomerVerificationRepository(db),
            )
            with (
                patch(
                    "app.services.customer._generate_customer_number",
                    return_value=fixed_number,
                ),
                self.assertRaises(CustomerNumberAllocationError),
            ):
                service.create_customer(
                    CustomerCreate(
                        first_name="Collision",
                        last_name="Candidate",
                        email=f"{self.email_prefix}-collision@example.net",
                    ),
                    actor,
                )

    def test_name_search_is_accent_insensitive_but_email_is_exact_safe(self) -> None:
        with self.factory() as db:
            actor = db.get(User, self.user_id)
            assert actor is not None
            service = CustomerService(
                db,
                CustomerRepository(db),
                CustomerVerificationRepository(db),
            )
            accented = service.create_customer(
                CustomerCreate(
                    first_name="Jörg",
                    last_name="Müller",
                    email="résumé@example.net",
                ),
                actor,
            )
            self.customer_ids.append(accented.id)
            by_name = service.search_customers(
                CustomerSearchRequest(kind="NAME", value="Muller Jor"), actor
            )
            by_first_name = service.search_customers(
                CustomerSearchRequest(kind="NAME", value="Jor"), actor
            )
            by_last_name = service.search_customers(
                CustomerSearchRequest(kind="NAME", value="Muller"), actor
            )
            by_unaccented_email = service.search_customers(
                CustomerSearchRequest(kind="EMAIL", value="resume@example.net"),
                actor,
            )
            by_exact_email = service.search_customers(
                CustomerSearchRequest(kind="EMAIL", value="RÉSUMÉ@EXAMPLE.NET"),
                actor,
            )
            self.assertEqual([item.id for item in by_name.items], [accented.id])
            self.assertEqual([item.id for item in by_first_name.items], [accented.id])
            self.assertEqual([item.id for item in by_last_name.items], [accented.id])
            self.assertEqual(by_unaccented_email.total, 0)
            self.assertEqual([item.id for item in by_exact_email.items], [accented.id])

    def test_one_token_name_search_uses_both_prefix_indexes(self) -> None:
        now = datetime(2026, 9, 17, 12, 0, 0)  # noqa: DTZ001
        with self.factory() as db:
            rows = []
            for index in range(2_000):
                if index == 0:
                    first_name, last_name = "PlanTargetFirst", "Zulu"
                elif index == 1:
                    first_name, last_name = "Alpha", "PlanTargetLast"
                elif index == 2:
                    first_name = last_name = "PlanTargetBoth"
                else:
                    first_name = f"Noise{index:04d}"
                    last_name = f"Sample{index:04d}"
                rows.append(
                    Customer(
                        customer_number=f"CUS-P{index:015d}",
                        first_name=first_name,
                        last_name=last_name,
                        date_of_birth=None,
                        email=f"{self.email_prefix}-plan-{index}@example.net",
                        phone=None,
                        street=None,
                        house_number=None,
                        postal_code=None,
                        city=None,
                        country=None,
                        is_active=index % 2 == 0,
                        created_at=now,
                        updated_at=now,
                    )
                )
            db.add_all(rows)
            db.commit()
            self.customer_ids.extend(row.id for row in rows)
            db.connection().exec_driver_sql("ANALYZE TABLE customers")

            captured: list[tuple[str, object]] = []

            def capture(
                _connection: object,
                _cursor: object,
                statement: str,
                parameters: object,
                _context: object,
                _many: object,
            ) -> None:
                if "customer_name_matches" in statement:
                    captured.append((statement, parameters))

            event.listen(self.engine, "before_cursor_execute", capture)
            try:
                actor = db.get(User, self.user_id)
                assert actor is not None
                result = CustomerService(
                    db,
                    CustomerRepository(db),
                    CustomerVerificationRepository(db),
                ).search_customers(
                    CustomerSearchRequest(
                        kind="NAME",
                        value="PlanTarget",
                        is_active=None,
                    ),
                    actor,
                )
            finally:
                event.remove(self.engine, "before_cursor_execute", capture)

            self.assertEqual(result.total, 3)
            self.assertGreaterEqual(len(captured), 2)
            statement, parameters = captured[0]
            plan_json = (
                db.connection()
                .exec_driver_sql(f"EXPLAIN FORMAT=JSON {statement}", parameters)
                .scalar_one()
            )
            plan = json.loads(plan_json)

        table_accesses: list[dict[str, object]] = []

        def collect_table_accesses(node: object) -> None:
            if isinstance(node, dict):
                if node.get("table_name") == "customers":
                    table_accesses.append(node)
                for value in node.values():
                    collect_table_accesses(value)
            elif isinstance(node, list):
                for value in node:
                    collect_table_accesses(value)

        collect_table_accesses(plan)
        selected_indexes = {str(item.get("key")) for item in table_accesses}
        self.assertTrue(
            {
                "ix_customers_active_first_last_id",
                "ix_customers_active_last_first_id",
            }.issubset(selected_indexes),
            plan_json,
        )
        self.assertTrue(
            all(item.get("access_type") == "range" for item in table_accesses),
            plan_json,
        )


class MySqlCustomerMigrationTests(unittest.TestCase):
    def test_populated_head_upgrade_and_safe_downgrade(self) -> None:
        if not settings.database_url.startswith("mysql"):
            self.skipTest("The configured backend database is not MySQL.")
        configured_admin_url = os.environ.get("MIGRATION_TEST_ADMIN_DATABASE_URL")
        configured_root_password = os.environ.get("MIGRATION_TEST_MYSQL_ROOT_PASSWORD")
        application_url = make_url(settings.database_url)
        if configured_admin_url is not None:
            management_url = make_url(configured_admin_url).set(database=None)
        elif configured_root_password is not None:
            management_url = URL.create(
                drivername=application_url.drivername,
                username="root",
                password=configured_root_password,
                host=application_url.host,
                port=application_url.port,
            )
        else:
            management_url = application_url.set(database=None)
        management_engine = create_engine(management_url, pool_pre_ping=True)
        database_name = f"pulsedesk_customer_migration_{uuid4().hex}"
        database_created = False
        try:
            try:
                with management_engine.connect().execution_options(
                    isolation_level="AUTOCOMMIT"
                ) as connection:
                    connection.exec_driver_sql(f"CREATE DATABASE {database_name}")
                database_created = True
            except OperationalError:
                if (
                    configured_admin_url is not None
                    or configured_root_password is not None
                ):
                    raise
                self.skipTest(
                    "Configure MIGRATION_TEST_ADMIN_DATABASE_URL or "
                    "MIGRATION_TEST_MYSQL_ROOT_PASSWORD."
                )

            migration_url = management_url.set(database=database_name)
            original_database_url = settings.database_url
            settings.database_url = migration_url.render_as_string(hide_password=False)
            engine = None
            try:
                config = Config(
                    str(Path(__file__).resolve().parents[1] / "alembic.ini")
                )
                command.upgrade(config, "4a8e2f6c91bd")
                engine = create_engine(migration_url, pool_pre_ping=True)
                now = datetime(2026, 9, 17, 12, 0, 0)  # noqa: DTZ001
                with engine.begin() as connection:
                    connection.exec_driver_sql(
                        "INSERT INTO users (email, password_hash, first_name, last_name, "
                        "role, is_active, must_change_password, auth_version, created_at, "
                        "updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (
                            "existing@example.com",
                            "hash",
                            "Existing",
                            "User",
                            "EMPLOYEE",
                            True,
                            False,
                            0,
                            now,
                            now,
                        ),
                    )
                    connection.exec_driver_sql(
                        "INSERT INTO categories (name, description, is_active, created_at, updated_at) "
                        "VALUES (%s,%s,%s,%s,%s)",
                        ("Existing", None, True, now, now),
                    )
                    connection.exec_driver_sql(
                        "INSERT INTO tickets (ticket_number, title, description, status, priority, "
                        "category_id, created_by_id, assigned_to_id, created_at, updated_at, "
                        "resolved_at, closed_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (
                            "TKT-MIGRATION00001",
                            "Existing",
                            "Survives",
                            "OPEN",
                            "MEDIUM",
                            1,
                            1,
                            None,
                            now,
                            now,
                            None,
                            None,
                        ),
                    )

                command.upgrade(config, "b93f2d7a6c10")
                db_inspector = inspect(engine)
                self.assertIn("customers", db_inspector.get_table_names())
                self.assertIn("customer_verifications", db_inspector.get_table_names())
                ticket_columns = {
                    column["name"] for column in db_inspector.get_columns("tickets")
                }
                self.assertIn("customer_id", ticket_columns)
                self.assertIn("customer_verification_id", ticket_columns)
                with engine.connect() as connection:
                    row = (
                        connection.exec_driver_sql(
                            "SELECT title, customer_id, customer_verification_id FROM tickets "
                            "WHERE ticket_number=%s",
                            ("TKT-MIGRATION00001",),
                        )
                        .mappings()
                        .one()
                    )
                self.assertEqual(row["title"], "Existing")
                self.assertIsNone(row["customer_id"])
                self.assertIsNone(row["customer_verification_id"])
                customer_indexes = {
                    index["name"] for index in db_inspector.get_indexes("customers")
                }
                self.assertTrue(
                    {
                        "ix_customers_email",
                        "ix_customers_phone",
                        "ix_customers_active_last_first_id",
                    }.issubset(customer_indexes)
                )
                unique_constraints = {
                    constraint["name"]
                    for constraint in db_inspector.get_unique_constraints("customers")
                }
                self.assertIn("uq_customers_customer_number", unique_constraints)
                checks = {
                    constraint["name"]
                    for constraint in db_inspector.get_check_constraints("customers")
                }
                self.assertIn("ck_customers_contact_present", checks)
                customer_index_details = {
                    index["name"]: index
                    for index in db_inspector.get_indexes("customers")
                }
                self.assertFalse(customer_index_details["ix_customers_email"]["unique"])
                self.assertFalse(customer_index_details["ix_customers_phone"]["unique"])
                verification_fks = {
                    foreign_key["name"]
                    for foreign_key in db_inspector.get_foreign_keys(
                        "customer_verifications"
                    )
                }
                self.assertEqual(
                    verification_fks,
                    {
                        "fk_customer_verifications_customer_id_customers",
                        "fk_customer_verifications_verified_by_user_id_users",
                    },
                )
                ticket_fks = {
                    foreign_key["name"]
                    for foreign_key in db_inspector.get_foreign_keys("tickets")
                }
                self.assertTrue(
                    {
                        "fk_tickets_customer_id_customers",
                        "fk_tickets_customer_verification_id_customer_verifications",
                    }.issubset(ticket_fks)
                )

                command.downgrade(config, "4a8e2f6c91bd")
                db_inspector.clear_cache()
                self.assertNotIn("customers", db_inspector.get_table_names())
                with engine.connect() as connection:
                    count = connection.exec_driver_sql(
                        "SELECT COUNT(*) FROM tickets WHERE ticket_number=%s",
                        ("TKT-MIGRATION00001",),
                    ).scalar_one()
                self.assertEqual(count, 1)
            finally:
                settings.database_url = original_database_url
                if engine is not None:
                    engine.dispose()
        finally:
            if database_created:
                with management_engine.connect().execution_options(
                    isolation_level="AUTOCOMMIT"
                ) as connection:
                    connection.exec_driver_sql(f"DROP DATABASE {database_name}")
            management_engine.dispose()
            # Alembic's logging file configuration disables existing application
            # loggers by default; keep this isolated migration test side-effect free.
            logging.getLogger("app.exceptions.handlers").disabled = False


if __name__ == "__main__":
    unittest.main()
