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
    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None) -> dict[str, Any]: ...
    def open_access(self, token: str, tenant_id: uuid.UUID, scope: str, reason_code: str, reason_text: str | None) -> dict[str, Any]: ...
    def business(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID) -> dict[str, Any]: ...
    def audit(self, token: str, tenant_id: uuid.UUID | None, staff_id: uuid.UUID | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]: ...
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

    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None) -> dict[str, Any]:
        return self._rpc.object(token, "admin_businesses_list", {"p_q": q, "p_limit": limit, "p_after_name": after[0] if after else None, "p_after_id": str(after[1]) if after else None})

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
    balance_paise: int
    balance_text: str              # "₹1,550"
    status: BusinessStatus
    signup_at: datetime
    last_activity_at: datetime | None


class BusinessesOut(_Out):
    items: list[BusinessRowOut]
    next_cursor: str | None


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
    return BusinessRowOut(tenant_id=r["tenant_id"], name=r["name"], demo=bool(r.get("demo")), business_type=r.get("business_type"), plan=r["plan"], balance_paise=int(r["balance_paise"]),
                          balance_text=inr(int(r["balance_paise"])), status=r["status"], signup_at=r["signup_at"], last_activity_at=r.get("last_activity_at"))


class AdminService:
    def __init__(self, repo: AdminRepository) -> None:
        self._repo = repo

    def me(self, token: str) -> MeOut:
        return MeOut.model_validate(self._repo.me(token))

    def businesses(self, token: str, q: str | None, limit: int, cursor: str | None) -> BusinessesOut:
        after: tuple[str, uuid.UUID] | None = None
        if cursor:
            d = _dec(cursor)
            try:
                after = (str(d["n"]), uuid.UUID(str(d["i"])))
            except (KeyError, ValueError):
                raise BadCursorError(cursor) from None
        got = self._repo.businesses(token, q, limit, after)
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
