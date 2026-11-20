"""The outbox and call requests under /v1/tenants/{tenant_id}/... (job AT, ADR 0066).

Authorization, in order, for every endpoint: a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403: a Viewer reads no message and no call
request; only Owner and Admin edit, approve, reject and dispatch; only the Owner changes the settings and decides a call); a second factor where the action needs one (403 mfa_required:
approving a message, the settings, deciding a call); then the database decides again (RLS, the policy, the blocks, the state machine).

There is NO field that names a phone number, a contact, a status, a reason or an approver: the contact is the lead's, the status and reason are the policy's, the approver is the person the
token proved. Nothing here dials a number. A message leaves only through the channel adapter, and the only adapter that exists is a local fake.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import service as catalogue_service
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.outbox import service
from app.outbox.errors import ComposerRefused, OutboxStateError
from app.outbox.models import (
    CallRequestOut,
    CallRequestPageOut,
    CallRequestResultOut,
    ConsentAskOut,
    ConsentAskSendIn,
    ConversationTemplatesOut,
    CreateCallRequestIn,
    DecideCallIn,
    DecisionOut,
    DispatchOut,
    EditMessageIn,
    EventOut,
    MarkSentIn,
    MarkSentOut,
    OutboxMessageOut,
    OutboxPageOut,
    OutboxSettingsIn,
    OutboxSettingsOut,
    OutboxSummaryOut,
    QueuedAttentionOut,
    QueuedCancelOut,
    QueuedGetOut,
    QueuedMessageIn,
    QueuedReplyOut,
    SubmitMessageIn,
    SubmitResultOut,
    TemplateSendIn,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["outbox"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
MessageStatus = Literal["queued", "needs_approval", "sent", "blocked", "failed"]
MessageTab = Literal["waiting", "scheduled", "sent", "blocked"]
CallStatus = Literal["requested", "approved", "rejected"]
Limit = Annotated[int, Query(ge=1, le=100)]


_NOT_APPROVED = ApiError(409, "not_approved", "A person has not approved this message, so it cannot be marked as sent.")
_ALREADY_SENT = ApiError(409, "already_sent", "This message was already sent.")
_BEING_SENT = ApiError(409, "being_sent", "This message is being handed over right now. Look again in a minute.")


def _repo(runtime: Runtime) -> Any:
    if runtime.outbox is None or runtime.outbox_adapter is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    return runtime.outbox


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _urls(runtime: Runtime, ctx: TenantContext, rows: list[dict[str, Any]]) -> dict[str, str]:
    """Signed thumbnail URLs for the photos the messages carry (one batch)."""
    return catalogue_service.sign_urls(
        runtime.catalogue_storage, ctx.principal.token, service.media_photos(rows), thumbs_only=True
    )


def _events(runtime: Runtime, ctx: TenantContext, message_id: uuid.UUID) -> list[EventOut]:
    """The steps of one message, in order, with the display name of each person (a name the database does not show the caller is simply left out)."""
    repository = _repo(runtime)
    rows = repository.list_events(ctx.principal.token, ctx.tenant.id, [message_id])
    people = sorted({str(r["actor_user_id"]) for r in rows if r.get("actor_user_id")})
    names = (
        repository.display_names(ctx.principal.token, [uuid.UUID(p) for p in people])
        if people
        else {}
    )
    return [service.event_out(r, names) for r in rows]


def _message(runtime: Runtime, ctx: TenantContext, message_id: uuid.UUID) -> OutboxMessageOut:
    """One message with its media and its events (the detail shape)."""
    row = _repo(runtime).get_message(ctx.principal.token, ctx.tenant.id, message_id)
    if row is None:
        raise not_found()
    return service.message_out(row, _urls(runtime, ctx, [row]), _events(runtime, ctx, message_id))


def _dispatch(runtime: Runtime, ctx: TenantContext) -> DispatchOut | None:
    """Owner and Admin hand due messages to the channel right after they act; anyone else leaves them for the next dispatch."""
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        return None
    repository = _repo(runtime)  # also proves the adapter exists
    adapter = runtime.outbox_adapter
    if adapter is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    return service.dispatch_due(
        repository,
        adapter,
        ctx.principal.token,
        ctx.tenant.id,
        sign_media=service.media_signer(runtime.catalogue_storage),
    )


# ------------------------------------------------------------------------------------------------ messages
@router.post("/outbox/messages", response_model=SubmitResultOut)
def submit_message(body: SubmitMessageIn, ctx: SalesPlus, runtime: RuntimeDep) -> SubmitResultOut:
    """Make one message and let the policy decide: queued (goes by itself), needs_approval (a person decides) or blocked. Retrying with the same message_id replays."""
    repository = _repo(runtime)
    result = repository.submit(
        ctx.principal.token,
        {
            "p_message_id": str(body.message_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_lead_id": str(body.lead_id),
            "p_channel": "whatsapp",
            "p_body": body.text,
            "p_language": body.language,
            "p_category": body.category,
            "p_source": body.source,
            "p_model_flagged": body.model_flagged,
            "p_uncertain": body.uncertain,
            "p_media": [str(p) for p in body.photo_ids],
            "p_keep_record": body.keep_record,
            "p_gloss_en": body.gloss_en,
        },
    )
    replayed = result.get("replayed") is True
    dispatched = None if replayed else _dispatch(runtime, ctx)
    return SubmitResultOut(
        message=_message(runtime, ctx, body.message_id), replayed=replayed, dispatched=dispatched
    )


@router.get("/conversations/{lead_id}/templates", response_model=ConversationTemplatesOut)
def conversation_templates(lead_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> ConversationTemplatesOut:
    """The APPROVED templates this chat may send now (the customer's language; a marketing template only to a customer who agreed to marketing), each with the words already filled in for this customer. Empty: none is approved."""
    rows = _repo(runtime).conversation_templates(ctx.principal.token, ctx.tenant.id, _row_id(lead_id))
    return ConversationTemplatesOut.model_validate({"items": rows})


@router.post("/conversations/{lead_id}/template", response_model=SubmitResultOut)
def send_conversation_template(lead_id: str, body: TemplateSendIn, ctx: SalesPlus, runtime: RuntimeDep) -> SubmitResultOut:
    """When the 24-hour window is closed only an approved template can go: the one picked is sent through the outbox (consent, STOP, quiet hours, the daily limit and the word check all apply). Same answer as a reply."""
    repository = _repo(runtime)
    message_id = body.message_id or uuid.uuid4()
    result = repository.template_send(
        ctx.principal.token,
        {"p_message_id": str(message_id), "p_tenant_id": str(ctx.tenant.id), "p_lead_id": str(_row_id(lead_id)), "p_template_id": str(body.template_id)},
    )
    replayed = result.get("replayed") is True
    dispatched = None if replayed else _dispatch(runtime, ctx)
    return SubmitResultOut(message=_message(runtime, ctx, message_id), replayed=replayed, dispatched=dispatched)


_COMPOSER_REFUSALS: dict[str, tuple[int, str, str]] = {
    "SM990": (409, "window_open", "The customer wrote in the last 24 hours: send your message directly."),
    "SM991": (409, "stopped_by_customer", "This customer asked us to stop. Nothing can be sent until they write again."),
    "SM992": (409, "consent_required", "This customer has not agreed to WhatsApp messages yet."),
    "SM993": (429, "daily_limit", "The daily limit for messages is reached. Try again tomorrow or call instead."),
    "SM994": (409, "no_whatsapp", "WhatsApp is not connected for this business."),
    "SM995": (409, "already_queued", "A message is already waiting for this customer's reply."),
    "SM996": (409, "not_waiting", "That message is no longer waiting."),
    "SM997": (409, "hello_not_approved", "The hello message is not approved by WhatsApp yet, so your message cannot wait. Call instead."),
    "SM998": (409, "marketing_blocked", "WhatsApp treats the hello as marketing and this customer has not agreed to marketing. Call instead."),
}


def _composer_call(call: Any) -> Any:
    """Run one composer repository call; a closed refusal becomes its fixed sentence (no text from the data layer)."""
    try:
        return call()
    except ComposerRefused as refused:
        status, code, message = _COMPOSER_REFUSALS[refused.code]
        raise ApiError(status, code, message) from None


@router.post("/conversations/{lead_id}/queued-message", response_model=QueuedReplyOut)
def queue_message(lead_id: str, body: QueuedMessageIn, ctx: SalesPlus, runtime: RuntimeDep) -> QueuedReplyOut:
    """The window is closed and the owner typed: the approved hello goes now (once in 24 h) and the text WAITS; the customer's reply releases it at once, at any hour. Refusals are closed words (409/429)."""
    row = _composer_call(
        lambda: _repo(runtime).queued_create(
            ctx.principal.token,
            {"p_tenant_id": str(ctx.tenant.id), "p_lead_id": str(_row_id(lead_id)), "p_text": body.text, "p_client_id": str(body.client_id)},
        )
    )
    return QueuedReplyOut.model_validate(row)


@router.get("/conversations/{lead_id}/queued-message", response_model=QueuedGetOut)
def get_queued_message(lead_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QueuedGetOut:
    """The open queued message of this chat, or the latest that ended in the last 7 days; `queued` is null when there is none."""
    return QueuedGetOut.model_validate(_repo(runtime).queued_get(ctx.principal.token, ctx.tenant.id, _row_id(lead_id)))


@router.post("/queued-messages/{queued_id}/cancel", response_model=QueuedCancelOut)
def cancel_queued_message(queued_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QueuedCancelOut:
    return QueuedCancelOut.model_validate(_composer_call(lambda: _repo(runtime).queued_cancel(ctx.principal.token, ctx.tenant.id, _row_id(queued_id))))


@router.get("/queued-messages/attention", response_model=QueuedAttentionOut)
def queued_messages_attention(ctx: SalesPlus, runtime: RuntimeDep) -> QueuedAttentionOut:
    """Messages that expired (7 days) or did not go (the customer stopped, a rule held it): for Needs you, each with "Call instead"."""
    return QueuedAttentionOut.model_validate({"items": _repo(runtime).queued_attention(ctx.principal.token, ctx.tenant.id)})


def _consent_ask(runtime: Runtime, ctx: TenantContext, lead_id: uuid.UUID, message_id: uuid.UUID) -> tuple[ConsentAskOut, dict[str, Any]]:
    """The draft: what the database knows about the lead's contact, and the words in the customer's language (the same words as the ask of a plan's left-out people)."""
    from app.opening.resolve import say_ai_setting
    from app.tasks import compose

    info = _repo(runtime).consent_ask_info(ctx.principal.token, ctx.tenant.id, lead_id)
    language = str(info.get("language") or "en")
    window_open = info.get("window_open") is True
    template_id = info.get("template_id")
    reason: str | None = None
    if info.get("whatsapp_consent") == "granted":
        reason = "already_agreed"
    elif info.get("stopped") is True:
        reason = "stopped"
    elif info.get("has_number") is not True:
        reason = "no_whatsapp_number"
    elif not window_open and not template_id:
        reason = "no_template"
    how = "none" if reason else ("message" if window_open else "template")
    out = ConsentAskOut.model_validate({
        "lead_id": lead_id, "customer": str(info.get("customer") or ""), "needed": reason in (None, "no_template"), "reason": reason, "language": language,
        "text": compose.consent_ask_text(language, ctx.tenant.name, say_ai_setting(runtime, ctx)), "how": how, "window_open": window_open, "message_id": message_id,
    })
    return out, info


@router.get("/leads/{lead_id}/consent-ask", response_model=ConsentAskOut)
def consent_ask_draft(lead_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> ConsentAskOut:
    """Ask for consent, step 1: the preview. Reads only: nothing is written and nothing is sent. `message_id` is the id to send back on the tap."""
    return _consent_ask(runtime, ctx, _row_id(lead_id), uuid.uuid4())[0]


@router.post("/leads/{lead_id}/consent-ask", response_model=SubmitResultOut)
def consent_ask_send(lead_id: str, body: ConsentAskSendIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> SubmitResultOut:
    """Ask for consent, step 2: the owner's tap on Send (the tap IS the approval; nothing here is ever automatic). Inside the 24-hour window the preview's words go as an owner message; outside it the approved
    `consent_ask` template goes (its own words). Either way it passes the outbox (consent rules, STOP, quiet hours, daily limit). 422 when no ask is needed, 409 `no_consent_template` when the window is closed and
    no template is approved."""
    lid = _row_id(lead_id)
    draft, info = _consent_ask(runtime, ctx, lid, body.message_id)
    if draft.reason in ("already_agreed", "stopped", "no_whatsapp_number"):
        raise ApiError(422, "consent_ask_not_needed", "There is no one to ask: they already agreed, stopped, or have no WhatsApp number.")
    repository = _repo(runtime)
    if draft.how == "template":
        result = repository.template_send(ctx.principal.token, {"p_message_id": str(body.message_id), "p_tenant_id": str(ctx.tenant.id), "p_lead_id": str(lid), "p_template_id": str(info["template_id"])})
    elif draft.how == "message":
        result = repository.submit(ctx.principal.token, {
            "p_message_id": str(body.message_id), "p_tenant_id": str(ctx.tenant.id), "p_lead_id": str(lid), "p_channel": "whatsapp", "p_body": draft.text, "p_language": draft.language,
            "p_category": "info", "p_source": "owner", "p_model_flagged": False, "p_uncertain": False,
        })
    else:
        raise ApiError(409, "no_consent_template", "WhatsApp only allows an approved template after 24 hours of silence from the customer, and the consent_ask template is not approved yet.")
    replayed = result.get("replayed") is True
    dispatched = None if replayed else _dispatch(runtime, ctx)
    return SubmitResultOut(message=_message(runtime, ctx, body.message_id), replayed=replayed, dispatched=dispatched)


@router.get("/outbox/messages", response_model=OutboxPageOut)
def list_messages(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    status: MessageStatus | None = None,
    lead_id: str | None = None,
    tab: MessageTab | None = None,
    customer: Annotated[str | None, Query(min_length=2, max_length=60)] = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    after: str | None = None,
    limit: Limit = 30,
) -> OutboxPageOut:
    """The outbox log, newest first. Either `status` (and `lead_id`), or the log's own filters: `tab` (waiting, scheduled, sent, blocked), `customer` (part of the company's or contact's name; never the
    words of a message) and `from` / `to` (India dates, both included). The two ways are not combined (422). Paged by the cursor in `next_cursor`."""
    filtered = (
        tab is not None or customer is not None or date_from is not None or date_to is not None
    )
    if filtered and (status is not None or lead_id is not None):
        raise ApiError(
            422, "validation_error", "Use either status / lead_id or tab / customer / from / to."
        )
    repository = _repo(runtime)
    if filtered:
        rows = repository.list_messages_filtered(
            ctx.principal.token,
            ctx.tenant.id,
            tab=tab,
            customer=customer,
            date_from=date_from,
            date_to=date_to,
            after=service.decode_cursor(after),
            limit=limit,
        )
    else:
        rows = repository.list_messages(
            ctx.principal.token,
            ctx.tenant.id,
            status=status,
            lead_id=_row_id(lead_id) if lead_id is not None else None,
            after=service.decode_cursor(after),
            limit=limit,
        )
    urls = _urls(runtime, ctx, rows)
    return OutboxPageOut(
        items=[service.message_out(r, urls) for r in rows],
        next_cursor=service.next_cursor(rows, limit),
    )


@router.get("/outbox/summary", response_model=OutboxSummaryOut)
def summary(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    customer: Annotated[str | None, Query(min_length=2, max_length=60)] = None,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> OutboxSummaryOut:
    """The counts behind the tabs (with the same `customer` and `from` / `to` filters as the log), and `due_now` / `held_for_later`: what Dispatch would act on, never filtered."""
    return OutboxSummaryOut.model_validate(
        _repo(runtime).summary(
            ctx.principal.token,
            ctx.tenant.id,
            customer=customer,
            date_from=date_from,
            date_to=date_to,
        )
    )


@router.get("/outbox/approvals", response_model=OutboxPageOut)
def list_approvals(
    ctx: OwnerAdmin, runtime: RuntimeDep, after: str | None = None, limit: Limit = 30
) -> OutboxPageOut:
    """The needs-approval queue, newest first (the same messages Today lists for the Owner and Admin)."""
    rows = _repo(runtime).list_messages(
        ctx.principal.token,
        ctx.tenant.id,
        status="needs_approval",
        lead_id=None,
        after=service.decode_cursor(after),
        limit=limit,
    )
    urls = _urls(runtime, ctx, rows)
    return OutboxPageOut(
        items=[service.message_out(r, urls) for r in rows],
        next_cursor=service.next_cursor(rows, limit),
    )


@router.get("/outbox/messages/{message_id}", response_model=OutboxMessageOut)
def get_message(message_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> OutboxMessageOut:
    return _message(runtime, ctx, _row_id(message_id))


@router.post("/outbox/messages/{message_id}/edit", response_model=OutboxMessageOut)
def edit_message(
    message_id: str, body: EditMessageIn, ctx: OwnerAdmin, runtime: RuntimeDep
) -> OutboxMessageOut:
    """Change the words (and, if given, the English gloss) of a message that waits for approval. It keeps waiting; the first-message disclosure line stays. Without `gloss_en` the old gloss is cleared."""
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).edit(ctx.principal.token, ctx.tenant.id, row_id, body.text, body.gloss_en)
    return _message(runtime, ctx, row_id)


@router.post("/outbox/messages/{message_id}/approve", response_model=DecisionOut)
def approve_message(message_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> DecisionOut:
    """A person approves: the message is queued (the blocks are checked again; the policy is NOT, a person decided) and, if due, handed to the channel."""
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide(ctx.principal.token, ctx.tenant.id, row_id, "approve")
    dispatched = _dispatch(runtime, ctx)
    return DecisionOut(message=_message(runtime, ctx, row_id), dispatched=dispatched)


@router.post("/outbox/messages/{message_id}/unsend", response_model=OutboxMessageOut)
def unsend_message(message_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> OutboxMessageOut:
    """Undo of "send it" (owner, 14 Nov 2026): within its short grace window, and only while nobody has taken the message to send, the Owner or an Admin cancels a message the assistant queued on the owner's own
    instruction. 409 `outbox_state` once it is on its way or sent."""
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).unsend_said(ctx.principal.token, ctx.tenant.id, row_id)
    return _message(runtime, ctx, row_id)


@router.post("/outbox/messages/{message_id}/reject", response_model=DecisionOut)
def reject_message(message_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> DecisionOut:
    row_id = _row_id(message_id)
    _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide(ctx.principal.token, ctx.tenant.id, row_id, "reject")
    return DecisionOut(message=_message(runtime, ctx, row_id), dispatched=None)


@router.post("/outbox/messages/{message_id}/mark-sent", response_model=MarkSentOut)
def mark_message_sent(
    message_id: str, ctx: OwnerAdmin, runtime: RuntimeDep, body: MarkSentIn | None = None
) -> MarkSentOut:
    """The owner sent an APPROVED message by hand from their own WhatsApp ("Open in WhatsApp", then "I sent it"). This system sends nothing: it records the owner's word, so the dispatcher never sends it
    again. Only a message that is approved and not yet sent (409 `not_approved`; 409 `already_sent` when the system sent it; 409 `being_sent` while a dispatch is handing it over); the same call again
    answers `replayed: true`. Off (404, as if the route did not exist) unless OUTBOX_WHATSAPP is on."""
    if not runtime.outbox_whatsapp:
        raise not_found()
    row_id = _row_id(message_id)
    before = _message(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    if before.status in ("needs_approval", "blocked", "failed"):
        raise _NOT_APPROVED
    try:
        result = _repo(runtime).mark_sent(ctx.principal.token, ctx.tenant.id, row_id)
    except OutboxStateError:
        now = _message(runtime, ctx, row_id).status
        raise (
            _ALREADY_SENT if now == "sent" else _BEING_SENT if now == "queued" else _NOT_APPROVED
        ) from None
    return MarkSentOut(message=_message(runtime, ctx, row_id), replayed=result.get("replayed") is True)


@router.post("/outbox/dispatch", response_model=DispatchOut)
def dispatch(ctx: OwnerAdmin, runtime: RuntimeDep) -> DispatchOut:
    """Hand this BUSINESS's due messages to the channel (the tenant is in the path; the database re-checks every block first; while the kill switch is off nothing goes), then say what is still
    waiting: `still_due` (due but not handed over: blocked at the re-check, or retried later), `held_for_later` (scheduled for the morning) and `platform_switch_on`."""
    result = _dispatch(runtime, ctx) or DispatchOut(sent=0, failed=0)
    repository = _repo(runtime)
    counts = repository.summary(
        ctx.principal.token, ctx.tenant.id, customer=None, date_from=None, date_to=None
    )
    settings = repository.get_settings(ctx.principal.token, ctx.tenant.id)
    return result.model_copy(
        update={
            "still_due": int(counts["due_now"]),
            "held_for_later": int(counts["held_for_later"]),
            "platform_switch_on": settings.get("platform_switch_on") is True,
        }
    )


# ------------------------------------------------------------------------------------------------ settings
@router.get("/outbox/settings", response_model=OutboxSettingsOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> OutboxSettingsOut:
    return OutboxSettingsOut.model_validate(
        _repo(runtime).get_settings(ctx.principal.token, ctx.tenant.id)
    )


@router.put("/outbox/settings", response_model=OutboxSettingsOut)
def put_settings(
    body: OutboxSettingsIn, ctx: OwnerStrong, runtime: RuntimeDep
) -> OutboxSettingsOut:
    """Automatic sending on or off (off by default), the per-customer daily limit and, optionally, the quiet hours (start 19 to 23, end 7 to 10, India time; a field left out keeps its value).
    Owner, with a second factor."""
    repository = _repo(runtime)
    repository.set_settings(
        ctx.principal.token,
        ctx.tenant.id,
        body.auto_send_enabled,
        body.per_customer_daily_limit,
        body.quiet_hours_start,
        body.quiet_hours_end,
    )
    return OutboxSettingsOut.model_validate(
        repository.get_settings(ctx.principal.token, ctx.tenant.id)
    )


# ------------------------------------------------------------------------------------------------ call requests (nothing dials)
def _call(runtime: Runtime, ctx: TenantContext, request_id: uuid.UUID) -> CallRequestOut:
    row = _repo(runtime).get_call(ctx.principal.token, ctx.tenant.id, request_id)
    if row is None:
        raise not_found()
    return service.call_out(row)


@router.post("/call-requests", response_model=CallRequestResultOut)
def create_call_request(
    body: CreateCallRequestIn, ctx: SalesPlus, runtime: RuntimeDep
) -> CallRequestResultOut:
    """Ask to phone a customer: a reason and a script draft. It is only a request until the Owner approves it; approving records the decision and dials nobody."""
    result = _repo(runtime).create_call(
        ctx.principal.token,
        {
            "p_request_id": str(body.request_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_lead_id": str(body.lead_id),
            "p_reason": body.reason,
            "p_script_draft": body.script_draft,
            "p_language": body.language,
        },
    )
    return CallRequestResultOut(
        request=_call(runtime, ctx, body.request_id), replayed=result.get("replayed") is True
    )


@router.get("/call-requests", response_model=CallRequestPageOut)
def list_call_requests(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    status: CallStatus | None = None,
    after: str | None = None,
    limit: Limit = 30,
) -> CallRequestPageOut:
    rows = _repo(runtime).list_calls(
        ctx.principal.token,
        ctx.tenant.id,
        status=status,
        after=service.decode_cursor(after),
        limit=limit,
    )
    return CallRequestPageOut(
        items=[service.call_out(r) for r in rows], next_cursor=service.next_cursor(rows, limit)
    )


@router.get("/call-requests/{request_id}", response_model=CallRequestOut)
def get_call_request(request_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> CallRequestOut:
    return _call(runtime, ctx, _row_id(request_id))


@router.post("/call-requests/{request_id}/approve", response_model=CallRequestOut)
def approve_call_request(
    request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, body: DecideCallIn | None = None
) -> CallRequestOut:
    """Only the Owner, with a second factor. The approval is recorded (who, when, the note); no call is made."""
    row_id = _row_id(request_id)
    _call(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide_call(
        ctx.principal.token, ctx.tenant.id, row_id, "approve", body.note if body else None
    )
    return _call(runtime, ctx, row_id)


@router.post("/call-requests/{request_id}/reject", response_model=CallRequestOut)
def reject_call_request(
    request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, body: DecideCallIn | None = None
) -> CallRequestOut:
    row_id = _row_id(request_id)
    _call(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    _repo(runtime).decide_call(
        ctx.principal.token, ctx.tenant.id, row_id, "reject", body.note if body else None
    )
    return _call(runtime, ctx, row_id)
