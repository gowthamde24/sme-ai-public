import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agent_runs import repository as runs_repo
from app.agent_runs.repository import PostgrestAgentRunsRepository
from app.agent_runs.routes import router as agent_runs_router
from app.agent_runs.wiring import build_agents_runtime
from app.auth.deps import Runtime
from app.auth.jwt import TokenVerifier
from app.config import ConfigurationError, Settings, build_auth_config, get_settings
from app.crm import repository as crm_repo
from app.crm.repository import PostgrestCrmRepository
from app.crm.routes import router as crm_router
from app.erasure import repository as erasure_repo
from app.erasure.repository import PostgrestErasureRepository
from app.erasure.routes import router as erasure_router
from app.errors import ApiError, install_error_handlers, mfa_required
from app.evidence.repository import PostgrestEvidenceRepository
from app.evidence.routes import router as evidence_router
from app.leads.repository import PostgrestLeadsRepository
from app.leads.routes import router as leads_router
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
        evidence=PostgrestEvidenceRepository(config.rest_url, config.anon_key),
        leads=PostgrestLeadsRepository(config.rest_url, config.anon_key),
        agents=build_agents_runtime(settings, config),
        erasure=PostgrestErasureRepository(config.rest_url, config.anon_key),
    )


_REPOSITORY_ERRORS: dict[type[Exception], ApiError] = {
    repo.TokenRejected: ApiError(
        401,
        "unauthorized",
        "Invalid or missing credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    ),
    repo.Forbidden: ApiError(403, "forbidden", "Your role does not allow this action."),
    repo.MfaRequired: mfa_required(),
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
    crm_repo.ContactSuppressedError: ApiError(
        409, "contact_suppressed", "The contact is suppressed; lift the suppression first."
    ),
    crm_repo.RealDataGateError: ApiError(
        409,
        "real_data_gate_closed",
        "This workspace accepts synthetic data only for now: use an e-mail address on a reserved "
        "domain (such as example.test) and a phone number that starts with +00.",
    ),
    # Agent runs (T006). Fixed messages: no field name, no value, nothing from the data layer.
    runs_repo.AgentsDisabledError: ApiError(
        409, "agents_disabled", "Agents are not enabled for this workspace."
    ),
    runs_repo.RunLimitError: ApiError(
        429, "run_limit_reached", "Too many agent runs. Try again later."
    ),
    runs_repo.TokenExpiringError: ApiError(
        409, "token_expiring", "Your session is about to expire. Sign in again and retry."
    ),
    runs_repo.RunNotRunningError: ApiError(409, "run_not_running", "That run is not running."),
    # Erasure (T006b, ADR 0014). Fixed messages: nothing from the data layer reaches the client.
    erasure_repo.NotPendingError: ApiError(
        409, "erasure_not_pending", "That erasure request is not pending."
    ),
    erasure_repo.WindowNotElapsedError: ApiError(
        409,
        "erasure_window_open",
        "A workspace-wide erasure can only run 24 hours after it was requested.",
    ),
    erasure_repo.AlreadyExecutedError: ApiError(
        409, "erasure_already_executed", "That erasure has already been carried out."
    ),
    erasure_repo.RequestCancelledError: ApiError(
        409, "erasure_cancelled", "That erasure request was cancelled."
    ),
    erasure_repo.OwnerTransferFirstError: ApiError(
        409,
        "erasure_owner_transfer_first",
        "This contact is the workspace's only owner. Transfer ownership to someone else first; "
        "an exception needs the operator.",
    ),
}


def create_app(settings: Settings | None = None, *, runtime: Runtime | None = None) -> FastAPI:
    settings = settings or get_settings()
    runtime = runtime if runtime is not None else build_runtime(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if runtime is not None:
            if runtime.agents is not None and runtime.agents.executor is not None:
                runtime.agents.executor.shutdown()
            for repository in (
                runtime.repository,
                runtime.crm,
                runtime.evidence,
                runtime.leads,
                runtime.agents.repository if runtime.agents is not None else None,
                runtime.erasure,
            ):
                if isinstance(
                    repository,
                    PostgrestTenantRepository
                    | PostgrestCrmRepository
                    | PostgrestEvidenceRepository
                    | PostgrestLeadsRepository
                    | PostgrestAgentRunsRepository
                    | PostgrestErasureRepository,
                ):
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

    cors_origins = settings.cors_origins  # validated: explicit origins only
    if cors_origins:  # none configured = no CORS headers at all
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_methods=["GET", "POST", "PATCH", "PUT"],
            allow_headers=["Authorization", "Content-Type"],
            allow_credentials=False,
            max_age=600,
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
    app.include_router(leads_router)
    app.include_router(evidence_router)
    app.include_router(crm_router)
    app.include_router(agent_runs_router)
    app.include_router(erasure_router)
    return app


app = create_app()
