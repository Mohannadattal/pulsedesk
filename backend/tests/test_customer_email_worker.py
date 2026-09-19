import threading
import unittest

from pydantic import ValidationError

from app.core.config import Settings
from app.services.customer_email_delivery import CustomerEmailBatchResult
from app.services.customer_email_worker import CustomerEmailWorker


class RecordingStopEvent:
    def __init__(self, *, stop_after_waits: int | None = None) -> None:
        self.stopped = False
        self.stop_after_waits = stop_after_waits
        self.waits: list[float] = []

    def is_set(self) -> bool:
        return self.stopped

    def set(self) -> None:
        self.stopped = True

    def wait(self, timeout: float) -> bool:
        self.waits.append(timeout)
        if (
            self.stop_after_waits is not None
            and len(self.waits) >= self.stop_after_waits
        ):
            self.stopped = True
        return self.stopped


class CustomerEmailWorkerLoopTests(unittest.TestCase):
    def test_idle_worker_waits_for_poll_interval(self) -> None:
        stop_event = RecordingStopEvent(stop_after_waits=1)
        calls = 0

        def process_batch() -> CustomerEmailBatchResult:
            nonlocal calls
            calls += 1
            return CustomerEmailBatchResult()

        CustomerEmailWorker(
            process_batch=process_batch,
            polling_interval_seconds=5,
            stop_event=stop_event,  # type: ignore[arg-type]
        ).run(delivery_enabled=True)

        self.assertEqual(calls, 1)
        self.assertEqual(stop_event.waits, [5])

    def test_worker_continues_after_recoverable_loop_failure(self) -> None:
        stop_event = RecordingStopEvent()
        calls = 0

        def process_batch() -> CustomerEmailBatchResult:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("recoverable")
            stop_event.set()
            return CustomerEmailBatchResult(claimed=1, sent=1)

        CustomerEmailWorker(
            process_batch=process_batch,
            polling_interval_seconds=3,
            stop_event=stop_event,  # type: ignore[arg-type]
        ).run(delivery_enabled=True)

        self.assertEqual(calls, 2)
        self.assertEqual(stop_event.waits, [3])

    def test_shutdown_request_prevents_another_batch(self) -> None:
        stop_event = threading.Event()
        calls = 0

        def process_batch() -> CustomerEmailBatchResult:
            nonlocal calls
            calls += 1
            stop_event.set()
            return CustomerEmailBatchResult(claimed=1, sent=1)

        CustomerEmailWorker(
            process_batch=process_batch,
            polling_interval_seconds=5,
            stop_event=stop_event,
        ).run(delivery_enabled=True)

        self.assertEqual(calls, 1)

    def test_polling_interval_configuration_rejects_invalid_values(self) -> None:
        required = {
            "database_url": "mysql+pymysql://user:password@localhost/test",
            "jwt_secret": "x" * 32,
        }
        for invalid in (0, -1, 301):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                Settings(
                    **required,
                    email_delivery_poll_interval_seconds=invalid,
                    _env_file=None,
                )

        configured = Settings(
            **required,
            email_delivery_poll_interval_seconds=0.25,
            _env_file=None,
        )
        self.assertEqual(configured.email_delivery_poll_interval_seconds, 0.25)


if __name__ == "__main__":
    unittest.main()
