from fastapi import FastAPI


app = FastAPI(
    title="PulseDesk API",
    version="0.1.0",
)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {
        "status": "healthy",
        "service": "pulsedesk-api",
    }