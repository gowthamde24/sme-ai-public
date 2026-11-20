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
import re
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.display_name import lead_title, real_name
from app.errors import ApiError, not_found
from app.integrations.ratelimit import SlidingWindow
from app.tenancy.models import Role
from app.whatsapp import first_templates, not_sent, webhook
from app.whatsapp.models import (
    AccountIn,
    ChatAssistantIn,
    ChatDoneIn,
    ConnectIn,
    TemplateIn,
    TemplateStatusIn,
)
from app.whatsapp.runtime import WhatsAppRuntime

logger = logging.getLogger("app.whatsapp.routes")

public_router = APIRouter(prefix="/v1/webhooks", tags=["whatsapp"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["whatsapp"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]   # sending words to Meta for review is outward-facing: the second factor (where the person turned it on) applies
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


def _launch_extras(version: str) -> dict[str, Any]:
    """The `extras` the browser gives FB.login, for the Embedded Signup version of the owner's configuration. v5: coexistence is ON by default, `sessionInfoVersion` is ignored, `version: "v5"` names it. v4: coexistence is
    an opt-in (`featureType`) and the session info is version 3."""
    if version == "v4":
        return {"setup": {}, "featureType": "whatsapp_business_app_onboarding", "sessionInfoVersion": "3"}
    return {"setup": {}, "version": "v5"}


@router.get("/whatsapp/connect/config")
def connect_config(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    """What the browser needs to open Meta's Embedded Signup: our public app id and the signup configuration id. `available` is false until both are set."""
    wa = _wa(runtime)
    missing = [name for name, ok in (("app_id", bool(wa.app_id)), ("config_id", bool(wa.config_id)), ("app_secret", wa.app_secret is not None), ("platform_token", wa.tokens.get("default") is not None), ("graph", wa.graph is not None)) if not ok]
    return {"available": not missing, "app_id": wa.app_id, "config_id": wa.config_id, "graph_version": wa.graph_version, "missing": missing, "onboarding_types": ["cloud_api", "coexistence"],
            "embedded_version": wa.embedded_version, "launch_extras": _launch_extras(wa.embedded_version)}


@router.post("/whatsapp/connect")
def connect_whatsapp(body: ConnectIn, ctx: OwnerStrong, runtime: RuntimeDep, background: BackgroundTasks) -> dict[str, Any]:
    """"Connect WhatsApp": the shop finished Meta's Embedded Signup and the browser sends us the account and the number. We (1) check that the signup (the `code`, required) was made in OUR app and shared THIS account, (2) check that our
    token can reach the number, (3) subscribe our app to the account's webhooks, (4) record the account for THIS business only and activate it. Nothing is recorded unless every step worked. Owner, second factor."""
    wa = _wa(runtime)
    token = wa.tokens.get("default")
    if wa.graph is None or token is None or wa.app_secret is None or not (wa.app_id and wa.config_id):
        raise ApiError(409, "whatsapp_not_configured", "Connecting WhatsApp is not available right now.")
    # the signup must be OURS and must have shared THIS account (18 Nov 2026): without the code, or with an account the signup did not share, anyone could claim a number our platform token happens to reach
    exchanged = wa.graph.exchange_code(wa.app_id, wa.app_secret, body.code)
    business_token = exchanged.body.get("access_token") if exchanged.ok else None
    if not isinstance(business_token, str) or not business_token:
        raise ApiError(409, "whatsapp_signup_invalid", "That sign-up could not be checked. Connect again.")
    inspected = wa.graph.debug_token(wa.app_id, wa.app_secret, business_token)
    data = inspected.body.get("data") if inspected.ok else None
    data = data if isinstance(data, dict) else {}
    scopes = data.get("granular_scopes")
    shared: set[str] = set()
    for sc in scopes if isinstance(scopes, list) else []:
        ids = sc.get("target_ids") if isinstance(sc, dict) and sc.get("scope") == "whatsapp_business_management" else None
        shared |= {str(t) for t in ids} if isinstance(ids, list) else set()
    # version 4 names the account `waba_id`, version 5 `messaging_account_ids`: the first one the signup really shared is the account
    waba = next((i for i in [*([body.waba_id] if body.waba_id else []), *(body.messaging_account_ids or [])] if i in shared), None)
    if data.get("is_valid") is not True or str(data.get("app_id")) != str(wa.app_id) or waba is None:
        raise ApiError(409, "whatsapp_signup_invalid", "That sign-up could not be checked. Connect again.")
    phone_number_id = body.phone_number_id
    if phone_number_id is None:   # version 5 may not name the number: take it when the account holds exactly one
        only = wa.graph.waba_phone_numbers(waba, token)
        if only is None or len(only) != 1:
            raise ApiError(409, "whatsapp_no_access", "We cannot tell which number you picked. Finish the sign-up in Meta's window and try again.")
        phone_number_id = next(iter(only))
    phone = wa.graph.phone_details(phone_number_id, token)
    if not phone.ok:
        raise ApiError(409, "whatsapp_no_access", "We cannot reach that number yet. Finish the sign-up in Meta's window and try again.")
    held = wa.graph.waba_phone_numbers(waba, token)   # the number must belong to the account that signup shared: the shared account proves nothing about ANOTHER business's number our platform token also reaches
    if held is None or phone_number_id not in held:
        raise ApiError(409, "whatsapp_no_access", "That number is not on the account you signed up with. Finish the sign-up in Meta's window and try again.")
    previous = wa.repository.account_get(ctx.principal.token, ctx.tenant.id)
    already_subscribed = bool(previous.get("configured")) and str(previous.get("waba_id")) == waba
    if not wa.graph.subscribe_app(waba, token).ok:
        raise ApiError(502, "whatsapp_connect_refused", "WhatsApp did not accept the connection. Try again in a minute.")
    display = phone.body.get("display_phone_number")
    try:
        saved = wa.repository.account_save(
            ctx.principal.token,
            ctx.tenant.id,
            {"p_waba_id": waba, "p_phone_number_id": phone_number_id, "p_display_phone": display[:24] if isinstance(display, str) and len(display) >= 5 else None, "p_coexistence": body.coexistence or body.is_on_biz_app is True, "p_token_ref": "default"},
        )
    except Exception:
        if not already_subscribed:   # a business that is already connected on this account keeps its live subscription
            wa.graph.unsubscribe_app(waba, token)   # subscribed but not recorded: take the subscription back (nothing stays half done)
        raise
    active = wa.repository.account_set_status(ctx.principal.token, ctx.tenant.id, "active")
    if wa.auto_templates:   # the owner's standing OK (19 Nov 2026): our templates go to THIS account for review as soon as it is connected, after the answer (a slow Meta never slows the connect)
        background.add_task(_templates_after_connect, wa, ctx)
    verified = phone.body.get("verified_name")
    return {"connected": True, "display_phone": saved.get("display_phone"), "verified_name": verified[:100] if isinstance(verified, str) else None, "status": active.get("status")}


AUTO_LANGUAGES = ("en", "te")   # only the languages a native reader has checked go to Meta by themselves; Hindi and Kannada wait for their review and the owner's own press


def _templates_after_connect(wa: Any, ctx: TenantContext) -> None:
    """After "Connect WhatsApp" worked: make the catalogue's drafts this workspace does not have yet and send EVERY draft of it to the connected account for review (the owner's standing OK, 19 Nov 2026: who pressed
    Connect and when is in the log line and in each template's own audit record). Nothing here can fail the connect: a stop is logged by its class only and the owner can press "Send drafts to WhatsApp for review"."""
    try:
        made = _seed_drafts(wa, ctx, AUTO_LANGUAGES)
        out = _submit_all_drafts(wa, ctx, AUTO_LANGUAGES)
        logger.info("whatsapp: after Connect, %d drafts made, %d templates sent for review, %d refused, %d renamed (by user %s, workspace %s)", made, out["submitted"], out["refused"], len(out["renamed"]), ctx.principal.user_id, ctx.tenant.id)
    except Exception as exc:  # noqa: BLE001 - only the class is logged; the owner presses the button himself
        logger.error("whatsapp: sending the templates after Connect stopped: %s", exc.__class__.__name__)


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


def refusal(result: Any) -> dict[str, Any]:
    """Why Meta did not take a template, in one closed word and one fixed sentence (Meta's own short text is kept beside it: it is about the template, never about a person)."""
    code, sub, status = result.error_code, result.error_subcode, result.status
    detail = result.detail or ""
    if sub == 2388024 or "already exist" in detail.lower() or "already has" in detail.lower():
        word, text = "name_exists", "WhatsApp already has a template with this name in this language. Give this one a new name; the old one stays as it is."
    elif status == 429 or code in (4, 17, 32, 613, 80008, 130429, 131056):
        word, text = "rate_limited", "WhatsApp is getting too many requests. Wait a few minutes and try again."
    elif code in (10, 190, 200, 102, 104) or status in (401, 403):
        word, text = "not_allowed", "The WhatsApp access of this business is not allowed to make templates. Check the connection."
    elif status == 0 or status >= 500:
        word, text = "unavailable", "WhatsApp did not answer. Try again in a minute."
    elif code == 100:
        word, text = "invalid_content", "WhatsApp did not accept the words or settings of this template."
    else:
        word, text = "refused", "WhatsApp did not accept this template."
    return {"code": word, "reason": text, "meta_code": code, "meta_subcode": sub, "meta_message": detail or None}


_SUFFIX = re.compile(r"_v\d{1,2}$")
MAX_RENAMES = 5   # _v2 .. _v6


def _to_meta(wa: Any, ctx: TenantContext, account: dict[str, Any], token: str, template: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Ask Meta to review one template: (None, renamed_to) when Meta took it, else (why it did not, None). Meta knows a template by its `meta_name` when it has one. When Meta says the name is TAKEN in that language
    the name gets the next suffix (_v2, _v3, ...) and is tried again (owner, 16 Nov 2026: not a manual database step); the name that was accepted is kept on the template and returned as `renamed_to`."""
    base = _SUFFIX.sub("", str(template.get("meta_name") or template["name"]))
    tried = str(template.get("meta_name") or template["name"])
    candidates = [tried] + [f"{base}_v{n}" for n in range(2, 2 + MAX_RENAMES) if f"{base}_v{n}" != tried and (n > 2 or tried == base)]
    last: dict[str, Any] | None = None
    for name in candidates:
        result = wa.graph.create_template(
            str(account["waba_id"]),
            token,
            {"name": name, "category": str(template["category"]).upper(), "language": template["language"], "components": first_templates.meta_components(template)},
        )
        if result.ok:
            renamed = name if name != (template.get("meta_name") or template["name"]) else None
            if name != template["name"] and name != template.get("meta_name"):
                wa.repository.template_save(
                    ctx.principal.token,
                    {"p_id": str(template["id"]), "p_tenant_id": str(ctx.tenant.id), "p_name": template["name"], "p_language": template["language"], "p_category": template["category"], "p_purpose": template["purpose"],
                     "p_body": template["body"], "p_meta_name": name, **({"p_opt_out_label": template["opt_out_label"]} if template.get("opt_out_label") else {})},
                )
            wa.repository.template_set_status(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(template["id"])), "submitted")
            return None, renamed
        last = refusal(result)
        if last["code"] != "name_exists":
            return last, None
    return {**(last or {"code": "name_exists", "reason": "", "meta_code": None, "meta_subcode": None, "meta_message": None}), "reason": (last or {}).get("reason", "") + f" Tried {candidates[0]} to {candidates[-1]}."}, None


def _seed_drafts(wa: Any, ctx: TenantContext, wanted: tuple[str, ...]) -> int:
    """Create the catalogue's drafts that this workspace does not have yet (any status counts as "has"); returns how many were made."""
    have = {(t["name"], t["language"]) for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}
    created = 0
    for d in first_templates.drafts(wanted):
        if (d["name"], d["language"]) in have:
            continue
        wa.repository.template_save(
            ctx.principal.token,
            {"p_id": str(first_templates.template_id(ctx.tenant.id, d["name"], d["language"])), "p_tenant_id": str(ctx.tenant.id), "p_name": d["name"], "p_language": d["language"],
             "p_category": d["category"], "p_purpose": d["purpose"], "p_body": d["body"], **({"p_opt_out_label": d["opt_out_label"]} if d["opt_out_label"] else {}), **({"p_meta_name": d["meta_name"]} if d["meta_name"] else {})},
        )
        created += 1
    return created


@router.post("/whatsapp/templates/first")
def seed_first_templates(ctx: OwnerAdmin, runtime: RuntimeDep, languages: Annotated[str, Query(pattern=r"^[a-z]{2}(,[a-z]{2}){0,3}$")] = "en,te,hi,kn") -> dict[str, Any]:
    """Create the first templates (visit reminder, visit confirmation, follow-up nudge, catalogue share, "we tried to call you") as DRAFTS in te / hi / kn / en for this workspace. Drafts only, nothing goes to Meta.
    Safe to repeat: a template that already exists (any status) is left as it is. The words are drafts for native review; the Owner can edit each before it is submitted."""
    wa = _wa(runtime)
    wanted = tuple(x for x in languages.split(",") if x in first_templates.LANGUAGES)
    created = _seed_drafts(wa, ctx, wanted)
    return {"created": created, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


def _submit_all_drafts(wa: Any, ctx: TenantContext, languages: tuple[str, ...] | None = None) -> dict[str, Any]:
    """Send every DRAFT template of this workspace (of these languages, when given) to Meta, one call each: how many Meta took, how many it refused, which were taken under a new name."""
    account, token = _meta_account(wa, ctx)
    sent = 0
    failed: list[dict[str, Any]] = []
    renamed: list[dict[str, Any]] = []   # templates Meta took under a new name because the name was taken
    for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id):
        if t.get("status") != "draft" or (languages is not None and t.get("language") not in languages):
            continue
        why, renamed_to = _to_meta(wa, ctx, account, token, t)
        if why is None:
            sent += 1
            if renamed_to is not None:
                renamed.append({"id": t["id"], "name": t["name"], "language": t["language"], "meta_name": renamed_to})
        else:
            failed.append({"id": t["id"], "name": t["name"], "language": t["language"], **why})
    return {"submitted": sent, "refused": len(failed), "failed": failed, "renamed": renamed, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


class ConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool = False


def _confirmed(wa: Any, ctx: TenantContext, body: ConfirmIn | None) -> None:
    """The step that stands in for the second factor (owner, 21 Nov 2026: the authenticator is optional). A person WHO HAS it already entered the code (the strong gate refused otherwise: this session is aal2);
    a person WITHOUT it must say `confirm: true` (the web's Confirm button) before words go to Meta. Off (CONFIRM_WITHOUT_AUTHENTICATOR) until the web sends it. The confirmed call is in the request log with the member's id (no content)."""
    if not getattr(wa, "confirm_step", False) or ctx.principal.aal == "aal2":
        return
    if body is None or not body.confirm:
        raise ApiError(422, "confirm_required", "Press Confirm to send this to WhatsApp for review.")
    logging.getLogger("app.whatsapp").info("template submit confirmed without authenticator tenant=%s member=%s", ctx.tenant.id, ctx.principal.user_id)


@router.post("/whatsapp/templates/submit-drafts")
def submit_drafts(ctx: OwnerAdminStrong, runtime: RuntimeDep, body: ConfirmIn | None = None) -> dict[str, Any]:
    """Send every DRAFT template of this workspace to Meta for review (one call each). Answers how many Meta took and how many it refused. Without the authenticator: `{"confirm": true}` (422 confirm_required)."""
    wa = _wa(runtime)
    _confirmed(wa, ctx, body)
    return _submit_all_drafts(wa, ctx)


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
        status = decided.get((t.get("meta_name") or t["name"], t["language"]))
        if status is not None and status != t.get("status") and t.get("status") != "draft":
            wa.repository.template_set_status(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(t["id"])), status)
            changed += 1
    return {"changed": changed, "templates": wa.repository.template_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/whatsapp/templates/{template_id}/submit")
def submit_template(template_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep, body: ConfirmIn | None = None) -> dict[str, Any]:
    """Ask Meta to review a draft template. On Meta's yes the template becomes `submitted`; Meta's decision is then set with /status (or read in WhatsApp Manager). Without the authenticator: `{"confirm": true}` (422 confirm_required)."""
    wa = _wa(runtime)
    _confirmed(wa, ctx, body)
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
    why, _renamed = _to_meta(wa, ctx, account, token, template)
    if why is not None:
        raise ApiError(502, "whatsapp_refused", why["reason"] + (f" (WhatsApp says: {why['meta_message']})" if why["meta_message"] else ""))
    return {"template": next(t for t in wa.repository.template_list(ctx.principal.token, ctx.tenant.id) if t.get("id") == str(parsed))}


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
    for item in items:   # a message that did not go says why and what to try next (owner, 16 Nov 2026)
        item["not_sent"] = not_sent.explain(item)
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
