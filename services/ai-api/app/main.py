from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import get_settings

SERVICE_NAME = "ai-api"
SERVICE_VERSION = "0.1.0"


class HealthResponse(BaseModel):
    """Mirrors packages/contracts/health.schema.json."""

    status: str
    service: str
    version: str
    environment: str


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="SME AI Revenue Engine API", version=SERVICE_VERSION)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET"],
        allow_headers=["*"],
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=SERVICE_NAME,
            version=SERVICE_VERSION,
            environment=settings.api_env,
        )

    return app


app = create_app()
