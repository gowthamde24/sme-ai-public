"""FastAPI dependencies: who is calling (Principal) and may they act on this tenant."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from app.agent_runs.wiring import AgentsRuntime
from app.assistant_settings.service import AssistantSettingsService
from app.auth.jwt import AuthError, Principal, TokenVerifier
from app.billing import gate
from app.billing.mail import EmailSender
from app.billing.service import BillingService
from app.businessprofile.repository import BusinessProfileRepository
from app.callsettings.service import CallSettingsService
from app.campaigns.repository import CampaignsRepository
from app.catalogue.repository import CatalogueRepository
from app.catalogue.storage import StorageClient
from app.connectors.runtime import Connectors
from app.crm.repository import CrmRepository
from app.customfields.repository import CustomFieldsRepository
from app.deliveries.repository import DeliveriesRepository
from app.dpdp.runtime import DpdpRuntime
from app.dues.repository import DuesRepository
from app.education.repository import EducationRepository
from app.enquiries.repository import EnquiriesRepository
from app.erasure.repository import ErasureRepository
from app.errors import ApiError, forbidden, mfa_required, not_found, unauthorized
from app.evidence.repository import EvidenceRepository
from app.followups.repository import FollowupsRepository
from app.integrations.policy import PolicyVersions
from app.integrations.repository import IntegrationsRepository
from app.knowledge.service import KnowledgeService
from app.lead_sources.service import LeadSourcesService
from app.leads.repository import LeadsRepository
from app.leadspack.service import LeadPlaybookService
from app.leadtools.repository import LeadSearchRepository
from app.marksmessages.service import MarksSendService
from app.materials.repository import MaterialsRepository
from app.notifications.runtime import NotificationsRuntime
from app.orders.repository import OrdersRepository
from app.outbox.adapter import ChannelAdapter
from app.outbox.repository import OutboxRepository
from app.outcomes.repository import OutcomesRepository
from app.outreach.service import OutreachService
from app.ownvoice.service import OwnVoiceService
from app.packs.models import AuthProvidersOut
from app.packs.registry import PackRegistry
from app.packs.repository import PacksRepository
from app.pricelists.repository import PriceListRepository
from app.privacy.policy_gate import PolicyGate
from app.privacy.repository import PrivacyRepository
from app.quotes.repository import QuotesRepository
from app.reports.repository import ReportsRepository
from app.scheduler.repository import SchedulerRepository
from app.sites.repository import SitesRepository
from app.speaking.service import SpeakingService
from app.suppression.keys import KeyRing
from app.suppression.repository import SuppressionRepository
from app.tasks.service import TasksService
from app.team.repository import TeamRepository
from app.tenancy.models import Role, TenantOut
from app.tenancy.repository import TenantRepository
from app.today.repository import TodayRepository
from app.visits.repository import VisitsRepository
from app.voice.interface import VoiceStack
from app.voice_notes.repository import VoiceNotesRepository
from app.voicesample.service import VoiceSampleService
from app.websearch.repository import ResearchUsageRepository
from app.websearch.service import ResearchWeb
from app.whatsapp.runtime import WhatsAppRuntime
from app.workspace.repository import WorkspaceRepository

logger = logging.getLogger("app.auth")


@dataclass(frozen=True)
class Runtime:
    """Wired-up collaborators. Absent when auth is not configured (development only)."""

    verifier: TokenVerifier
    repository: TenantRepository
    crm: CrmRepository
    evidence: EvidenceRepository
    leads: LeadsRepository
    agents: AgentsRuntime | None = None
    erasure: ErasureRepository | None = None
    enquiries: EnquiriesRepository | None = None
    quotes: QuotesRepository | None = None
    orders: OrdersRepository | None = None
    pricelists: PriceListRepository | None = None
    suppression: SuppressionRepository | None = None
    key_ring: KeyRing | None = None
    followups: FollowupsRepository | None = None
    today: TodayRepository | None = None
    outbox: OutboxRepository | None = None
    outbox_adapter: ChannelAdapter | None = None
    visits: VisitsRepository | None = None
    scheduler: SchedulerRepository | None = None
    catalogue: CatalogueRepository | None = None
    catalogue_storage: StorageClient | None = None
    lead_search: LeadSearchRepository | None = None
    voice: VoiceStack | None = None
    integrations: IntegrationsRepository | None = None
    policies: PolicyVersions | None = None
    privacy: PrivacyRepository | None = None
    policy_gate: PolicyGate | None = None
    whatsapp: WhatsAppRuntime | None = None
    team: TeamRepository | None = None
    workspace: WorkspaceRepository | None = None
    notifications: NotificationsRuntime | None = None
    research_web: ResearchWeb | None = None
    research_usage: ResearchUsageRepository | None = None
    connectors: Connectors | None = None
    business_profile: BusinessProfileRepository | None = None
    # job DT (ADR 0115): sends the notices that follow a sensitive privacy action (None = none)
    mail_sender: EmailSender | None = None
    # job CK: packs and modules (the database), the sign-up cards (the files), custom fields,
    # and which sign-up providers are on
    packs: PacksRepository | None = None
    pack_registry: PackRegistry | None = None
    custom_fields: CustomFieldsRepository | None = None
    auth_providers: AuthProvidersOut | None = None
    # job CN: sites, dues, material quotes, deliveries (each a module of the pack)
    sites: SitesRepository | None = None
    dues: DuesRepository | None = None
    materials: MaterialsRepository | None = None
    deliveries: DeliveriesRepository | None = None
    # job CP: reminder campaigns and the call list (modules campaigns, call_list)
    campaigns: CampaignsRepository | None = None
    # job CR: the education pack; no agent or assistant path reads it (children's data)
    education: EducationRepository | None = None
    # job CV: the reports of every pack, in one shape
    reports: ReportsRepository | None = None
    # job CV: voice notes (settings, voices, the spoken disclosure, the fair-use meter)
    voice_notes: VoiceNotesRepository | None = None
    # job DP part 5: the Owner's own voice, made with a recorded consent
    own_voice: OwnVoiceService | None = None
    # job DI: plans and billing (catalogue, usage meters, trial and cancel; the FAKE provider)
    billing: BillingService | None = None
    # job DP part 4: how the assistant behaves on calls, per workspace and per campaign
    call_settings: CallSettingsService | None = None
    # job DM: outcomes of calls and WhatsApp follow-ups (positive, negative, unclear)
    outcomes: OutcomesRepository | None = None
    # job DM: the AI assistant's settings per workspace (Settings > AI assistant)
    assistant_settings: AssistantSettingsService | None = None
    # job DP: marks and report messages to guardians from a file that is never stored
    marks_messages: MarksSendService | None = None
    # job DQ part 4 (DPDP): consent, profile, the public grievance and waitlist doors
    dpdp: DpdpRuntime | None = None
    # job DS: how the assistant talks (everyday spoken style per language)
    speaking: SpeakingService | None = None
    # job DR / A1: the lead playbook of a workspace and its knowledge base
    lead_playbook: LeadPlaybookService | None = None
    knowledge: KnowledgeService | None = None
    # job DR / A2: lead imports and live sources
    lead_sources: LeadSourcesService | None = None
    # job DR A3: speed to lead and approve once
    outreach: OutreachService | None = None
    # job DR B1: "Ask Vijaya to do it" (plan, approve once, run, report)
    tasks: TasksService | None = None
    # job DS: the voice picker's listening sample (one short clip, cached, capped)
    voice_sample: VoiceSampleService | None = None


@dataclass(frozen=True)
class TenantContext:
    principal: Principal
    tenant: TenantOut
    role: Role


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        # Fail closed: never serve tenant data without a configured verifier.
        raise ApiError(503, "auth_not_configured", "Authentication is not configured.")
    return runtime


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def get_principal(request: Request, runtime: RuntimeDep) -> Principal:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise unauthorized()
    try:
        return runtime.verifier.verify(token.strip())
    except AuthError as exc:
        logger.warning("token rejected: %s", exc)  # reason only, never the token
        raise unauthorized() from exc


# job DI / DP part 3: what a read-only workspace may still do, and what spends, is decided in
# ONE place (app/billing/gate.py); this dependency is the only door to a tenant's address


def _second_factor_on(runtime: Runtime, principal: Principal) -> bool:
    """Did the person turn the authenticator on? Only a sensitive action on a session that has not
    entered a code asks the database; if it cannot be asked the answer is yes (fail closed)."""
    if runtime.workspace is None:
        return True
    try:
        status = runtime.workspace.account_security(principal.token)
        return status.get("second_factor_on") is not False
    except Exception:
        logger.warning("second factor status unavailable: asking for the code")
        return True


def require_tenant_role(*allowed: Role, strong: bool = False) -> Callable[..., TenantContext]:
    """Dependency factory. No roles given = any member of the tenant.

    `strong=True` (ADR 0016, changed by ADR 0115): an Owner or Admin who turned the authenticator
    on must have entered the code in this session (aal2); one who did not is never asked. It is
    checked AFTER the role, so a caller who may not do the action at all gets the plain 403 and
    nothing about their session level. Sales and Viewers are never asked.

    Unknown, malformed and foreign tenant ids all give the same 404, so a caller cannot probe for
    existence. A member whose role is too low gets 403: they already know the tenant exists.
    """

    def dependency(
        tenant_id: str,
        request: Request,
        principal: Annotated[Principal, Depends(get_principal)],
        runtime: RuntimeDep,
    ) -> TenantContext:
        try:
            parsed = uuid.UUID(tenant_id)
        except ValueError:
            raise not_found() from None
        membership = runtime.repository.get_membership(principal.token, principal.user_id, parsed)
        if membership is None:
            raise not_found()
        if allowed and membership.role not in allowed:
            raise forbidden()
        kind = gate.classify(request.method, gate.tail_of(request.url.path, tenant_id))
        if runtime.billing is not None and kind != "read":
            # job DI / DP part 3: a workspace whose trial ended unpaid is read-only (viewing,
            # signing in and exporting stay; every change, send, AI and call stops); one still
            # waiting for WhatsApp holds the sends, AI and calls. "full" while the switch is off.
            runtime.billing.ensure(principal.token, parsed, kind)
        if strong and membership.role in (Role.OWNER, Role.ADMIN) and principal.aal != "aal2":
            # ADR 0115: the authenticator is optional. A person who turned it on enters the code
            # once per sign-in session; this session has not: ask. (Nobody else is ever asked.)
            if _second_factor_on(runtime, principal):
                raise mfa_required("second_factor")
        if runtime.policy_gate is not None:
            # job BN: a changed terms or privacy version must be accepted first (POLICY_ENFORCE)
            user = str(principal.user_id)
            runtime.policy_gate.check(runtime.integrations, principal.token, user)
        return TenantContext(principal=principal, tenant=membership.tenant, role=membership.role)

    return dependency


PrincipalDep = Annotated[Principal, Depends(get_principal)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
