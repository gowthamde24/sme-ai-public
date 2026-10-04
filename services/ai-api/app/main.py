import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.auth.deps import Runtime
from app.auth.jwt import TokenVerifier
from app.config import ConfigurationError, Settings, build_auth_config, get_settings
from app.crm import repository as crm_repo
from app.crm.repository import PostgrestCrmRepository
from app.crm.routes import router as crm_router
from app.errors import ApiError, install_error_handlers
from app.logging_safety import install_log_redaction
from app.tenancy import repository as repo
from app.tenancy.repository import PostgrestTenantRepository
from app.tenancy.routes import router as tenancy_router

SERVICE_NAME = "ai-api"
SERVICE_VERSION = "0.1.0"

logger = logging.getLogger("app.main")


class HealthResponse(BaseModel):
    """Mirrors packages/contracts/health.schema.json."""

    status: str
    service: str
    version: str
    environment: str


def build_runtime(settings: Settings) -> Runtime | None:
    """Wire the verifier and repository from settings.

    Outside development an invalid configuration raises ConfigurationError, so the process
    refuses to start. In development it logs and returns None, and every tenant endpoint then
    answers 503 (never "allow").
    """
    try:
        config = build_auth_config(settings)
    except ConfigurationError as exc:
        if not settings.is_development:
            raise
        logger.warning("auth disabled in development: %s", exc)
        return None
    return Runtime(
        verifier=TokenVerifier.from_config(config),
        repository=PostgrestTenantRepository(config.rest_url, config.anon_key),
        crm=PostgrestCrmRepository(config.rest_url, config.anon_key),
    )


_REPOSITORY_ERRORS: dict[type[Exception], ApiError] = {
    repo.TokenRejected: ApiError(
        401,
        "unauthorized",
        "Invalid or missing credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    ),
    repo.Forbidden: ApiError(403, "forbidden", "Your role does not allow this action."),
    repo.InvalidInput: ApiError(422, "validation_error", "Invalid input."),
    repo.SlugUnavailable: ApiError(409, "slug_unavailable", "That slug is not available."),
    # CRM. Deliberately generic: none of these bodies carries a field name, a value, or a hint
    # about whether an id exists in another tenant.
    crm_repo.NotFoundError: ApiError(404, "not_found", "Not found."),
    crm_repo.ConflictError: ApiError(
        409, "conflict", "The request conflicts with an existing record."
    ),
    crm_repo.InvalidReferenceError: ApiError(
        422, "invalid_reference", "A referenced record does not exist."
    ),
    crm_repo.InvalidValueError: ApiError(422, "invalid_value", "A value was not accepted."),
    crm_repo.InvalidTransitionError: ApiError(
        409, "invalid_transition", "That status change is not allowed."
    ),
}


def create_app(settings: Settings | None = None, *, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or get_settings()
    runtime = runtime if runtime is not None else build_runtime(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if runtime is not None:
            for repository in (runtime.repository, runtime.crm):
                if isinstance(repository, PostgrestTenantRepository | PostgrestCrmRepository):
                    repository.close()

    app = FastAPI(title="SME AI Revenue Engine API", version=SERVICE_VERSION, lifespan=lifespan)
    app.state.runtime = runtime
    install_log_redaction()
    install_error_handlers(app)

    @app.exception_handler(repo.RepositoryError)
    async def _repository_error(_: Request, exc: repo.RepositoryError) -> JSONResponse:
        mapped = _REPOSITORY_ERRORS.get(type(exc))
        if isinstance(exc, crm_repo.DuplicateValueError):
            mapped = ApiError(
                409, "duplicate_value", f"That {exc.field} is already used.", headers={}
            )
        if mapped is None:
            mapped = ApiError(502, "upstream_error", "The data layer failed.")
        return JSONResponse(
            {"error": {"code": mapped.code, "message": mapped.message}},
            status_code=mapped.status_code,
            headers=mapped.headers,
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH"],
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

    app.include_router(tenancy_router)
    app.include_router(crm_router)
    return app


app = create_app()
