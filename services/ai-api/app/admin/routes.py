# ruff: noqa: E501
"""Admin console API, phase 1 (Stack19 staff only; off = 404 unless ADMIN_CONSOLE is on).
  GET  /v1/admin/me                                     who am I (role), proves the staff row, the second factor and the session
  GET  /v1/admin/businesses?q=&limit=&cursor=           the businesses: plan, rupee balance, status, signup date, last activity (no end-customer data, no reason needed)
  POST /v1/admin/access                                 ask to look at ONE business with a REASON (15 minutes); the shop owner sees it in their activity log
  GET  /v1/admin/businesses/{tenant_id}?access_id=      the support view (read-only, end-customer names and numbers masked)
  GET  /v1/admin/audit?tenant_id=&staff_id=&limit=&cursor=   the audit trail (owner only)
  GET/PUT /v1/tenants/{t}/support-access, POST .../approve   the SHOP OWNER's "Require my OK before support views my account" (default off)
Refusals: 403 not_staff / second_factor_required / forbidden, 401 session_ended (sign in again), 403 access_required, 409 owner_ok_required, 422 reason_required.
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

import uuid
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any, Literal, TypeVar

from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse

from app.admin.service import (
    AccessIn,
    AccessOut,
    AccessRequiredError,
    AdminService,
    AlertAckOut,
    AlertsOut,
    AssistantHoldIn,
    AuditOut,
    BadCursorError,
    BusinessDetailOut,
    BusinessesOut,
    BusinessRowOut,
    CannedIn,
    CannedListOut,
    CannedOut,
    FailedPaymentsOut,
    GoodwillIn,
    GoodwillLimitError,
    GoodwillOut,
    GoogleUsageOut,
    MeOut,
    MoneyInvoicesOut,
    MoneySummaryOut,
    NoteIn,
    NoteOut,
    NotesOut,
    NotStaffError,
    OverviewOut,
    OwnerOkRequiredError,
    ReasonRequiredError,
    SearchOut,
    SecondConfirmRequiredError,
    SecondFactorRequiredError,
    SessionEndedError,
    SupportAccessIn,
    SupportAccessOut,
    TicketAssignIn,
    TicketClosedError,
    TicketIn,
    TicketOut,
    TicketReplyIn,
    TicketsOut,
    TicketStatusIn,
    TicketThreadOut,
    UnmaskIn,
    UnmaskOut,
    UsageSummaryOut,
)
from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/admin", tags=["admin"])
tenant_router = APIRouter(prefix="/v1/tenants/{tenant_id}/support-access", tags=["admin"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
T = TypeVar("T")


def _service(runtime: Runtime) -> AdminService:
    if runtime.admin is None:
        raise not_found()   # the console does not exist unless ADMIN_CONSOLE is on
    return runtime.admin  # type: ignore[no-any-return]


def _guard(call: Callable[[], T]) -> T:
    """The database's coded refusals as the API's. Nothing about WHY a caller is not staff beyond the code."""
    try:
        return call()
    except NotStaffError:
        raise ApiError(403, "not_staff", "This is for Stack19 staff only.") from None
    except SecondFactorRequiredError:
        raise ApiError(403, "second_factor_required", "Staff sign in with a second factor every time.") from None
    except SessionEndedError:
        raise ApiError(401, "session_ended", "Your session ended after 30 minutes without activity. Sign in again.") from None
    except AccessRequiredError:
        raise ApiError(403, "access_required", "Open this business first, with a reason.") from None
    except OwnerOkRequiredError:
        raise ApiError(409, "owner_ok_required", "This business asked to be asked first. They have not said yes yet.") from None
    except SecondConfirmRequiredError:
        raise ApiError(403, "second_confirm_required", "Enter your authenticator code again to do this.") from None
    except GoodwillLimitError:
        raise ApiError(409, "goodwill_limit", "That is over the goodwill limit: ₹3,000 per business in 30 days.") from None
    except ReasonRequiredError:
        raise ApiError(422, "reason_required", "Say why you need to look at this business.") from None
    except TicketClosedError:
        raise ApiError(409, "ticket_closed", "This ticket is closed. Reopen it to reply.") from None
    except BadCursorError:
        raise ApiError(422, "bad_cursor", "That page marker is not valid.") from None


@router.get("/me", response_model=MeOut)
def me(principal: PrincipalDep, runtime: RuntimeDep) -> MeOut:
    return _guard(lambda: _service(runtime).me(principal.token))


@router.get("/businesses", response_model=BusinessesOut)
def businesses(principal: PrincipalDep, runtime: RuntimeDep, q: Annotated[str | None, Query(max_length=80)] = None,
               limit: Annotated[int, Query(ge=1, le=100)] = 30, cursor: Annotated[str | None, Query(max_length=400)] = None,
               sort: Annotated[Literal["name", "last_activity"], Query()] = "name") -> BusinessesOut:
    return _guard(lambda: _service(runtime).businesses(principal.token, q, limit, cursor, sort))


@router.get("/overview", response_model=OverviewOut)
def overview(principal: PrincipalDep, runtime: RuntimeDep) -> OverviewOut:
    """Everything the Overview screen draws, in ONE call: sidebar counts, the four KPIs, the support queue, health per component, the newest-active businesses, our costs per provider and the margin."""
    return _guard(lambda: _service(runtime).overview(principal.token))


@router.get("/search", response_model=SearchOut)
def search(principal: PrincipalDep, runtime: RuntimeDep, q: Annotated[str, Query(min_length=2, max_length=80)]) -> SearchOut:
    return _guard(lambda: _service(runtime).search(principal.token, q))


@router.get("/support/tickets", response_model=TicketsOut)
def tickets(principal: PrincipalDep, runtime: RuntimeDep, status: Annotated[Literal["open", "waiting", "closed", "active"], Query()] = "active",
            limit: Annotated[int, Query(ge=1, le=100)] = 30) -> TicketsOut:
    return _guard(lambda: _service(runtime).tickets(principal.token, status, limit))


@router.post("/support/tickets", response_model=TicketOut, status_code=201)
def create_ticket(body: TicketIn, principal: PrincipalDep, runtime: RuntimeDep) -> TicketOut:
    return _guard(lambda: _service(runtime).ticket_create(principal.token, body))


@router.get("/support/tickets/{ticket_id}", response_model=TicketThreadOut)
def ticket(ticket_id: uuid.UUID, principal: PrincipalDep, runtime: RuntimeDep) -> TicketThreadOut:
    """The thread: the ticket and its messages (replies and internal notes), oldest first."""
    return _guard(lambda: _service(runtime).ticket_get(principal.token, ticket_id))


@router.post("/support/tickets/{ticket_id}/reply", response_model=TicketThreadOut, status_code=201)
def ticket_reply(ticket_id: uuid.UUID, body: TicketReplyIn, principal: PrincipalDep, runtime: RuntimeDep) -> TicketThreadOut:
    """A reply to the shop (the ticket then waits for the shop) or `kind: note` for staff only. Not sent anywhere yet: every message says `delivered: false`."""
    return _guard(lambda: _service(runtime).ticket_reply(principal.token, ticket_id, body))


@router.post("/support/tickets/{ticket_id}/status", response_model=TicketThreadOut)
def ticket_status(ticket_id: uuid.UUID, body: TicketStatusIn, principal: PrincipalDep, runtime: RuntimeDep) -> TicketThreadOut:
    return _guard(lambda: _service(runtime).ticket_status(principal.token, ticket_id, body))


@router.post("/support/tickets/{ticket_id}/assign", response_model=TicketThreadOut)
def ticket_assign(ticket_id: uuid.UUID, body: TicketAssignIn, principal: PrincipalDep, runtime: RuntimeDep) -> TicketThreadOut:
    return _guard(lambda: _service(runtime).ticket_assign(principal.token, ticket_id, body))


@router.post("/access", response_model=AccessOut, status_code=201)
def open_access(body: AccessIn, principal: PrincipalDep, runtime: RuntimeDep) -> AccessOut:
    return _guard(lambda: _service(runtime).open_access(principal.token, body))


@router.get("/businesses/{tenant_id}", response_model=BusinessDetailOut)
def business(tenant_id: uuid.UUID, access_id: Annotated[uuid.UUID, Query()], principal: PrincipalDep, runtime: RuntimeDep) -> BusinessDetailOut:
    return _guard(lambda: _service(runtime).business(principal.token, tenant_id, access_id))


@router.post("/businesses/{tenant_id}/assistant/pause", response_model=BusinessRowOut)
def assistant_pause(tenant_id: uuid.UUID, body: AssistantHoldIn, principal: PrincipalDep, runtime: RuntimeDep) -> BusinessRowOut:
    """Pause this business's assistant (an incident, a request): it stops answering calls, the shop owner cannot go live again until support resumes, and they see "Stack19 support paused your assistant" with the reason in their activity log. A reason is required."""
    return _guard(lambda: _service(runtime).assistant_pause(principal.token, tenant_id, body))


@router.post("/businesses/{tenant_id}/assistant/resume", response_model=BusinessRowOut)
def assistant_resume(tenant_id: uuid.UUID, body: AssistantHoldIn, principal: PrincipalDep, runtime: RuntimeDep) -> BusinessRowOut:
    """Lift a pause that SUPPORT set (the shop owner's own pause is theirs). 422 when there is nothing of ours to lift."""
    return _guard(lambda: _service(runtime).assistant_resume(principal.token, tenant_id, body))


@router.post("/businesses/{tenant_id}/goodwill-credit", response_model=GoodwillOut, status_code=201)
def goodwill_credit(tenant_id: uuid.UUID, body: GoodwillIn, principal: PrincipalDep, runtime: RuntimeDep) -> GoodwillOut:
    """Owner and finance only. Adds ₹1 to ₹1,000 (₹3,000 per business per 30 days) to the business's balance as a gesture. Needs: the amount typed twice (`confirm_paise`), a reason in words, a fresh authenticator code (403 `second_confirm_required`: ask for the code, refresh the session, send again), and an `idempotency_key` per click (a retry answers `replayed: true`). The shop owner sees "Stack19 added a goodwill credit to your balance" in their activity log."""
    return _guard(lambda: _service(runtime).goodwill_credit(principal.token, tenant_id, body))


@router.post("/businesses/{tenant_id}/unmask", response_model=UnmaskOut)
def unmask(tenant_id: uuid.UUID, body: UnmaskIn, principal: PrincipalDep, runtime: RuntimeDep) -> UnmaskOut:
    """The real names and numbers of the same ten recent calls and chats the support view shows masked. Needs the business access (first reason) AND a second reason in words (422 `reason_required`). One call = one look = one audit row; the shop owner sees "Stack19 support looked at your customers' contact details" with the reason. No message text, no transcript."""
    return _guard(lambda: _service(runtime).unmask(principal.token, tenant_id, body))


# ------------------------------------------------------------------------------------------------ canned replies, notes on a business (owner and support)
@router.get("/support/canned", response_model=CannedListOut)
def canned_list(principal: PrincipalDep, runtime: RuntimeDep, include_archived: bool = False) -> CannedListOut:
    return _guard(lambda: _service(runtime).canned_list(principal.token, include_archived))


@router.put("/support/canned/{canned_id}", response_model=CannedOut)
def canned_save(canned_id: uuid.UUID, body: CannedIn, principal: PrincipalDep, runtime: RuntimeDep) -> CannedOut:
    """Create (a new id) or change a canned reply; `archived: true` instead of delete."""
    return _guard(lambda: _service(runtime).canned_save(principal.token, canned_id, body))


@router.get("/businesses/{tenant_id}/notes", response_model=NotesOut)
def notes_list(tenant_id: uuid.UUID, principal: PrincipalDep, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=200)] = 50) -> NotesOut:
    return _guard(lambda: _service(runtime).notes_list(principal.token, tenant_id, limit))


@router.post("/businesses/{tenant_id}/notes", response_model=NoteOut, status_code=201)
def note_add(tenant_id: uuid.UUID, body: NoteIn, principal: PrincipalDep, runtime: RuntimeDep) -> NoteOut:
    """An internal note about a business: append-only, never shown to the shop. Do not put customer data in it."""
    return _guard(lambda: _service(runtime).note_add(principal.token, tenant_id, body))


# ------------------------------------------------------------------------------------------------ Money (owner and finance)
@router.get("/money/summary", response_model=MoneySummaryOut)
def money_summary(principal: PrincipalDep, runtime: RuntimeDep, start: Annotated[date, Query(alias="from")], end: Annotated[date, Query(alias="to")]) -> MoneySummaryOut:
    """MRR, active subscriptions per plan, new / upgrades / downgrades / cancellations (recorded from `movement.recorded_since`), top-ups, subscription invoices, refunds, goodwill credits and failed payments for the period (India dates, at most a year)."""
    return _guard(lambda: _service(runtime).money_summary(principal.token, start, end))


@router.get("/money/invoices", response_model=MoneyInvoicesOut)
def money_invoices(principal: PrincipalDep, runtime: RuntimeDep, start: Annotated[date, Query(alias="from")], end: Annotated[date, Query(alias="to")],
                   limit: Annotated[int, Query(ge=1, le=200)] = 50, cursor: Annotated[str | None, Query(max_length=400)] = None) -> MoneyInvoicesOut:
    return _guard(lambda: _service(runtime).money_invoices(principal.token, start, end, limit, cursor))


@router.get("/money/invoices.csv", response_class=PlainTextResponse)
def money_export(principal: PrincipalDep, runtime: RuntimeDep, start: Annotated[date, Query(alias="from")], end: Annotated[date, Query(alias="to")]) -> PlainTextResponse:
    """The invoices of the period as a CSV for the CA (at most 5,000; the first line says when they are test-mode invoices). Audited."""
    text = _guard(lambda: _service(runtime).money_export_csv(principal.token, start, end))
    return PlainTextResponse(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="stack19-invoices-{start.isoformat()}-{end.isoformat()}.csv"'})


@router.get("/money/failed-payments", response_model=FailedPaymentsOut)
def money_failed(principal: PrincipalDep, runtime: RuntimeDep) -> FailedPaymentsOut:
    return _guard(lambda: _service(runtime).money_failed(principal.token))


# ------------------------------------------------------------------------------------------------ Usage & cost, alerts (owner and finance; alerts also for support, without the money ones)
@router.get("/usage", response_model=UsageSummaryOut)
def usage_summary(principal: PrincipalDep, runtime: RuntimeDep, start: Annotated[date, Query(alias="from")], end: Annotated[date, Query(alias="to")],
                  limit: Annotated[int, Query(ge=1, le=500)] = 100) -> UsageSummaryOut:
    """What each provider cost US in the period against what we were paid (invoice subtotals, no GST), per provider and per business; a negative margin is flagged. Costs are recorded from 13 Nov 2026 on (`costs_recorded_since`)."""
    return _guard(lambda: _service(runtime).usage_summary(principal.token, start, end, limit))


@router.get("/usage/google", response_model=GoogleUsageOut)
def usage_google(principal: PrincipalDep, runtime: RuntimeDep) -> GoogleUsageOut:
    """One line per Google Maps SKU this month: requests used against the FREE monthly cap, the percentage, and a state (ok, warn at the alert percentage, over). The API stops asking Google at the cap."""
    return _guard(lambda: _service(runtime).usage_google(principal.token))


@router.get("/alerts", response_model=AlertsOut)
def alerts(principal: PrincipalDep, runtime: RuntimeDep, include_acknowledged: bool = False) -> AlertsOut:
    return _guard(lambda: _service(runtime).alerts(principal.token, include_acknowledged))


@router.post("/alerts/{alert_id}/ack", response_model=AlertAckOut)
def alert_ack(alert_id: uuid.UUID, principal: PrincipalDep, runtime: RuntimeDep) -> AlertAckOut:
    return _guard(lambda: _service(runtime).alert_ack(principal.token, alert_id))


@router.get("/audit", response_model=AuditOut)
def audit(principal: PrincipalDep, runtime: RuntimeDep, tenant_id: Annotated[uuid.UUID | None, Query()] = None, staff_id: Annotated[uuid.UUID | None, Query()] = None,
          limit: Annotated[int, Query(ge=1, le=100)] = 50, cursor: Annotated[str | None, Query(max_length=400)] = None) -> AuditOut:
    return _guard(lambda: _service(runtime).audit(principal.token, tenant_id, staff_id, limit, cursor))


# ------------------------------------------------------------------------------------------------ the shop owner's side
@tenant_router.get("", response_model=SupportAccessOut)
def support_get(ctx: Owner, runtime: RuntimeDep) -> SupportAccessOut:
    return _service(runtime).support_get(ctx.principal.token, ctx.tenant.id)


@tenant_router.put("", response_model=SupportAccessOut)
def support_set(body: SupportAccessIn, ctx: OwnerStrong, runtime: RuntimeDep) -> SupportAccessOut:
    return _service(runtime).support_set(ctx.principal.token, ctx.tenant.id, body.require_ok)


@tenant_router.post("/approve", response_model=SupportAccessOut)
def support_approve(ctx: OwnerStrong, runtime: RuntimeDep) -> SupportAccessOut:
    """Say yes to ONE support visit (valid 30 minutes). Needed only when 'Require my OK' is on."""
    return _service(runtime).support_approve(ctx.principal.token, ctx.tenant.id)


_ = Any
