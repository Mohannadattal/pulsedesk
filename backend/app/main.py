from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.exceptions.handlers import register_exception_handlers
from app.schemas.error import ErrorResponse, ValidationErrorResponse


app = FastAPI(
    title="PulseDesk API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)

register_exception_handlers(app)

app.include_router(
    api_router,
    prefix="/api/v1",
    responses={
        422: {
            "model": ValidationErrorResponse,
            "description": "Request validation failed.",
        },
        500: {
            "model": ErrorResponse,
            "description": "An unexpected server error occurred.",
        },
        503: {
            "model": ErrorResponse,
            "description": "A temporary service failure occurred.",
        },
    },
)


@app.get("/health", tags=["Health"], operation_id="health_check")
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "pulsedesk-api",
    }
