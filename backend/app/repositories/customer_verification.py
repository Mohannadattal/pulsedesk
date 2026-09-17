from sqlalchemy.orm import Session

from app.models.customer_verification import CustomerVerification


class CustomerVerificationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, verification_id: int) -> CustomerVerification | None:
        return self.db.get(CustomerVerification, verification_id)

    def create(self, verification: CustomerVerification) -> CustomerVerification:
        self.db.add(verification)
        self.db.flush()
        self.db.refresh(verification)
        return verification
