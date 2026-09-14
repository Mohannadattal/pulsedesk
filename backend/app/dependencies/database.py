import logging
from collections.abc import Generator

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.database.session import SessionLocal


logger = logging.getLogger(__name__)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()

    try:
        yield db
    except Exception:
        try:
            db.rollback()
        except SQLAlchemyError as error:
            logger.error(
                "Database session safety rollback failed (exception=%s)",
                type(error).__name__,
            )
        raise
    finally:
        db.close()
