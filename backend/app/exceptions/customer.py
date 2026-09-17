class CustomerNotFoundError(Exception):
    pass


class InactiveCustomerError(Exception):
    pass


class CustomerContactRequiredError(Exception):
    pass


class CustomerPotentialDuplicateError(Exception):
    pass


class CustomerNumberAllocationError(Exception):
    def __init__(self, attempt_count: int) -> None:
        self.attempt_count = attempt_count
        super().__init__("Customer-number allocation was exhausted.")


class CustomerVerificationNotFoundError(Exception):
    pass


class CustomerVerificationInvalidError(Exception):
    pass


class CustomerVerificationFactorUnavailableError(Exception):
    pass
