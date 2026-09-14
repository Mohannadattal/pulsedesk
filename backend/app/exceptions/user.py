class UserAlreadyExistsError(Exception):
    def __init__(self, email: str) -> None:
        self.email = email
        super().__init__(f"A user with email '{email}' already exists.")


class UserNotFoundError(Exception):
    def __init__(self, user_id: int) -> None:
        self.user_id = user_id
        super().__init__(f"User with ID '{user_id}' was not found.")


class InitialAdminAlreadyExistsError(Exception):
    """Raised when bootstrap is attempted after an admin already exists."""
