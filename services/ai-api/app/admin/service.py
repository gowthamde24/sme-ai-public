# ruff: noqa: E501
"""Admin console, phase 1 (owner approved 13 Nov 2026, docs/plans/admin-console.md). The DATABASE proves everything (staff row, role, second factor, 30-minute session, access with a reason); this layer only shapes the answers and
turns the database's coded refusals into the API's. Money is rupees text next to paise; end-customer names and numbers arrive already masked."""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from app.pricing.inr import inr
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class NotStaffError(RepositoryError):
    """SM941: the caller is not an active member of Stack19 staff."""


class SecondFactorRequiredError(RepositoryError):
    """SM942: staff always need a second factor in this session."""


class SessionEndedError(RepositoryError):
    """SM943: 30 minutes without activity (or no session id): sign in again."""


class AccessRequiredError(RepositoryError):
    """SM944: no valid access (with a reason) for this business."""


class OwnerOkRequiredError(RepositoryError):
    """SM945: the business asked to be asked first and has not said yes."""


class ReasonRequiredError(RepositoryError):
    """SM946: no reason, no data."""


ERRORS = {"SM941": NotStaffError, "SM942": SecondFactorRequiredError, "SM943": SessionEndedError, "SM944": AccessRequiredError, "SM945": OwnerOkRequiredError, "SM946": ReasonRequiredError}


class AdminRepository(Protocol):
    def me(self, token: str) -> dict[str, Any]: ...
    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None, sort: str = "name") -> dict[str, Any]: ...
    def open_access(self, token: str, tenant_id: uuid.UUID, scope: str, reason_code: str, reason_text: str | None) -> dict[str, Any]: ...
    def business(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID) -> dict[str, Any]: ...
    def audit(self, token: str, tenant_id: uuid.UUID | None, staff_id: uuid.UUID | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]: ...
    def overview(self, token: str) -> dict[str, Any]: ...
    def search(self, token: str, q: str) -> dict[str, Any]: ...
    def tickets(self, token: str, status: str, limit: int) -> dict[str, Any]: ...
    def ticket_create(self, token: str, tenant_id: uuid.UUID, subject: str, channel: str, priority: str, assignee_id: uuid.UUID | None) -> dict[str, Any]: ...
    def support_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def support_set(self, token: str, tenant_id: uuid.UUID, require_ok: bool) -> dict[str, Any]: ...
    def support_approve(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestAdminRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, ERRORS, client=client)

    def close(self) -> None:
        self._rpc.close()

    def me(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "admin_me", {})

    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None, sort: str = "name") -> dict[str, Any]:
        return self._rpc.object(token, "admin_businesses_list", {"p_q": q, "p_limit": limit, "p_after_name": after[0] if after else None, "p_after_id": str(after[1]) if after else None, "p_sort": sort})

    def overview(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "admin_overview", {})

    def search(self, token: str, q: str) -> dict[str, Any]:
        return self._rpc.object(token, "admin_search", {"p_q": q})

    def tickets(self, token: str, status: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "admin_tickets_list", {"p_status": status, "p_limit": limit})

    def ticket_create(self, token: str, tenant_id: uuid.UUID, subject: str, channel: str, priority: str, assignee_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "admin_ticket_create", {"p_tenant_id": str(tenant_id), "p_subject": subject, "p_channel": channel, "p_priority": priority, "p_assignee_id": str(assignee_id) if assignee_id else None})

    def open_access(self, token: str, tenant_id: uuid.UUID, scope: str, reason_code: str, reason_text: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "admin_access_open", {"p_tenant_id": str(tenant_id), "p_scope": scope, "p_reason_code": reason_code, "p_reason_text": reason_text})

    def business(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "admin_business_get", {"p_tenant_id": str(tenant_id), "p_access_id": str(access_id)})

    def audit(self, token: str, tenant_id: uuid.UUID | None, staff_id: uuid.UUID | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]:
        return self._rpc.object(token, "admin_audit_list", {"p_tenant_id": str(tenant_id) if tenant_id else None, "p_staff_id": str(staff_id) if staff_id else None, "p_limit": limit,
                                                           "p_before_at": before[0].isoformat() if before else None, "p_before_id": str(before[1]) if before else None})

    def support_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "support_access_get", {"p_tenant_id": str(tenant_id)})

    def support_set(self, token: str, tenant_id: uuid.UUID, require_ok: bool) -> dict[str, Any]:
        return self._rpc.object(token, "support_access_set", {"p_tenant_id": str(tenant_id), "p_require_ok": require_ok})

    def support_approve(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "support_access_approve", {"p_tenant_id": str(tenant_id)})


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


Role = Literal["owner", "support", "finance"]
BusinessStatus = Literal["not_live", "in_training", "live", "paused"]
ReasonCode = Literal["support_ticket", "customer_asked", "privacy_request", "incident", "billing_dispute", "other"]


class MeOut(_Out):
    staff_id: uuid.UUID
    name: str
    role: Role
    second_factor: bool
    session_idle_limit_minutes: int


class BusinessRowOut(_Out):
    tenant_id: uuid.UUID
    name: str
    demo: bool
    business_type: str | None
    plan: str                      # "none" | "payg" | "sales_assistant" | "sales_lead_finder"
    plan_name: str                 # "Sales Assistant + Lead Finder", or "No plan"
    town: str | None
    balance_paise: int
    balance_text: str              # "₹1,550"
    status: BusinessStatus
    signup_at: datetime
    last_activity_at: datetime | None


class BusinessesOut(_Out):
    items: list[BusinessRowOut]
    next_cursor: str | None


TicketChannel = Literal["phone", "whatsapp", "chat", "email"]
TicketPriority = Literal["urgent", "high", "normal"]
TicketStatus = Literal["open", "waiting", "closed"]
HealthState = Literal["healthy", "degraded", "down", "unknown"]


class AssigneeOut(_Out):
    id: uuid.UUID
    name: str | None


class TicketOut(_Out):
    id: uuid.UUID
    tenant_id: uuid.UUID
    business_name: str
    subject: str
    channel: TicketChannel
    priority: TicketPriority
    status: TicketStatus
    created_at: datetime
    last_message_at: datetime
    waiting_minutes: int           # since the last message: the screen draws "12 min", "1 h"
    assignee: AssigneeOut | None


class TicketsOut(_Out):
    items: list[TicketOut]
    total: int


class TicketIn(_Out):
    tenant_id: uuid.UUID
    subject: str = Field(min_length=3, max_length=140)
    channel: TicketChannel
    priority: TicketPriority = "normal"
    assignee_id: uuid.UUID | None = None


class BadgesOut(_Out):
    businesses: int
    support_open: int
    health_issues: int
    compliance_open: int


class MrrOut(_Out):
    paise: int
    text: str
    change_percent: float | None   # null until there is a month of history to compare with


class ActiveBusinessesOut(_Out):
    count: int
    added_this_week: int
    on_free_start: int             # businesses that only have the free start (the old "in trial")


class CallsTodayOut(_Out):
    count: int
    connected_percent: float | None


class GrossMarginOut(_Out):
    percent: float | None          # null while there is no revenue this month
    revenue_paise: int
    revenue_text: str
    cost_paise: int
    cost_text: str
    costs_recorded_since: datetime | None   # provider costs are recorded from this moment on (no back-fill)


class KpisOut(_Out):
    mrr: MrrOut | None             # owner and finance only
    active_businesses: ActiveBusinessesOut
    calls_today: CallsTodayOut
    gross_margin: GrossMarginOut | None


class SupportQueueOut(_Out):
    total_open: int
    items: list[TicketOut]


class HealthComponentOut(_Out):
    key: Literal["api", "phone_calls", "whatsapp", "voice", "database", "payments"]
    label: str
    state: HealthState             # "unknown" = not measured yet (never guessed)
    note: str | None


class HealthOut(_Out):
    components: list[HealthComponentOut]
    issues: int


class ProviderCostOut(_Out):
    provider: Literal["cartesia", "sarvam", "plivo", "anthropic", "meta", "google"]
    role: Literal["voice", "speech_to_text", "calls_and_numbers", "ai_model", "whatsapp", "lead_search"]
    cost_paise: int
    cost_text: str


class CostsOut(_Out):
    period_start: datetime
    revenue_paise: int
    revenue_text: str
    cost_paise: int
    cost_text: str
    margin_paise: int
    margin_text: str
    providers: list[ProviderCostOut]


class EnvironmentOut(_Out):
    key: Literal["staging", "production"]
    label: str                     # "Staging · test data"; empty in production


ENVIRONMENT_LABELS = {"staging": "Staging · test data", "production": ""}


class OverviewOut(_Out):
    generated_at: datetime
    role: Role
    environment: EnvironmentOut
    badges: BadgesOut
    kpis: KpisOut
    support_queue: SupportQueueOut | None   # owner and support only
    health: HealthOut
    businesses: list[BusinessRowOut]
    costs_this_month: CostsOut | None       # owner and finance only


class InvoiceHitOut(_Out):
    number: str
    kind: str
    tenant_id: uuid.UUID
    business_name: str
    total_paise: int
    total_text: str
    issued_at: datetime


class SearchOut(_Out):
    businesses: list[BusinessRowOut]
    invoices: list[InvoiceHitOut]
    tickets: list[TicketOut]


class AccessIn(_Out):
    tenant_id: uuid.UUID
    scope: Literal["profile", "billing"] = "profile"
    reason_code: ReasonCode
    reason_text: str | None = Field(default=None, min_length=3, max_length=300)


class AccessOut(_Out):
    access_id: uuid.UUID
    tenant_id: uuid.UUID
    scope: Literal["profile", "billing"]
    expires_at: datetime


class SetupOut(_Out):
    business_name: bool
    phone_number: bool
    voice_saved: bool
    rules_saved: bool


class PhoneNumberOut(_Out):
    number: str
    label: str | None
    inbound_on: bool


class WhatsappOut(_Out):
    connected: bool
    status: str | None
    display_phone: str | None
    connected_at: datetime | None


class Numbers30dOut(_Out):
    calls: int
    call_minutes: float
    messages_sent: int
    leads: int
    quotes: int
    visits: int


class RecentCallOut(_Out):
    id: uuid.UUID
    at: datetime
    direction: str
    state: str | None
    duration_s: int | None
    outcome: str | None
    customer: str | None           # masked: "P•••••• N••••"
    customer_phone: str | None     # masked: "+•• ••••• ••210"


class RecentChatOut(_Out):
    lead_id: uuid.UUID
    last_at: datetime
    customer: str | None
    customer_phone: str | None


class BusinessDetailOut(_Out):
    business: BusinessRowOut
    setup: SetupOut
    phone_numbers: list[PhoneNumberOut]
    whatsapp: WhatsappOut
    numbers_30d: Numbers30dOut
    recent_calls: list[RecentCallOut]
    recent_chats: list[RecentChatOut]
    support_view: bool = True      # the screen shows a "support view" banner and no edit control


class AuditStaffOut(_Out):
    id: uuid.UUID
    name: str | None


class AuditItemOut(_Out):
    id: uuid.UUID
    at: datetime
    staff: AuditStaffOut
    action: str
    tenant_id: uuid.UUID | None
    scope: str | None
    reason_code: str | None
    reason_text: str | None
    target_kind: str | None
    target_id: str | None
    customer_visible: bool


class AuditOut(_Out):
    items: list[AuditItemOut]
    next_cursor: str | None


class SupportAccessOut(_Out):
    require_ok: bool
    approved_until: datetime | None


class SupportAccessIn(_Out):
    require_ok: bool


def _enc(d: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).decode().rstrip("=")


def _dec(c: str) -> dict[str, Any]:
    try:
        d = json.loads(base64.urlsafe_b64decode(c + "=" * (-len(c) % 4)))
    except (ValueError, UnicodeDecodeError):
        raise BadCursorError(c) from None
    if not isinstance(d, dict):
        raise BadCursorError(c)
    return d


class BadCursorError(ValueError):
    """The cursor is not one this API made."""


def _row(r: dict[str, Any]) -> BusinessRowOut:
    return BusinessRowOut(tenant_id=r["tenant_id"], name=r["name"], demo=bool(r.get("demo")), business_type=r.get("business_type"), plan=r["plan"], plan_name=r.get("plan_name") or "No plan", town=r.get("town"), balance_paise=int(r["balance_paise"]),
                          balance_text=inr(int(r["balance_paise"])), status=r["status"], signup_at=r["signup_at"], last_activity_at=r.get("last_activity_at"))


class AdminService:
    def __init__(self, repo: AdminRepository, environment: str = "production") -> None:
        self._repo = repo
        self._environment: Literal["staging", "production"] = "staging" if environment == "staging" else "production"

    def me(self, token: str) -> MeOut:
        return MeOut.model_validate(self._repo.me(token))

    def businesses(self, token: str, q: str | None, limit: int, cursor: str | None, sort: str = "name") -> BusinessesOut:
        after: tuple[str, uuid.UUID] | None = None
        if cursor:
            d = _dec(cursor)
            try:
                after = (str(d["n"]), uuid.UUID(str(d["i"])))
            except (KeyError, ValueError):
                raise BadCursorError(cursor) from None
        got = self._repo.businesses(token, q, limit, after, sort)
        nxt = got.get("next")
        return BusinessesOut(items=[_row(r) for r in got["items"]], next_cursor=_enc({"n": nxt["after_name"], "i": nxt["after_id"]}) if nxt else None)

    def open_access(self, token: str, body: AccessIn) -> AccessOut:
        return AccessOut.model_validate(self._repo.open_access(token, body.tenant_id, body.scope, body.reason_code, body.reason_text))

    def business(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID) -> BusinessDetailOut:
        d = self._repo.business(token, tenant_id, access_id)
        return BusinessDetailOut(business=_row(d["business"]), setup=SetupOut.model_validate(d["setup"]), phone_numbers=[PhoneNumberOut.model_validate(x) for x in d["phone_numbers"]],
                                 whatsapp=WhatsappOut.model_validate(d["whatsapp"]), numbers_30d=Numbers30dOut.model_validate(d["numbers_30d"]),
                                 recent_calls=[RecentCallOut.model_validate(x) for x in d["recent_calls"]], recent_chats=[RecentChatOut.model_validate(x) for x in d["recent_chats"]])

    def audit(self, token: str, tenant_id: uuid.UUID | None, staff_id: uuid.UUID | None, limit: int, cursor: str | None) -> AuditOut:
        before: tuple[datetime, uuid.UUID] | None = None
        if cursor:
            d = _dec(cursor)
            try:
                before = (datetime.fromisoformat(str(d["t"])), uuid.UUID(str(d["i"])))
            except (KeyError, ValueError):
                raise BadCursorError(cursor) from None
        got = self._repo.audit(token, tenant_id, staff_id, limit, before)
        nxt = got.get("next")
        return AuditOut(items=[AuditItemOut.model_validate(x) for x in got["items"]], next_cursor=_enc({"t": nxt["before_at"], "i": nxt["before_id"]}) if nxt else None)

    def support_get(self, token: str, tenant_id: uuid.UUID) -> SupportAccessOut:
        return SupportAccessOut.model_validate(self._repo.support_get(token, tenant_id))

    def support_set(self, token: str, tenant_id: uuid.UUID, require_ok: bool) -> SupportAccessOut:
        return SupportAccessOut.model_validate(self._repo.support_set(token, tenant_id, require_ok))

    def support_approve(self, token: str, tenant_id: uuid.UUID) -> SupportAccessOut:
        return SupportAccessOut.model_validate(self._repo.support_approve(token, tenant_id))

    def overview(self, token: str) -> OverviewOut:
        d = self._repo.overview(token)
        k = d["kpis"]
        mrr = k.get("mrr")
        gm = k.get("gross_margin")
        q = d.get("support_queue")
        c = d.get("costs_this_month")
        return OverviewOut(
            generated_at=d["generated_at"], role=d["role"], environment=EnvironmentOut(key=self._environment, label=ENVIRONMENT_LABELS[self._environment]), badges=BadgesOut.model_validate(d["badges"]),
            kpis=KpisOut(
                mrr=MrrOut(paise=int(mrr["paise"]), text=inr(int(mrr["paise"])), change_percent=mrr.get("change_percent")) if mrr else None,
                active_businesses=ActiveBusinessesOut.model_validate(k["active_businesses"]), calls_today=CallsTodayOut.model_validate(k["calls_today"]),
                gross_margin=GrossMarginOut(percent=gm.get("percent"), revenue_paise=int(gm["revenue_paise"]), revenue_text=inr(int(gm["revenue_paise"])), cost_paise=int(gm["cost_paise"]),
                                            cost_text=inr(int(gm["cost_paise"])), costs_recorded_since=gm.get("costs_recorded_since")) if gm else None),
            support_queue=SupportQueueOut(total_open=int(q["total_open"]), items=[TicketOut.model_validate(x) for x in q["items"]]) if q else None,
            health=HealthOut(components=[HealthComponentOut.model_validate(x) for x in d["health"]["components"]], issues=int(d["health"]["issues"])),
            businesses=[_row(r) for r in d["businesses"]],
            costs_this_month=CostsOut(
                period_start=c["period_start"], revenue_paise=int(c["revenue_paise"]), revenue_text=inr(int(c["revenue_paise"])), cost_paise=int(c["cost_paise"]), cost_text=inr(int(c["cost_paise"])),
                margin_paise=int(c["margin_paise"]), margin_text=inr(int(c["margin_paise"])),
                providers=[ProviderCostOut(provider=x["provider"], role=x["role"], cost_paise=int(x["cost_paise"]), cost_text=inr(int(x["cost_paise"]))) for x in c["providers"]]) if c else None)

    def search(self, token: str, q: str) -> SearchOut:
        d = self._repo.search(token, q)
        return SearchOut(businesses=[_row(r) for r in d["businesses"]],
                         invoices=[InvoiceHitOut(number=i["number"], kind=i["kind"], tenant_id=i["tenant_id"], business_name=i["business_name"], total_paise=int(i["total_paise"]),
                                                 total_text=inr(int(i["total_paise"])), issued_at=i["issued_at"]) for i in d["invoices"]],
                         tickets=[TicketOut.model_validate(x) for x in d["tickets"]])

    def tickets(self, token: str, status: str, limit: int) -> TicketsOut:
        d = self._repo.tickets(token, status, limit)
        return TicketsOut(items=[TicketOut.model_validate(x) for x in d["items"]], total=int(d["total"]))

    def ticket_create(self, token: str, body: TicketIn) -> TicketOut:
        return TicketOut.model_validate(self._repo.ticket_create(token, body.tenant_id, body.subject, body.channel, body.priority, body.assignee_id))
