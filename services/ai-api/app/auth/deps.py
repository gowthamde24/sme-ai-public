"""FastAPI dependencies: who is calling (Principal) and may they act on this tenant."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from app.agent_runs.wiring import AgentsRuntime
from app.auth.jwt import AuthError, Principal, TokenVerifier
from app.businessprofile.repository import BusinessProfileRepository
from app.catalogue.repository import CatalogueRepository
from app.catalogue.storage import StorageClient
from app.connectors.runtime import Connectors
from app.crm.repository import CrmRepository
from app.customfields.repository import CustomFieldsRepository
from app.enquiries.repository import EnquiriesRepository
from app.erasure.repository import ErasureRepository
from app.errors import ApiError, forbidden, mfa_required, not_found, unauthorized
from app.evidence.repository import EvidenceRepository
from app.followups.repository import FollowupsRepository
from app.integrations.policy import PolicyVersions
from app.integrations.repository import IntegrationsRepository
from app.leads.repository import LeadsRepository
from app.leadtools.repository import LeadSearchRepository
from app.notifications.runtime import NotificationsRuntime
from app.orders.repository import OrdersRepository
from app.outbox.adapter import ChannelAdapter
from app.outbox.repository import OutboxRepository
from app.packs.models import AuthProvidersOut
from app.packs.registry import PackRegistry
from app.packs.repository import PacksRepository
from app.pricelists.repository import PriceListRepository
from app.privacy.policy_gate import PolicyGate
from app.privacy.repository import PrivacyRepository
from app.quotes.repository import QuotesRepository
from app.scheduler.repository import SchedulerRepository
from app.suppression.keys import KeyRing
from app.suppression.repository import SuppressionRepository
from app.team.repository import TeamRepository
from app.tenancy.models import Role, TenantOut
from app.tenancy.repository import TenantRepository
from app.today.repository import TodayRepository
from app.visits.repository import VisitsRepository
from app.voice.interface import VoiceStack
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
    # job CK: packs and modules (the database), the sign-up cards (the files), custom fields,
    # and which sign-up providers are on
    packs: PacksRepository | None = None
    pack_registry: PackRegistry | None = None
    custom_fields: CustomFieldsRepository | None = None
    auth_providers: AuthProvidersOut | None = None


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


def require_tenant_role(*allowed: Role, strong: bool = False) -> Callable[..., TenantContext]:
    """Dependency factory. No roles given = any member of the tenant.

    `strong=True` (ADR 0016): an Owner or Admin must also hold an aal2 session (a second factor was
    entered). It is checked AFTER the role, so a caller who may not do the action at all gets the
    plain 403 and nothing about their session level. Sales and Viewers are never asked.

    Unknown, malformed and foreign tenant ids all give the same 404, so a caller cannot probe for
    existence. A member whose role is too low gets 403: they already know the tenant exists.
    """

    def dependency(
        tenant_id: str,
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
        if strong and membership.role in (Role.OWNER, Role.ADMIN) and principal.aal != "aal2":
            raise mfa_required()
        if runtime.policy_gate is not None:
            # job BN: a changed terms or privacy version must be accepted first (POLICY_ENFORCE)
            user = str(principal.user_id)
            runtime.policy_gate.check(runtime.integrations, principal.token, user)
        return TenantContext(principal=principal, tenant=membership.tenant, role=membership.role)

    return dependency


PrincipalDep = Annotated[Principal, Depends(get_principal)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
