from fastapi import FastAPI

from app.api.v1.router import api_router
from app.exceptions.handlers import register_exception_handlers


app = FastAPI(
    title="PulseDesk API",
    version="0.1.0",
)

register_exception_handlers(app)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "pulsedesk-api",
    }
