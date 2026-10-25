import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.agent_runs import pause
from app.agent_runs import repository as runs_repo
from app.agent_runs.repository import PostgrestAgentRunsRepository
from app.agent_runs.routes import router as agent_runs_router
from app.agent_runs.wiring import build_agents_runtime
from app.assistant.routes import router as assistant_router
from app.assistant_settings.repository import PostgrestAssistantSettingsRepository
from app.assistant_settings.routes import router as assistant_settings_router
from app.assistant_settings.service import AssistantSettingsService
from app.auth.deps import Runtime
from app.auth.jwt import TokenVerifier
from app.billing import errors as billing_errors
from app.billing.provider import BillingProvider, build_provider
from app.billing.repository import PostgrestBillingRepository
from app.billing.routes import plans_router as billing_plans_router
from app.billing.routes import router as billing_router
from app.billing.service import BillingService
from app.businessprofile.repository import PostgrestBusinessProfileRepository
from app.businessprofile.routes import router as business_profile_router
from app.campaigns import errors as campaign_errors
from app.campaigns.repository import PostgrestCampaignsRepository
from app.campaigns.routes import router as campaigns_router
from app.catalogue import errors as catalogue_errors
from app.catalogue.repository import PostgrestCatalogueRepository
from app.catalogue.routes import router as catalogue_router
from app.catalogue.storage import HttpStorageClient
from app.config import ConfigurationError, Settings, build_auth_config, get_settings
from app.connectors.repository import PostgrestConnectorsRepository
from app.connectors.routes import router as connectors_router
from app.connectors.webhooks import router as webhooks_router
from app.connectors.wiring import build_connectors
from app.crm import repository as crm_repo
from app.crm.repository import PostgrestCrmRepository
from app.crm.routes import router as crm_router
from app.customfields.errors import CustomFieldLimitError, CustomValueInvalidError
from app.customfields.repository import PostgrestCustomFieldsRepository
from app.customfields.routes import router as custom_fields_router
from app.deliveries import errors as delivery_errors
from app.deliveries.repository import PostgrestDeliveriesRepository
from app.deliveries.routes import router as deliveries_router
from app.dues import errors as dues_errors
from app.dues.ledger_routes import router as ledger_router
from app.dues.repository import PostgrestDuesRepository
from app.dues.routes import router as dues_router
from app.education import errors as education_errors
from app.education.repository import PostgrestEducationRepository
from app.education.routes import router as education_router
from app.enquiries import repository as enquiries_repo
from app.enquiries.repository import PostgrestEnquiriesRepository
from app.enquiries.routes import router as enquiries_router
from app.erasure import repository as erasure_repo
from app.erasure.repository import PostgrestErasureRepository
from app.erasure.routes import router as erasure_router
from app.errors import ApiError, error_body, install_error_handlers, mfa_required, request_id_of
from app.evidence.repository import PostgrestEvidenceRepository
from app.evidence.routes import router as evidence_router
from app.followups import errors as followup_errors
from app.followups.messages import FOLLOWUP_REFUSALS
from app.followups.repository import PostgrestFollowupsRepository
from app.followups.routes import router as followups_router
from app.hardening.headers import SecurityHeadersMiddleware
from app.hardening.observe import Metrics, ObserveMiddleware, install_logging
from app.hardening.ops_routes import build_router as build_ops_router
from app.hardening.ratelimit import RateLimitMiddleware
from app.integrations import errors as integration_errors
from app.integrations.policy import PolicyVersions
from app.integrations.repository import PostgrestIntegrationsRepository
from app.integrations.routes_accounting import router as accounting_export_router
from app.integrations.routes_calendar import member_router as calendar_member_router
from app.integrations.routes_calendar import public_router as calendar_public_router
from app.integrations.routes_contacts import router as contacts_by_phone_router
from app.integrations.routes_import import router as spreadsheet_import_router
from app.integrations.routes_policy import router as policy_router
from app.leads.repository import PostgrestLeadsRepository
from app.leads.routes import router as leads_router
from app.leadtools.repository import PostgrestLeadSearchRepository
from app.leadtools.routes import router as leadtools_router
from app.logging_safety import install_log_redaction
from app.materials import errors as material_errors
from app.materials.repository import PostgrestMaterialsRepository
from app.materials.routes import public_router as materials_public_router
from app.materials.routes import router as materials_router
from app.notifications.routes import me_router as notifications_me_router
from app.notifications.routes import router as notifications_router
from app.notifications.wiring import build_notifications
from app.orders import errors as order_errors
from app.orders.repository import PostgrestOrdersRepository
from app.orders.routes import router as orders_router
from app.outbox import errors as outbox_errors
from app.outbox.adapter import ChannelAdapter, build_adapter
from app.outbox.repository import PostgrestOutboxRepository
from app.outbox.routes import router as outbox_router
from app.outcomes.repository import PostgrestOutcomesRepository
from app.outcomes.routes import customers_router as outcomes_customers_router
from app.outcomes.routes import router as outcomes_router
from app.packs.errors import ExampleAlreadyLoadedError, ModuleOffError
from app.packs.providers import providers_from_settings
from app.packs.registry import PackRegistry, default_directory
from app.packs.repository import PostgrestPacksRepository
from app.packs.routes import public_router as packs_public_router
from app.packs.routes import router as packs_router
from app.pricelists.repository import PostgrestPriceListRepository
from app.pricelists.routes import router as pricelists_router
from app.privacy import errors as privacy_errors
from app.privacy.policy_gate import PolicyGate
from app.privacy.repository import PostgrestPrivacyRepository
from app.privacy.routes import me_router as privacy_me_router
from app.privacy.routes import router as privacy_router
from app.quotes import errors as quote_errors
from app.quotes.repository import PostgrestQuotesRepository
from app.quotes.routes import router as quotes_router
from app.reports.repository import PostgrestReportsRepository
from app.reports.routes import router as reports_router
from app.scheduler.repository import PostgrestSchedulerRepository
from app.scheduler.routes import router as scheduler_router
from app.sites import errors as site_errors
from app.sites.repository import PostgrestSitesRepository
from app.sites.routes import router as sites_router
from app.suppression.repository import PostgrestSuppressionRepository
from app.suppression.routes import router as suppression_router
from app.suppression.wiring import build_key_ring
from app.team import errors as team_errors
from app.team.repository import PostgrestTeamRepository
from app.team.routes import public_router as team_public_router
from app.team.routes import router as team_router
from app.tenancy import repository as repo
from app.tenancy.repository import PostgrestTenantRepository
from app.tenancy.routes import router as tenancy_router
from app.today.repository import PostgrestTodayRepository
from app.today.routes import router as today_router
from app.visits import errors as visit_errors
from app.visits.repository import PostgrestVisitsRepository
from app.visits.routes import router as visits_router
from app.voice.factory import build_voice
from app.voice.routes import router as voice_router
from app.voice_notes.repository import PostgrestVoiceNotesRepository
from app.voice_notes.routes import router as voice_notes_router
from app.websearch.repository import PostgrestResearchUsageRepository
from app.websearch.routes import router as research_router
from app.websearch.wiring import build_research_web
from app.whatsapp.repository import WhatsAppStateError
from app.whatsapp.routes import public_router as whatsapp_public_router
from app.whatsapp.routes import router as whatsapp_router
from app.whatsapp.wiring import build_whatsapp
from app.workspace.repository import PostgrestWorkspaceRepository
from app.workspace.routes import router as workspace_router

SERVICE_NAME = "ai-api"
SERVICE_VERSION = "0.1.0"

logger = logging.getLogger("app.main")


class HealthResponse(BaseModel):
    """Mirrors packages/contracts/health.schema.json."""

    status: str
    service: str
    version: str
    environment: str


def _outbox_adapter(settings: Settings) -> ChannelAdapter:
    """The outbox's channel adapter: only the local fake exists; any other name stops us."""
    try:
        return build_adapter(settings.outbox_adapter, settings)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


def _billing_provider(settings: Settings) -> BillingProvider:
    """The billing provider: only the fake one exists; any other name stops us."""
    try:
        return build_provider(settings.billing_provider)
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


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
    policies = PolicyVersions(
        settings.terms_version,
        settings.privacy_version,
        settings.terms_effective_from,
        settings.privacy_effective_from,
    )
    key_ring = build_key_ring(settings)
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
        key_ring=key_ring,
        followups=PostgrestFollowupsRepository(config.rest_url, config.anon_key),
        today=PostgrestTodayRepository(config.rest_url, config.anon_key),
        outbox=PostgrestOutboxRepository(config.rest_url, config.anon_key),
        outbox_adapter=_outbox_adapter(settings),
        visits=PostgrestVisitsRepository(config.rest_url, config.anon_key),
        scheduler=PostgrestSchedulerRepository(config.rest_url, config.anon_key),
        catalogue=PostgrestCatalogueRepository(config.rest_url, config.anon_key),
        catalogue_storage=HttpStorageClient(f"{config.supabase_url}/storage/v1", config.anon_key),
        lead_search=PostgrestLeadSearchRepository(config.rest_url, config.anon_key),
        voice=build_voice(settings),
        integrations=PostgrestIntegrationsRepository(config.rest_url, config.anon_key),
        policies=policies,
        privacy=PostgrestPrivacyRepository(config.rest_url, config.anon_key),
        policy_gate=PolicyGate(policies, enforce=settings.policy_enforce),
        whatsapp=build_whatsapp(settings, config, key_ring),
        team=PostgrestTeamRepository(config.rest_url, config.anon_key),
        workspace=PostgrestWorkspaceRepository(config.rest_url, config.anon_key),
        notifications=build_notifications(settings, config),
        research_web=build_research_web(settings),
        research_usage=PostgrestResearchUsageRepository(config.rest_url, config.anon_key),
        connectors=build_connectors(
            settings, config.rest_url, f"{config.supabase_url}/auth/v1", config.anon_key
        ),
        business_profile=PostgrestBusinessProfileRepository(config.rest_url, config.anon_key),
        packs=PostgrestPacksRepository(config.rest_url, config.anon_key),
        pack_registry=PackRegistry(
            Path(settings.packs_dir) if settings.packs_dir else default_directory()
        ),
        custom_fields=PostgrestCustomFieldsRepository(config.rest_url, config.anon_key),
        auth_providers=providers_from_settings(settings),
        sites=PostgrestSitesRepository(config.rest_url, config.anon_key),
        dues=PostgrestDuesRepository(config.rest_url, config.anon_key),
        materials=PostgrestMaterialsRepository(config.rest_url, config.anon_key),
        deliveries=PostgrestDeliveriesRepository(config.rest_url, config.anon_key),
        campaigns=PostgrestCampaignsRepository(config.rest_url, config.anon_key),
        education=PostgrestEducationRepository(config.rest_url, config.anon_key),
        reports=PostgrestReportsRepository(config.rest_url, config.anon_key),
        voice_notes=PostgrestVoiceNotesRepository(config.rest_url, config.anon_key),
        billing=BillingService(
            PostgrestBillingRepository(config.rest_url, config.anon_key),
            _billing_provider(settings),
        ),
        outcomes=PostgrestOutcomesRepository(config.rest_url, config.anon_key),
        assistant_settings=AssistantSettingsService(
            PostgrestAssistantSettingsRepository(config.rest_url, config.anon_key)
        ),
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

# SM762 / SM766: the closed reasons of a material quote that cannot be made, said once in plain
# words (the code itself is returned as `reason`)
MATERIAL_MISSING_TEXT: dict[str, str] = {
    "pick": "Choose a catalogue item for every line of the requirement.",
    "measure": "A line needs an area, a length and a width, or a quantity that a person confirmed.",
    "product_type": "A line needs its product type confirmed.",
    "price": "An item has no price yet: the Owner sets it.",
    "gst_rate": "An item has no GST rate: enter it (it is never assumed).",
    "pieces_per_area": "An item sold by area needs its pieces per sq ft or sq m.",
    "unit": "The item's unit does not match what the customer asked for.",
    "hsn": "An item's HSN code is not a valid code.",
    "policy": "The owner has not set the quoting rules yet.",
    "duplicate_item": "The same item is on two lines.",
    "other": "Something the quote needs is missing.",
}
MATERIAL_NOT_COMPUTABLE_TEXT: dict[str, str] = {
    "DISTANCE_MISSING": "Freight by distance needs the site's distance: choose a site with one.",
    "DISTANCE_BEYOND_SLABS": "The site is further than the owner's freight slabs.",
    "LAYING_RATE_MISSING": "Laying is needed but the owner has not set a laying rate.",
    "TOTAL_TOO_LARGE": "The total is larger than a single order can hold.",
    "OUT_OF_RANGE": "A quantity or an amount is outside the allowed range.",
    "other": "A quote cannot be computed from these inputs.",
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
    repo.BusinessTypeUnavailable: ApiError(
        422,
        "business_type_unavailable",
        "That kind of business is not available yet. Choose one of the kinds on the sign-up page.",
    ),
    # Packs and custom fields (job CK). Fixed sentences: nothing from the data layer.
    ModuleOffError: ApiError(
        403, "module_off", "That is not part of this kind of business, so it is switched off."
    ),
    ExampleAlreadyLoadedError: ApiError(
        409, "example_data_loaded", "The example data is already loaded."
    ),
    CustomValueInvalidError: ApiError(
        422, "custom_value_invalid", "That value does not fit this field."
    ),
    CustomFieldLimitError: ApiError(
        409, "custom_field_limit", "This business has the most fields it can have for that."
    ),
    # Sites, dues, material quotes and deliveries (job CN). Fixed sentences: nothing from the
    # data layer.
    site_errors.SiteContactError: ApiError(
        422, "site_contact_invalid", "That site contact is not a contact of this business."
    ),
    dues_errors.InvoiceNumberUsedError: ApiError(
        409, "invoice_number_used", "That invoice number is already used."
    ),
    dues_errors.AlreadyVoidedError: ApiError(409, "already_voided", "That was already voided."),
    # Reminder campaigns (job CP). Fixed sentences: nothing from the data layer.
    # SM803 also gives a closed `reason`.
    campaign_errors.CampaignStateError: ApiError(
        409, "campaign_state", "The campaign is not in a state that allows this."
    ),
    campaign_errors.CampaignStaleError: ApiError(
        409,
        "samples_changed",
        "The campaign changed since you looked at the samples. "
        "Look at them again before approving.",
    ),
    campaign_errors.CampaignNotReadyError: ApiError(
        409, "campaign_not_ready", "The campaign is not ready to approve."
    ),
    # Education: programmes, students, admissions, fees (job CR). Fixed sentences only.
    education_errors.AdmissionNumberUsedError: ApiError(
        409, "admission_no_used", "That admission number is already used by another student."
    ),
    education_errors.AdmissionStageError: ApiError(
        409, "admission_stage", "The enquiry cannot move to that stage from where it is."
    ),
    education_errors.FeePlanInUseError: ApiError(
        409, "fee_plan_in_use", "A student has this fee plan, so it cannot change. Make a new plan."
    ),
    education_errors.FeePlanExistsError: ApiError(
        409, "fee_plan_exists", "The student already has a fee plan for that year."
    ),
    education_errors.StudentInactiveError: ApiError(
        409, "student_not_active", "The student left or was erased, so this cannot be done."
    ),
    material_errors.MaterialQuoteMismatchError: ApiError(
        409,
        "quote_mismatch",
        "This quote does not match the database's own recomputation. Nothing was changed: "
        "make a new draft.",
    ),
    material_errors.MaterialInputMissingError: ApiError(
        422, "quote_input_missing", "Something the quote needs is missing."
    ),
    material_errors.MaterialQuoteNotDraftError: ApiError(
        409, "quote_not_draft", "That quote is not a draft any more."
    ),
    material_errors.MaterialQuoteStaleError: ApiError(
        409,
        "quote_stale",
        "The inputs of this quote have changed (a price, an item, the rules, the requirement), "
        "or the quote expired: make a new draft.",
    ),
    material_errors.MaterialOwnerApprovalError: ApiError(
        403, "owner_approval_required", "This quote needs the Owner's approval."
    ),
    material_errors.MaterialNotComputableError: ApiError(
        422, "quote_not_computable", "A quote cannot be computed from these inputs."
    ),
    delivery_errors.TripStateError: ApiError(
        409,
        "trip_state",
        "That cannot be done in the state the trip is in now. Reload and look again.",
    ),
    delivery_errors.OrderNotDispatchedError: ApiError(
        409, "order_not_dispatched", "The truck cannot leave before the order is dispatched."
    ),
    delivery_errors.QuantityExceedsOrderError: ApiError(
        409,
        "quantity_exceeds_order",
        "That is more than the order holds, counting the other trips.",
    ),
    delivery_errors.OrderNotDeliverableError: ApiError(
        409,
        "order_not_deliverable",
        "This order cannot have trips: it must be an accepted materials order that is not closed.",
    ),
    delivery_errors.NoSiteContactError: ApiError(
        422, "no_site_contact", "This trip has no site contact to tell."
    ),
    delivery_errors.ProofIncompleteError: ApiError(
        422,
        "proof_incomplete",
        "A proof of delivery needs a photo and the name of the person who received the goods.",
    ),
    billing_errors.PlanUnknownError: ApiError(
        422, "plan_unknown", "That plan does not exist or cannot be chosen."
    ),
    billing_errors.TrialAlreadyStartedError: ApiError(
        409, "trial_already_started", "This workspace has already started its trial."
    ),
    billing_errors.NothingToCancelError: ApiError(
        409, "nothing_to_cancel", "There is no active plan to cancel."
    ),
    billing_errors.PaymentMethodDeclinedError: ApiError(
        402, "payment_method_declined", "The payment method was not accepted. Nothing was charged."
    ),
    billing_errors.WorkspaceReadOnlyError: ApiError(
        403,
        "workspace_read_only",
        "This workspace is read-only because its plan has ended. "
        "You can still sign in, view and export your data. Choose a plan to continue.",
    ),
    billing_errors.PlanLimitReachedError: ApiError(
        409,
        "plan_limit_reached",
        "This plan's allowance for this is used up for now. It starts again with the next period.",
    ),
    repo.WorkspaceLimitReached: ApiError(
        409,
        "workspace_limit_reached",
        "Your plan includes one workspace and you already have it. Ask us if you need another.",
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
    runs_repo.CostCapError: ApiError(429, pause.CODE, pause.MESSAGE),
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
    # Outbox (job AT, ADR 0066). Fixed messages: nothing from the data layer reaches a client.
    outbox_errors.OutboxStateError: ApiError(
        409, "outbox_state", "That cannot be done in the state it is in now. Reload and look again."
    ),
    outbox_errors.CustomerStoppedError: ApiError(
        409, "customer_stopped", "This customer asked us to stop. Nothing more is sent or called."
    ),
    # Integrations (job BI, ADR 0073). Fixed messages: nothing from the data layer reaches a client.
    integration_errors.ExportTooLargeError: ApiError(
        422, "export_too_large", "That window holds too much to export at once. Choose fewer days."
    ),
    integration_errors.ImportJobStateError: ApiError(
        409, "import_state", "That import is not in a state that allows this. Check the file again."
    ),
    integration_errors.ImportMismatchError: ApiError(
        409,
        "import_file_changed",
        "This is not the file (or the column choices) that was checked. Check it again.",
    ),
    # Privacy rights (job BN, ADR 0075). Fixed messages: no data-layer text reaches clients.
    privacy_errors.SoleOwnerError: ApiError(
        409,
        "sole_owner",
        "You are the only Owner of a workspace. Make someone else an Owner, "
        "or delete the workspace, first.",
    ),
    privacy_errors.CoolingOffError: ApiError(
        409, "cooling_off", "The waiting period has not ended yet. Try again after it."
    ),
    privacy_errors.PrivacyStateError: ApiError(
        409,
        "privacy_state",
        "That cannot be done in the state it is in now. Reload and look again.",
    ),
    privacy_errors.PrivacyRateError: ApiError(
        429, "privacy_rate_limited", "Too many requests today. Try again tomorrow."
    ),
    privacy_errors.ConfirmationError: ApiError(
        422, "confirmation_mismatch", "What you typed does not match. Check it and try again."
    ),
    # WhatsApp (job BR, ADR 0076). Fixed message: nothing from the data layer reaches a client.
    WhatsAppStateError: ApiError(
        409,
        "whatsapp_state",
        "That cannot be done in the state it is in now. A template under review is not edited.",
    ),
    # The team (job BY, ADR 0077). Fixed messages: no data-layer text reaches clients.
    team_errors.RoleNotAllowedError: ApiError(
        403,
        "role_not_allowed",
        "You cannot give or change that role. Owners are added by the operator.",
    ),
    team_errors.NoSuchMemberError: ApiError(404, "not_found", "Not found."),
    team_errors.KeepOwnerError: ApiError(
        409, "keep_owner", "The workspace must keep an Owner. Add another Owner first."
    ),
    team_errors.OwnRoleError: ApiError(
        409, "own_role", "You cannot change your own role. Ask another Owner or Admin."
    ),
    team_errors.TooManyPendingError: ApiError(
        409, "too_many_invitations", "Twenty invitations are waiting. Revoke one first."
    ),
    team_errors.AlreadyMemberError: ApiError(
        409, "already_member", "You are already a member of that workspace."
    ),
    team_errors.InvitationNotPendingError: ApiError(
        409, "invitation_not_pending", "That invitation was already used."
    ),
    # Store visits (job AS, ADR 0067). Fixed messages: nothing from the data layer reaches a client.
    visit_errors.VisitStateError: ApiError(
        409,
        "visit_state",
        "That cannot be done in the state the visit is in now. Reload and look again.",
    ),
    visit_errors.CustomerErasedError: ApiError(
        409, "customer_erased", "This customer's record was erased. No visit can be booked."
    ),
    visit_errors.ShopClosedError: ApiError(409, "shop_closed", "The shop is closed that day."),
    visit_errors.SlotInvalidError: ApiError(
        409, "slot_invalid", "That is not one of the day's visit times."
    ),
    visit_errors.SlotFullError: ApiError(
        409, "slot_full", "Every place in that time is taken. Choose another time."
    ),
    visit_errors.PastDateError: ApiError(409, "date_past", "That date has already passed."),
    visit_errors.NoQuoteError: ApiError(
        409,
        "no_approved_quote",
        "This customer has no approved quote without an order yet, so no order can be made.",
    ),
    # Catalogue (job AY, ADR 0069). Fixed messages: nothing from the data layer reaches a client.
    catalogue_errors.NeedsPhotoError: ApiError(
        409,
        "needs_photo",
        "An active item needs a photo. Add one, or make the item inactive first.",
    ),
    catalogue_errors.TooManyPhotosError: ApiError(
        409, "too_many_photos", "An item can have at most 8 photos."
    ),
    catalogue_errors.PhotoFilesMissingError: ApiError(
        409, "photo_files_missing", "The photo did not finish uploading. Try again."
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
                runtime.outbox,
                runtime.visits,
                runtime.scheduler,
                runtime.catalogue,
                runtime.catalogue_storage,
                runtime.lead_search,
                runtime.research_usage,
                runtime.connectors.repo if runtime.connectors is not None else None,
                runtime.business_profile,
                runtime.packs,
                runtime.custom_fields,
                runtime.sites,
                runtime.dues,
                runtime.materials,
                runtime.deliveries,
                runtime.campaigns,
                runtime.education,
                runtime.reports,
                runtime.voice_notes,
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
                    | PostgrestTodayRepository
                    | PostgrestOutboxRepository
                    | PostgrestVisitsRepository
                    | PostgrestSchedulerRepository
                    | PostgrestCatalogueRepository
                    | HttpStorageClient
                    | PostgrestLeadSearchRepository
                    | PostgrestIntegrationsRepository
                    | PostgrestResearchUsageRepository
                    | PostgrestConnectorsRepository
                    | PostgrestBusinessProfileRepository
                    | PostgrestPacksRepository
                    | PostgrestCustomFieldsRepository
                    | PostgrestSitesRepository
                    | PostgrestDuesRepository
                    | PostgrestMaterialsRepository
                    | PostgrestDeliveriesRepository
                    | PostgrestCampaignsRepository
                    | PostgrestEducationRepository
                    | PostgrestReportsRepository
                    | PostgrestVoiceNotesRepository,
                ):
                    repository.close()

    docs = settings.is_development or settings.expose_api_docs
    app = FastAPI(
        title="SME AI Revenue Engine API",
        version=SERVICE_VERSION,
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    metrics = Metrics()
    install_logging(settings.log_format)
    app.state.runtime = runtime
    install_log_redaction()
    install_error_handlers(app)

    @app.exception_handler(repo.RepositoryError)
    async def _repository_error(request: Request, exc: repo.RepositoryError) -> JSONResponse:
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
        if isinstance(
            exc,
            material_errors.MaterialInputMissingError | material_errors.MaterialNotComputableError,
        ):
            table = (
                MATERIAL_MISSING_TEXT
                if isinstance(exc, material_errors.MaterialInputMissingError)
                else MATERIAL_NOT_COMPUTABLE_TEXT
            )
            reason = exc.detail if exc.detail in table else "other"
            mapped = ApiError(422, mapped.code if mapped else "quote_input_missing", table[reason])
        if isinstance(exc, campaign_errors.CampaignNotReadyError):  # SM803: first thing in the way
            reason = exc.detail if exc.detail in campaign_errors.NOT_READY_TEXT else "other"
            mapped = ApiError(
                409,
                "campaign_not_ready",
                campaign_errors.NOT_READY_TEXT.get(reason, "The campaign is not ready to approve."),
            )
        if isinstance(exc, crm_repo.DuplicateValueError):
            mapped = ApiError(
                409, "duplicate_value", f"That {exc.field} is already used.", headers={}
            )
        if mapped is None:
            mapped = ApiError(502, "upstream_error", "The data layer failed.")
        extra = {**mapped.extra, **({"reason": reason} if reason is not None else {})}
        return JSONResponse(
            error_body(
                mapped.code,
                mapped.message,
                retry_after=mapped.retry_after,
                request_id=request_id_of(request.scope),
                extra=extra,
            ),
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

    # job CB (ADR 0082): innermost the rate limits, then the security headers and the size limit,
    # outermost the request id, the access line and the counters
    if settings.rate_limit_enabled:
        app.add_middleware(
            RateLimitMiddleware,
            trusted_hops=settings.trusted_proxy_hops,
            on_limited=metrics.limit_hit,
        )
    app.add_middleware(SecurityHeadersMiddleware, production=not settings.is_development)
    app.add_middleware(ObserveMiddleware, metrics=metrics, trusted_hops=settings.trusted_proxy_hops)
    app.include_router(
        build_ops_router(
            metrics, settings.metrics_token.get_secret_value() if settings.metrics_token else None
        )
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
    app.include_router(
        leadtools_router
    )  # before the generic /leads/{id} routes: /leads/search must not be read as an id
    app.include_router(leads_router)
    app.include_router(research_router)
    app.include_router(evidence_router)
    app.include_router(contacts_by_phone_router)  # before the generic /contacts/{id} routes
    app.include_router(crm_router)
    app.include_router(agent_runs_router)
    app.include_router(enquiries_router)
    app.include_router(quotes_router)
    app.include_router(orders_router)
    app.include_router(followups_router)
    app.include_router(outbox_router)
    app.include_router(visits_router)
    app.include_router(scheduler_router)
    app.include_router(catalogue_router)
    app.include_router(pricelists_router)
    app.include_router(today_router)
    app.include_router(assistant_router)
    app.include_router(voice_router)
    app.include_router(connectors_router)
    app.include_router(webhooks_router)
    app.include_router(business_profile_router)
    app.include_router(packs_public_router)
    app.include_router(packs_router)
    app.include_router(custom_fields_router)
    app.include_router(sites_router)
    app.include_router(dues_router)
    app.include_router(ledger_router)
    app.include_router(campaigns_router)
    app.include_router(education_router)
    app.include_router(reports_router)
    app.include_router(voice_notes_router)
    app.include_router(billing_plans_router)
    app.include_router(billing_router)
    app.include_router(outcomes_router)
    app.include_router(outcomes_customers_router)
    app.include_router(assistant_settings_router)
    app.include_router(materials_public_router)
    app.include_router(materials_router)
    app.include_router(deliveries_router)
    app.include_router(accounting_export_router)
    app.include_router(spreadsheet_import_router)
    app.include_router(calendar_member_router)
    app.include_router(calendar_public_router)
    app.include_router(policy_router)
    app.include_router(privacy_me_router)
    app.include_router(privacy_router)
    app.include_router(whatsapp_public_router)
    app.include_router(whatsapp_router)
    app.include_router(team_router)
    app.include_router(team_public_router)
    app.include_router(workspace_router)
    app.include_router(notifications_router)
    app.include_router(notifications_me_router)
    app.include_router(suppression_router)
    app.include_router(erasure_router)
    return app


app = create_app()
