"""WhatsApp under /v1 (job BR, ADR 0076).

  PUBLIC (Meta calls these; no sign-in)
    GET  /v1/webhooks/whatsapp     the verification handshake: hub.mode, hub.verify_token, hub.challenge -> 200 with the challenge
    POST /v1/webhooks/whatsapp     a notification; X-Hub-Signature-256 must match the app secret -> 200 {"received": n, ...counts}

  A BUSINESS
    GET  /v1/tenants/{t}/whatsapp/account                        Owner/Admin     -> {configured, status, waba_id, phone_number_id, display_phone, coexistence, token_ref, token_available}
    PUT  /v1/tenants/{t}/whatsapp/account                        Owner + 2FA     {waba_id, phone_number_id, display_phone?, coexistence, token_ref}   (what Embedded Signup returns)
    POST /v1/tenants/{t}/whatsapp/account/activate | disable     Owner + 2FA
    GET  /v1/tenants/{t}/whatsapp/templates                      Owner/Admin
    PUT  /v1/tenants/{t}/whatsapp/templates/{id}                 Owner/Admin    {name, language, category, purpose, body}  (a draft; editing resets to draft)
    POST /v1/tenants/{t}/whatsapp/templates/{id}/status          Owner/Admin    {status}   what Meta decided (or "submitted")
    POST /v1/tenants/{t}/whatsapp/templates/{id}/submit          Owner/Admin    ask Meta to review it (needs the token)
    GET  /v1/tenants/{t}/conversations?limit=&before=            Owner/Admin/Sales  the chat inbox
    GET  /v1/tenants/{t}/conversations/{lead_id}?limit=&before=  the thread
    POST /v1/tenants/{t}/conversations/{lead_id}/read            mark it read
  A REPLY is the existing POST /v1/tenants/{t}/outbox/messages with category "reply_to_inbound" (the policy, the approval and the blocks are the outbox's).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.display_name import lead_title, real_name
from app.errors import ApiError, not_found
from app.integrations.ratelimit import SlidingWindow
from app.tenancy.models import Role
from app.whatsapp import first_templates, webhook
from app.whatsapp.models import AccountIn, ChatAssistantIn, ChatDoneIn, TemplateIn, TemplateStatusIn
from app.whatsapp.models import AccountIn, ConnectIn, TemplateIn, TemplateStatusIn
from app.whatsapp.runtime import WhatsAppRuntime

logger = logging.getLogger("app.whatsapp.routes")

public_router = APIRouter(prefix="/v1/webhooks", tags=["whatsapp"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["whatsapp"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]

# the webhook is public: a generous allowance for Meta (it may batch and retry), a stingy one for anything that fails the signature
PER_ADDRESS = SlidingWindow(1200, 60)
BAD_PER_ADDRESS = SlidingWindow(20, 60)


def _wa(runtime: Runtime) -> WhatsAppRuntime:
    if runtime.whatsapp is None:
        raise ApiError(503, "whatsapp_unavailable", "WhatsApp is not available on this system.")
    return runtime.whatsapp


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ------------------------------------------------------------------------------------------------ the webhook
@public_router.get("/whatsapp", response_class=PlainTextResponse)
def verify(
    runtime: RuntimeDep,
    request: Request,
    mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    wa = runtime.whatsapp
    if wa is None or not wa.verify_token:
        raise ApiError(503, "whatsapp_unavailable", "WhatsApp is not available on this system.")
    if not BAD_PER_ADDRESS.allow("verify:" + _address(request)):
        raise ApiError(429, "rate_limited", "Too many requests.")
    answer = webhook.verify_challenge(mode, token, challenge, wa.verify_token)
    if answer is None:
        raise ApiError(403, "forbidden", "Not allowed.")
    return PlainTextResponse(answer)


@public_router.post("/whatsapp")
async def receive(request: Request, runtime: RuntimeDep) -> JSONResponse:
    wa = runtime.whatsapp
    if wa is None or not wa.app_secret or wa.ingest is None:
        raise ApiError(503, "whatsapp_unavailable", "WhatsApp is not available on this system.")
    address = _address(request)
    if not PER_ADDRESS.allow(address):
        raise ApiError(429, "rate_limited", "Too many requests.")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > webhook.MAX_BODY_BYTES:
        raise ApiError(413, "payload_too_large", "Too large.")
    body = await request.body()
    if len(body) > webhook.MAX_BODY_BYTES:
        raise ApiError(413, "payload_too_large", "Too large.")
    if not webhook.signature_ok(body, request.headers.get("x-hub-signature-256"), wa.app_secret):
        if not BAD_PER_ADDRESS.allow("post:" + address):
            raise ApiError(429, "rate_limited", "Too many requests.")
        logger.warning("whatsapp webhook: bad signature")
        raise ApiError(401, "unauthorized", "Invalid or missing credentials.")
    try:
        import json

        payload = json.loads(body)
    except ValueError:
        raise ApiError(400, "bad_request", "Not valid JSON.") from None
    events = webhook.parse(payload)
    result = await run_in_threadpool(wa.ingest.handle, events)
    return JSONResponse(
        {"received": len(events), "stored": result.stored, "optouts": result.optouts, "statuses": result.statuses, "duplicates": result.duplicates, "ignored": result.ignored}
    )


# ------------------------------------------------------------------------------------------------ the account
@router.get("/whatsapp/account")
def get_account(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    wa = _wa(runtime)
    account = wa.repository.account_get(ctx.principal.token, ctx.tenant.id)
    if account.get("configured"):
        account["token_available"] = wa.tokens.get(str(account.get("token_ref"))) is not None
    return account


@router.put("/whatsapp/account")
def save_account(body: AccountIn, ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    wa = _wa(runtime)
    saved = wa.repository.account_save(
        ctx.principal.token,
        ctx.tenant.id,
        {
            "p_waba_id": body.waba_id,
            "p_phone_number_id": body.phone_number_id,
            "p_display_phone": body.display_phone,
            "p_coexistence": body.coexistence,
            "p_token_ref": body.token_ref,
        },
    )
    saved["token_available"] = wa.tokens.get(body.token_ref) is not None
    return saved


@router.get("/whatsapp/connect/config")
def connect_config(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """What the browser needs to open Meta's Embedded Signup: our public app id and the signup configuration id. `available` is false until both are set."""
    wa = _wa(runtime)
    return {"available": bool(wa.app_id and wa.config_id and wa.graph is not None), "app_id": wa.app_id, "config_id": wa.config_id, "graph_version": wa.graph_version}


@router.post("/whatsapp/connect")
def connect_whatsapp(body: ConnectIn, ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    """"Connect WhatsApp": the shop finished Meta's Embedded Signup and the browser sends us the account and the number. We (1) check, when a `code` came with it, that the signup was made in OUR app, (2) check that our
    token can reach the number, (3) subscribe our app to the account's webhooks, (4) record the account for THIS business only and activate it. Nothing is recorded unless every step worked. Owner, second factor."""
    wa = _wa(runtime)
    token = wa.tokens.get("default")
    if wa.graph is None or token is None or not (wa.app_id and wa.config_id):
        raise ApiError(409, "whatsapp_not_configured", "Connecting WhatsApp is not available right now.")
    if body.code is not None:
        if wa.app_secret is None or not wa.graph.exchange_code(wa.app_id, wa.app_secret, body.code).ok:
            raise ApiError(409, "whatsapp_signup_invalid", "That sign-up could not be checked. Connect again.")
    phone = wa.graph.phone_details(body.phone_number_id, token)
    if not phone.ok:
        raise ApiError(409, "whatsapp_no_access", "We cannot reach that number yet. Finish the sign-up in Meta's window and try again.")
    if not wa.graph.subscribe_app(body.waba_id, token).ok:
        raise ApiError(502, "whatsapp_connect_refused", "WhatsApp did not accept the connection. Try again in a minute.")
    display = phone.body.get("display_phone_number")
    saved = wa.repository.account_save(
        ctx.principal.token,
        ctx.tenant.id,
        {"p_waba_id": body.waba_id, "p_phone_number_id": body.phone_number_id, "p_display_phone": display[:24] if isinstance(display, str) and len(display) >= 5 else None, "p_coexistence": False, "p_token_ref": "default"},
    )
    active = wa.repository.account_set_status(ctx.principal.token, ctx.tenant.id, "active")
    verified = phone.body.get("verified_name")
    return {"connected": True, "display_phone": saved.get("display_phone"), "verified_name": verified[:100] if isinstance(verified, str) else None, "status": active.get("status")}


@router.post("/whatsapp/disconnect")
def disconnect_whatsapp(ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    """Stop: the account is disabled first (nothing more is sent), then our app is unsubscribed from its webhooks (best effort)."""
    wa = _wa(runtime)
    account = wa.repository.account_get(ctx.principal.token, ctx.tenant.id)
    done = wa.repository.account_set_status(ctx.principal.token, ctx.tenant.id, "disabled")
    token = wa.tokens.get(str(account.get("token_ref"))) if account.get("configured") else None
    if wa.graph is not None and token is not None and account.get("waba_id"):
        wa.graph.unsubscribe_app(str(account["waba_id"]), token)
    return {"connected": False, "status": done.get("status")}


@router.post("/whatsapp/account/activate")
def activate(ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _wa(runtime).repository.account_set_status(ctx.principal.token, ctx.tenant.id, "active")


@router.post("/whatsapp/account/disable")
def disable(ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _wa(runtime).repository.account_set_status(ctx.principal.token, ctx.tenant.id, "disabled")


# ------------------------------------------------------------------------------------------------ templates
@router.get("/whatsapp/templates")
def list_templates(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return {"templates": _wa(runtime).repository.template_list(ctx.principal.token, ctx.tenant.id)}


@router.put("/whatsapp/templates/{template_id}")
def save_template(template_id: str, body: TemplateIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    saved = _wa(runtime).repository.template_save(
        ctx.principal.token,
        {
            "p_id": str(_id(template_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_name": body.name,
            "p_language": body.language,
            "p_category": body.category,
            "p_purpose": body.purpose,
            "p_body": body.body,
        },
    )
    return {"template": saved}


@router.post("/whatsapp/templates/{template_id}/status")
def set_template_status(template_id: str, body: TemplateStatusIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return {"template": _wa(runtime).repository.template_set_status(ctx.principal.token, ctx.tenant.id, _id(template_id), body.status)}


def _meta_account(wa: Any, ctx: TenantContext) -> tuple[dict[str, Any], str]:
    account = wa.repository.account_get(ctx.principal.token, ctx.tenant.id)
    if not account.get("configured") or wa.graph is None:
        raise ApiError(409, "whatsapp_not_configured", "Set up the WhatsApp number and its token first.")
    token = wa.tokens.get(str(account["token_ref"]))
    if token is None:
        raise ApiError(409, "whatsapp_not_configured", "Set up the WhatsApp number and its token first.")
    return account, token


def _to_meta(wa: Any, ctx: TenantContext, account: dict[str, Any], token: str, template: dict[str, Any]) -> bool:
    result = wa.graph.create_template(
        str(account["waba_id"]),
        token,
        {
            "name": template["name"],
            "category": str(template["category"]).upper(),
            "language": template["language"],
            "components": [{"type": "BODY", "text": template["body"], "example": {"body_text": [["a sample message"]]}}],
        },
    )
    if result.ok:
        wa.repository.template_set_status(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(template["id"])), "submitted")
    return bool(result.ok)


@router.post("/whatsapp/templates/first")
def seed_first_templates(ctx: OwnerAdmin, runtime: RuntimeDep, languages: Annotated[str, Query(pattern=r"^[a-z]{2}(,[a-z]{2}){0,3}$")] = "en,te,hi,kn") -> dict[str, Any]:
    """Create the first templates (visit reminder, visit confirmation, follow-up nudge, catalogue share, "we tried to call you") as DRAFTS in te / hi / kn / en for this workspace. Drafts only, nothing goes to Meta.
    Safe to repeat: a template that already exists (any status) is left as it is. The words are drafts for native review; the Owner can edit each before it is submitted."""
    wa = _wa(runtime)
    wanted = tuple(x for x in languages.split(",") if x in first_templates.LANGUAGES)
    have = {(t["name"], t["language"]) for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}
    created = 0
    for d in first_templates.drafts(wanted):
        if (d["name"], d["language"]) in have:
            continue
        wa.repository.template_save(
            ctx.principal.token,
            {"p_id": str(first_templates.template_id(ctx.tenant.id, d["name"], d["language"])), "p_tenant_id": str(ctx.tenant.id), "p_name": d["name"], "p_language": d["language"],
             "p_category": d["category"], "p_purpose": d["purpose"], "p_body": d["body"]},
        )
        created += 1
    return {"created": created, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/whatsapp/templates/submit-drafts")
def submit_drafts(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Send every DRAFT template of this workspace to Meta for review (one call each). Answers how many Meta took and how many it refused."""
    wa = _wa(runtime)
    account, token = _meta_account(wa, ctx)
    sent = refused = 0
    for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id):
        if t.get("status") != "draft":
            continue
        if _to_meta(wa, ctx, account, token, t):
            sent += 1
        else:
            refused += 1
    return {"submitted": sent, "refused": refused, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/whatsapp/templates/sync")
def sync_template_status(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Read Meta's decision on every template of the account and record it (approved, rejected, paused, disabled, still in review). Meta's own word wins. 502 when Meta does not answer: nothing changes."""
    wa = _wa(runtime)
    account, token = _meta_account(wa, ctx)
    theirs = wa.graph.list_templates(str(account["waba_id"]), token) if wa.graph is not None else None
    if theirs is None:
        raise ApiError(502, "whatsapp_unavailable", "WhatsApp did not answer. Try again in a minute.")
    decided = {(t["name"], str(t["language"])[:2]): first_templates.META_STATUS.get(str(t["status"]).upper()) for t in theirs}
    changed = 0
    for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id):
        status = decided.get((t["name"], t["language"]))
        if status is not None and status != t.get("status") and t.get("status") != "draft":
            wa.repository.template_set_status(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(t["id"])), status)
            changed += 1
    return {"changed": changed, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/whatsapp/templates/{template_id}/submit")
def submit_template(template_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """Ask Meta to review a draft template. On Meta's yes the template becomes `submitted`; Meta's decision is then set with /status (or read in WhatsApp Manager)."""
    wa = _wa(runtime)
    parsed = _id(template_id)
    templates = wa.repository.template_list(ctx.principal.token, ctx.tenant.id)
    template = next((t for t in templates if t.get("id") == str(parsed)), None)
    if template is None:
        raise not_found()
    account = wa.repository.account_get(ctx.principal.token, ctx.tenant.id)
    if not account.get("configured") or wa.graph is None:
        raise ApiError(409, "whatsapp_not_configured", "Set up the WhatsApp number and its token first.")
    token = wa.tokens.get(str(account["token_ref"]))
    if token is None:
        raise ApiError(409, "whatsapp_not_configured", "Set up the WhatsApp number and its token first.")
    if template.get("status") != "draft":
        raise ApiError(409, "whatsapp_template_state", "Only a draft goes to Meta for review.")
    result = wa.graph.create_template(
        str(account["waba_id"]),
        token,
        {
            "name": template["name"],
            "category": str(template["category"]).upper(),
            "language": template["language"],
            "components": [{"type": "BODY", "text": template["body"], "example": {"body_text": [["a sample message"]]}}],
        },
    )
    if not result.ok:
        raise ApiError(502, "whatsapp_refused", "WhatsApp did not accept the template. Check its words and try again.")
    return {"template": wa.repository.template_set_status(ctx.principal.token, ctx.tenant.id, parsed, "submitted")}


# ------------------------------------------------------------------------------------------------ conversations
def _named(row: dict[str, Any]) -> dict[str, Any]:
    """`display_name`: the customer's name, else their number, else "New enquiry". The company of a customer who gave no name is an id ("WhatsApp customer 84407a"): it is never shown."""
    out = dict(row)
    out["display_name"] = lead_title(row.get("name"), row.get("phone"))
    if "company" in out:
        out["company"] = real_name(out["company"])
    return out


@router.get("/conversations")
def list_conversations(ctx: SalesPlus, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 50, before: datetime | None = None) -> dict[str, Any]:
    rows = [_named(r) for r in _wa(runtime).repository.conversation_list(ctx.principal.token, ctx.tenant.id, limit, before)]
    return {"conversations": rows, "next_before": rows[-1]["last_at"] if len(rows) == limit else None}


@router.get("/conversations/{lead_id}")
def get_conversation(lead_id: str, ctx: SalesPlus, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 50, before: datetime | None = None) -> dict[str, Any]:
    thread = _wa(runtime).repository.conversation_thread(ctx.principal.token, ctx.tenant.id, _id(lead_id), limit, before)
    thread = _named(thread)
    items = thread.get("items") or []
    thread["next_before"] = items[-1]["at"] if len(items) == limit else None
    return thread


@router.post("/conversations/{lead_id}/assistant")
def set_chat_assistant(lead_id: str, body: ChatAssistantIn, ctx: SalesPlus, runtime: RuntimeDep) -> dict[str, Any]:
    """The assistant on or off for ONE chat (Owner, Admin, Sales). Off: it does not answer this customer's messages on its own and a person does; the inbox says `handled_by: needs_you` while the customer waits."""
    return dict(_wa(runtime).repository.conversation_set_assistant(ctx.principal.token, ctx.tenant.id, _id(lead_id), body.enabled))


@router.post("/conversations/{lead_id}/done")
def set_chat_done(lead_id: str, body: ChatDoneIn, ctx: SalesPlus, runtime: RuntimeDep) -> dict[str, Any]:
    """Mark a chat done (`handled_by: done` until something newer happens) or open it again."""
    return dict(_wa(runtime).repository.conversation_set_done(ctx.principal.token, ctx.tenant.id, _id(lead_id), body.done))


@router.post("/conversations/{lead_id}/read", status_code=204)
def mark_read(lead_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> None:
    _wa(runtime).repository.conversation_mark_read(ctx.principal.token, ctx.tenant.id, _id(lead_id))
