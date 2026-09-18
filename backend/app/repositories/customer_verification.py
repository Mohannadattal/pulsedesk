from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.customer_verification import CustomerVerification


class CustomerVerificationRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_id(self, verification_id: int) -> CustomerVerification | None:
        return self.db.get(CustomerVerification, verification_id)

    def get_by_id_for_update(self, verification_id: int) -> CustomerVerification | None:
        statement = (
            select(CustomerVerification)
            .where(CustomerVerification.id == verification_id)
            .with_for_update()
        )
        return self.db.scalar(statement)

    def get_current(
        self,
        *,
        customer_id: int,
        verified_by_user_id: int,
        now: datetime,
    ) -> CustomerVerification | None:
        statement = (
            select(CustomerVerification)
            .where(
                CustomerVerification.customer_id == customer_id,
                CustomerVerification.verified_by_user_id == verified_by_user_id,
                CustomerVerification.expires_at > now,
            )
            .order_by(
                CustomerVerification.verified_at.desc(),
                CustomerVerification.id.desc(),
            )
            .limit(1)
        )
        return self.db.scalar(statement)

    def create(self, verification: CustomerVerification) -> CustomerVerification:
        self.db.add(verification)
        self.db.flush()
        self.db.refresh(verification)
        return verification
