from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


engine = create_engine(
    settings.database_url,
    connect_args={
        "connect_timeout": settings.database_connect_timeout_seconds,
        "read_timeout": settings.database_read_timeout_seconds,
        "write_timeout": settings.database_write_timeout_seconds,
    },
    hide_parameters=True,
    pool_pre_ping=True,
    pool_timeout=settings.database_pool_timeout_seconds,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)
