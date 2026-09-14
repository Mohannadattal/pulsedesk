from app.models.ticket import TicketStatus


class TicketNotFoundError(Exception):
    def __init__(self, ticket_id: int) -> None:
        super().__init__(f"Ticket with ID '{ticket_id}' was not found.")


class InvalidTicketStatusTransitionError(Exception):
    def __init__(self, current: str, requested: TicketStatus) -> None:
        super().__init__(
            f"Ticket status cannot transition from '{current}' to '{requested.value}'."
        )


class InvalidTicketAssigneeError(Exception):
    def __init__(self, user_id: int) -> None:
        super().__init__(
            f"User with ID '{user_id}' is not an active ticket assignee."
        )


class InvalidTicketFilterError(Exception):
    """Raised when ticket list filters contradict one another."""


class TicketNumberAllocationError(Exception):
    def __init__(self, attempt_count: int) -> None:
        self.attempt_count = attempt_count
        super().__init__("Ticket-number allocation was exhausted.")
