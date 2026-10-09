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
from app.assistant.routes import router as assistant_router
from app.auth.deps import Runtime
from app.auth.jwt import TokenVerifier
from app.config import ConfigurationError, Settings, build_auth_config, get_settings
from app.crm import repository as crm_repo
from app.crm.repository import PostgrestCrmRepository
from app.crm.routes import router as crm_router
from app.enquiries import repository as enquiries_repo
from app.enquiries.repository import PostgrestEnquiriesRepository
from app.enquiries.routes import router as enquiries_router
from app.erasure import repository as erasure_repo
from app.erasure.repository import PostgrestErasureRepository
from app.erasure.routes import router as erasure_router
from app.errors import ApiError, install_error_handlers, mfa_required
from app.evidence.repository import PostgrestEvidenceRepository
from app.evidence.routes import router as evidence_router
from app.followups import errors as followup_errors
from app.followups.messages import FOLLOWUP_REFUSALS
from app.followups.repository import PostgrestFollowupsRepository
from app.followups.routes import router as followups_router
from app.leads.repository import PostgrestLeadsRepository
from app.leads.routes import router as leads_router
from app.logging_safety import install_log_redaction
from app.orders import errors as order_errors
from app.orders.repository import PostgrestOrdersRepository
from app.orders.routes import router as orders_router
from app.pricelists.repository import PostgrestPriceListRepository
from app.pricelists.routes import router as pricelists_router
from app.quotes import errors as quote_errors
from app.quotes.repository import PostgrestQuotesRepository
from app.quotes.routes import router as quotes_router
from app.suppression.repository import PostgrestSuppressionRepository
from app.suppression.routes import router as suppression_router
from app.suppression.wiring import build_key_ring
from app.tenancy import repository as repo
from app.tenancy.repository import PostgrestTenantRepository
from app.tenancy.routes import router as tenancy_router
from app.today.repository import PostgrestTodayRepository
from app.today.routes import router as today_router

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
        enquiries=PostgrestEnquiriesRepository(config.rest_url, config.anon_key),
        quotes=PostgrestQuotesRepository(config.rest_url, config.anon_key),
        orders=PostgrestOrdersRepository(config.rest_url, config.anon_key),
        pricelists=PostgrestPriceListRepository(config.rest_url, config.anon_key),
        suppression=PostgrestSuppressionRepository(config.rest_url, config.anon_key),
        key_ring=build_key_ring(settings),
        followups=PostgrestFollowupsRepository(config.rest_url, config.anon_key),
        today=PostgrestTodayRepository(config.rest_url, config.anon_key),
    )


# SM232: the lifecycle's closed refusal codes, said once in plain words
# (the code itself is returned as `reason`)
ORDER_REASON_TEXT: dict[str, str] = {
    "ILLEGAL_TRANSITION": "That cannot happen at this stage of the order.",
    "QUOTE_NOT_EXPIRED": "The quote has not expired yet.",
    "QUOTE_EXPIRED": "The quote has expired.",
    "CANCEL_WINDOW_CLOSED": "It is too late to cancel this order.",
    "ADVANCE_NOT_PAID": "The advance has not been paid.",
    "DUPLICATE_PAYMENT_ID": "That payment was already recorded.",
    "DUPLICATE_REFUND_ID": "That refund was already recorded.",
    "OVERPAYMENT": "That payment would pay more than the order's total.",
    "REFUND_EXCEEDS_PAID": "That refund is more than has been paid.",
    "CLOSED_UNPAID": "A closed order must be fully paid.",
    "INVALID_ADVANCE": "The order's advance does not fit its policy.",
    "INVALID_CANCEL_WINDOW": "The order's cancel window is not valid.",
    "INVALID_STATE": "The order is in a state the rules do not know.",
    "INVALID_EVENT": "The rules do not know that event.",
    "OUT_OF_RANGE": "A value is outside the allowed range.",
    "OTHER": "The order rules refuse this event.",
}

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
    repo.TermsNotAccepted: ApiError(
        403, "terms_required", "Accept the terms when you sign up to continue."
    ),
    repo.EmailNotConfirmed: ApiError(
        403, "email_not_confirmed", "Confirm your email address first: use the link we sent you."
    ),
    repo.WorkspaceLimitReached: ApiError(
        409,
        "workspace_limit_reached",
        "Your plan includes one workspace and you already have it. "
        "Ask us if you need another.",
    ),
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
    runs_repo.CostCapError: ApiError(
        429,
        "cost_cap_reached",
        "This workspace's agents have used today's spending limit. "
        "Try again tomorrow (India time).",
    ),
    runs_repo.TokenExpiringError: ApiError(
        409, "token_expiring", "Your session is about to expire. Sign in again and retry."
    ),
    runs_repo.RunNotRunningError: ApiError(409, "run_not_running", "That run is not running."),
    enquiries_repo.RequirementConfirmedError: ApiError(
        409,
        "requirement_confirmed",
        "This enquiry already has a confirmed requirement. Discard it first.",
    ),
    enquiries_repo.RequirementNotDraftError: ApiError(
        409, "requirement_not_draft", "That requirement is no longer a draft."
    ),
    enquiries_repo.NotConfirmableError: ApiError(
        409,
        "not_confirmable",
        "A line needs a saree type and a quantity that a person confirmed or corrected.",
    ),
    # Quotes (T009). Fixed messages: nothing from the data layer reaches a client.
    enquiries_repo.QuoteDependsError: ApiError(
        409,
        "quote_depends",
        "A quote depends on this requirement. Reject the draft or withdraw the approved "
        "quote first.",
    ),
    quote_errors.RequirementNotConfirmedError: ApiError(
        409, "requirement_not_confirmed", "Confirm the requirement before quoting it."
    ),
    quote_errors.QuoteNotDraftError: ApiError(
        409, "quote_not_draft", "That quote is not a draft any more."
    ),
    quote_errors.QuoteStaleError: ApiError(
        409,
        "quote_stale",
        "The inputs of this quote have changed (a newer price list or policy, the picks, "
        "the requirement, or the quote expired): make a new draft.",
    ),
    quote_errors.QuoteMismatchError: ApiError(
        409,
        "quote_mismatch",
        "This quote does not match the database's own recomputation. "
        "Nothing was changed: make a new draft.",
    ),
    quote_errors.QuoteInputMissingError: ApiError(
        422,
        "quote_input_missing",
        "Something the quote needs is missing: a product for every confirmed line, a price "
        "list, a policy, or a required input such as the delivery state.",
    ),
    quote_errors.OwnerApprovalRequiredError: ApiError(
        403, "owner_approval_required", "This quote needs the Owner's approval."
    ),
    quote_errors.EnquiryHasRequirementError: ApiError(
        409,
        "enquiry_has_requirement",
        "This enquiry already has a requirement from the line-by-line flow. Discard it "
        "before making a quote with typed prices.",
    ),
    quote_errors.PriceNotTypedByPersonError: ApiError(
        403, "price_not_typed_by_person", "Only a person can type a price."
    ),
    # Orders (ADR 0021). Fixed messages: nothing from the data layer reaches a client.
    order_errors.OrderQuoteNotApprovedError: ApiError(
        409, "quote_not_approved", "Only an approved quote can become an order."
    ),
    order_errors.OrderExistsError: ApiError(
        409, "order_exists", "This quote already has an order."
    ),
    order_errors.OrderFiguresError: ApiError(
        409,
        "order_figures_invalid",
        "This quote cannot become an order under the current order policy "
        "(a zero total, a missing advance the policy requires, or a total above the limit).",
    ),
    order_errors.OwnerRequiredError: ApiError(
        403, "owner_required", "This action needs the owner."
    ),
    order_errors.OrderClosedError: ApiError(409, "order_closed", "This order is closed."),
    order_errors.QuoteExpiredError: ApiError(409, "quote_expired", "The quote has expired."),
    order_errors.QuoteHasOrderError: ApiError(
        409, "quote_has_order", "This quote has a live order: lose or cancel the order first."
    ),
    order_errors.OrderMismatchError: ApiError(
        409,
        "order_changed",
        "The order changed while you were working on it. Reload it and try again.",
    ),
    order_errors.NoOrderPolicyError: ApiError(
        409, "no_order_policy", "No order policy is in force: the owner must publish one."
    ),
    runs_repo.RequirementConfirmedError: ApiError(
        409,
        "requirement_confirmed",
        "This enquiry already has a confirmed requirement. Discard it first.",
    ),
    runs_repo.DraftHasWorkError: ApiError(
        409, "discard_draft_to_rerun", "Discard the current draft to re-run."
    ),
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
    erasure_repo.KeyMissingError: ApiError(
        409,
        "erasure_key_missing",
        "This contact holds an e-mail or a phone number with no suppression key, so a later "
        "import of it could not be recognised. The keys are recorded automatically when the "
        "suppression key is configured; otherwise the owner may allow this erasure without a key.",
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
                runtime.enquiries,
                runtime.quotes,
                runtime.orders,
                runtime.pricelists,
                runtime.suppression,
                runtime.followups,
                runtime.today,
            ):
                if isinstance(
                    repository,
                    PostgrestTenantRepository
                    | PostgrestCrmRepository
                    | PostgrestEvidenceRepository
                    | PostgrestLeadsRepository
                    | PostgrestAgentRunsRepository
                    | PostgrestErasureRepository
                    | PostgrestEnquiriesRepository
                    | PostgrestQuotesRepository
                    | PostgrestOrdersRepository
                    | PostgrestPriceListRepository
                    | PostgrestSuppressionRepository
                    | PostgrestFollowupsRepository
                    | PostgrestTodayRepository,
                ):
                    repository.close()

    app = FastAPI(title="SME AI Revenue Engine API", version=SERVICE_VERSION, lifespan=lifespan)
    app.state.runtime = runtime
    install_log_redaction()
    install_error_handlers(app)

    @app.exception_handler(repo.RepositoryError)
    async def _repository_error(_: Request, exc: repo.RepositoryError) -> JSONResponse:
        mapped = _REPOSITORY_ERRORS.get(type(exc))
        reason: str | None = None
        if isinstance(
            exc, order_errors.OrderRefusedError
        ):  # SM232: one closed reason, a fixed sentence
            reason = exc.reason
            mapped = ApiError(
                409,
                "order_event_refused",
                ORDER_REASON_TEXT.get(reason, ORDER_REASON_TEXT["OTHER"]),
            )
        if isinstance(
            exc, followup_errors.FollowupRefusal
        ):  # SM220-SM229: a closed reason, a fixed sentence
            status, code, texts = FOLLOWUP_REFUSALS[exc.sqlstate]
            reason = exc.reason
            mapped = ApiError(status, code, texts[reason if reason is not None else "-"])
        if isinstance(exc, crm_repo.DuplicateValueError):
            mapped = ApiError(
                409, "duplicate_value", f"That {exc.field} is already used.", headers={}
            )
        if mapped is None:
            mapped = ApiError(502, "upstream_error", "The data layer failed.")
        body: dict[str, str] = {"code": mapped.code, "message": mapped.message}
        if reason is not None:
            body["reason"] = reason
        return JSONResponse(
            {"error": body},
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
    app.include_router(enquiries_router)
    app.include_router(quotes_router)
    app.include_router(orders_router)
    app.include_router(followups_router)
    app.include_router(pricelists_router)
    app.include_router(today_router)
    app.include_router(assistant_router)
    app.include_router(suppression_router)
    app.include_router(erasure_router)
    return app


app = create_app()
