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
from app.whatsapp import webhook
from app.whatsapp.models import AccountIn, TemplateIn, TemplateStatusIn
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


@router.post("/conversations/{lead_id}/read", status_code=204)
def mark_read(lead_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> None:
    _wa(runtime).repository.conversation_mark_read(ctx.principal.token, ctx.tenant.id, _id(lead_id))
