"""Lead imports, live sources and the history of a lead (job DR / A2). The contract is docs/contracts/lead-sources.md.

  POST /tenants/{t}/lead-imports/read|preview     Owner, Admin, Sales   what is in a file / sheet / pasted list / vCard; counts and an estimate (nothing is written)
  POST /tenants/{t}/lead-imports                  Owner, Admin, Sales   import (idempotent on import_id)
  GET  /tenants/{t}/lead-imports[/{id}]           Owner, Admin, Sales   the history of imports
  GET|POST /tenants/{t}/lead-sheet-links[...]     Owner, Admin          a Google Sheet kept in sync
  GET|POST /tenants/{t}/lead-sources[...]         Owner, Admin          live sources: website form, webhook, e-mail forwarding, Meta, IndiaMART
  GET  /tenants/{t}/leads/{lead}/touches          Owner, Admin, Sales   every time the same person arrived
  POST /v1/lead-intake/{token}[/email] | /mail | GET|POST /meta/{token}     NO sign-in: the secret address is the credential (the worker account passes it to the database)

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import html
import json
import re
import uuid
from datetime import datetime
from typing import Annotated, Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, Depends, Header, Query, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

from app.assistant.routes import _refusal
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.hardening.replay import ReplayGuard
from app.lead_sources import mime
from app.lead_sources.columns_ai import RunColumnMatcher
from app.lead_sources.models import (
    CardsOut,
    EmailAddressOut,
    ImportIn,
    ImportOut,
    ImportsOut,
    IndiaMartPullOut,
    MailIn,
    MailOut,
    PreviewIn,
    PreviewOut,
    ReadIn,
    ReadOut,
    ReceivedOut,
    SheetAccessOut,
    SheetLinkIn,
    SheetLinkOut,
    SheetLinksOut,
    SourceCreate,
    SourceOut,
    SourcesOut,
    SourceWithSecretOut,
    TouchesOut,
    UnparsedListOut,
    WebsiteOut,
)
from app.lead_sources.service import LeadSourcesService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["lead-sources"])
_TOKEN_SHAPE = re.compile(r"^[A-Za-z0-9_-]{24,64}$")
public_router = APIRouter(prefix="/v1/lead-intake", tags=["lead-intake"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Importer = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
MAX_BODY = 262_144


def _service(runtime: Runtime) -> LeadSourcesService:
    if runtime.lead_sources is None:
        raise ApiError(503, "lead_sources_unavailable", "This is not available right now.")
    service = runtime.lead_sources
    if service.billing is None:
        service.billing = runtime.billing   # plan prices for the estimate
    return service


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


# ------------------------------------------------------------------------------------------------------------------ imports
@router.post("/lead-imports/read", response_model=ReadOut)
def read_import(body: ReadIn, ctx: Importer, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    matcher = service.matcher or RunColumnMatcher(runtime, _refusal)
    return service.read(ctx.principal.token, ctx.tenant.id, body, matcher)


@router.post("/lead-imports/preview", response_model=PreviewOut)
def preview_import(body: PreviewIn, ctx: Importer, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).preview(ctx.principal.token, ctx.tenant.id, body)


@router.post("/lead-imports", response_model=ImportOut, status_code=201)
def import_leads(body: ImportIn, response: Response, ctx: Importer, runtime: RuntimeDep) -> dict[str, Any]:
    out, replayed = _service(runtime).commit(ctx.principal.token, ctx.tenant.id, body)
    if replayed:
        response.status_code = 200
    return out


@router.get("/lead-imports", response_model=ImportsOut)
def list_imports(ctx: Importer, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 25, cursor: Annotated[str | None, Query(max_length=40)] = None) -> dict[str, Any]:
    before = None
    if cursor:
        try:
            before = datetime.fromisoformat(cursor)
        except ValueError:
            raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["cursor"]}) from None
    items = _service(runtime).imports(ctx.principal.token, ctx.tenant.id, limit, before)
    return {"items": items, "next_cursor": str(items[-1]["created_at"]) if len(items) == limit else None}


@router.get("/lead-imports/{import_id}")
def get_import(import_id: str, ctx: Importer, runtime: RuntimeDep) -> dict[str, Any]:
    wanted = _id(import_id)
    for item in _service(runtime).imports(ctx.principal.token, ctx.tenant.id, 100, None):
        if str(item.get("import_id")) == str(wanted):
            return item
    raise not_found()


# ------------------------------------------------------------------------------------------------------------------ Google Sheets kept in sync
@router.get("/lead-sheet-links/access", response_model=SheetAccessOut)
def sheet_access(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).sheet_access()


@router.get("/lead-sheet-links", response_model=SheetLinksOut)
def list_sheet_links(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _service(runtime).sheet_links(ctx.principal.token, ctx.tenant.id)}


@router.post("/lead-sheet-links", response_model=SheetLinkOut, status_code=201)
def create_sheet_link(body: SheetLinkIn, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).sheet_link_create(ctx.principal.token, ctx.tenant.id, body)


@router.post("/lead-sheet-links/{link_id}/sync", status_code=202)
def sync_sheet_link(link_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    item = _service(runtime).sheet_link_action(ctx.principal.token, ctx.tenant.id, _id(link_id), "sync_now")
    return {"status": "queued", "link": item}


@router.post("/lead-sheet-links/{link_id}/pause", response_model=SheetLinkOut)
def pause_sheet_link(link_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).sheet_link_action(ctx.principal.token, ctx.tenant.id, _id(link_id), "pause")


@router.post("/lead-sheet-links/{link_id}/resume", response_model=SheetLinkOut)
def resume_sheet_link(link_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).sheet_link_action(ctx.principal.token, ctx.tenant.id, _id(link_id), "resume")


# ------------------------------------------------------------------------------------------------------------------ live sources
@router.get("/lead-sources", response_model=SourcesOut)
def list_sources(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _service(runtime).sources(ctx.principal.token, ctx.tenant.id)}


@router.post("/lead-sources", response_model=SourceWithSecretOut, status_code=201, response_model_exclude_none=False)
def create_source(body: SourceCreate, response: Response, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    out, created = _service(runtime).source_create(ctx.principal.token, ctx.tenant.id, body)
    if not created:
        response.status_code = 200
    return out


@router.get("/lead-sources/cards", response_model=CardsOut)
def cards(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    """The Sources page: seven big cards, each with ONE action and a live status in plain words (always in the same order)."""
    return {"items": _service(runtime).cards(ctx.principal.token, ctx.tenant.id)}


@router.get("/lead-sources/email-address", response_model=EmailAddressOut)
def email_address(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).email_address(ctx.principal.token, ctx.tenant.id)


@router.post("/lead-sources/email-address/rotate", response_model=EmailAddressOut)
def email_address_rotate(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    """A new address; the old one stops working at once."""
    return _service(runtime).email_address(ctx.principal.token, ctx.tenant.id, rotate=True)


@router.get("/lead-sources/website", response_model=WebsiteOut)
def website(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).website(ctx.principal.token, ctx.tenant.id)


@router.post("/lead-sources/website/rotate", response_model=WebsiteOut)
def website_rotate(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    """A new form address; the old one stops working at once."""
    return _service(runtime).website(ctx.principal.token, ctx.tenant.id, rotate=True)


@router.get("/lead-sources/unparsed", response_model=UnparsedListOut)
def list_unparsed(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return {"items": _service(runtime).unparsed(ctx.principal.token, ctx.tenant.id)}


@router.post("/lead-sources/unparsed/{item_id}/discard")
def discard_unparsed(item_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    _service(runtime).repo.unparsed_discard(ctx.principal.token, ctx.tenant.id, _id(item_id))
    return {"discarded": True}


@router.post("/lead-sources/indiamart/pull", response_model=IndiaMartPullOut)
def pull_indiamart(ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    from app.lead_sources.indiamart import pull

    return pull(runtime, _service(runtime), ctx)


@router.post("/lead-sources/{source_id}/rotate", response_model=SourceWithSecretOut)
def rotate_source(source_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).source_rotate(ctx.principal.token, ctx.tenant.id, _id(source_id))


@router.post("/lead-sources/{source_id}/pause", response_model=SourceOut)
def pause_source(source_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).source_status(ctx.principal.token, ctx.tenant.id, _id(source_id), "paused")


@router.post("/lead-sources/{source_id}/resume", response_model=SourceOut)
def resume_source(source_id: str, ctx: Manager, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).source_status(ctx.principal.token, ctx.tenant.id, _id(source_id), "active")


# ------------------------------------------------------------------------------------------------------------------ the history of a lead
@router.get("/leads/{lead_id}/touches", response_model=TouchesOut)
def lead_touches(lead_id: str, ctx: Importer, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).arrivals(ctx.principal.token, ctx.tenant.id, _id(lead_id))


# ------------------------------------------------------------------------------------------------------------------ the public doors
REPLAY = ReplayGuard()


def _no_replay(request: Request) -> None:
    """A sender that signs its call (X-Stack19-Timestamp and X-Stack19-Nonce) is protected against replay; one that does not is accepted as before (see app/hardening/replay.py)."""
    refused = REPLAY.check(request.headers.get("x-stack19-timestamp"), request.headers.get("x-stack19-nonce"))
    if refused == "bad_headers":
        raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["headers"]})
    if refused is not None:
        raise ApiError(409, "replay", "This call was already received or is too old.", extra={"reason": refused})


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY:
        raise ApiError(413, "too_large", "Too large.")
    data = await request.body()
    if len(data) > MAX_BODY:
        raise ApiError(413, "too_large", "Too large.")
    return data


def _form_data(request: Request, raw: bytes) -> dict[str, Any]:
    kind = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if kind == "application/json":
        try:
            parsed = json.loads(raw or b"null")
        except ValueError:
            raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]}) from None
        if not isinstance(parsed, dict):
            raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]})
        return parsed
    if kind in ("application/x-www-form-urlencoded", ""):
        try:
            return dict(parse_qsl(raw.decode("utf-8"), keep_blank_values=False, max_num_fields=60))
        except (UnicodeDecodeError, ValueError):
            raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]}) from None
    raise ApiError(415, "unsupported_type", "That kind of body is not accepted.")


@public_router.post("/mail", response_model=MailOut, status_code=202)
async def intake_mail_global(
    request: Request,
    runtime: RuntimeDep,
    x_inbound_secret: Annotated[str | None, Header()] = None,
    x_timestamp: Annotated[str | None, Header()] = None,
    x_signature: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """The one global inbound address (Cloudflare Email Routing -> an Email Worker -> here). Signed (`X-Timestamp` + `X-Signature`, HMAC-SHA256 of `<seconds>.<body>`) or, for older callers, the shared `X-Inbound-Secret`."""
    _no_replay(request)
    raw = await _body(request)
    service = _service(runtime)
    mail = _mail(raw)
    return {"status": service.receive_mail_global(x_inbound_secret, mail, signed=service.signed_ok(raw, x_timestamp, x_signature))}


def _mail(raw: bytes) -> MailIn:
    from pydantic import ValidationError

    try:
        mail = MailIn.model_validate_json(raw or b"null")
    except ValidationError:
        raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]}) from None
    if mail.raw_base64:   # the worker sent the whole mail: a real parser reads it (the envelope `to` stays the worker's, it is the one the mail was routed by)
        try:
            read = mime.read(mail.raw_base64)
        except mime.Unreadable:
            raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["raw_base64"]}) from None
        return mail.model_copy(update={"sender": read["sender"] or mail.sender, "subject": read["subject"] or mail.subject, "text": read["text"] or mail.text, "message_id": read["message_id"] or mail.message_id, "raw_base64": None})
    return mail


@public_router.get("/meta/{token}")
def meta_verify(
    token: str,
    runtime: RuntimeDep,
    hub_mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    hub_verify_token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    hub_challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    return PlainTextResponse(_service(runtime).meta_verify(token, hub_mode, hub_verify_token, hub_challenge))


@public_router.post("/meta/{token}", status_code=200)
async def meta_receive(token: str, request: Request, runtime: RuntimeDep, x_hub_signature_256: Annotated[str | None, Header()] = None) -> dict[str, bool]:
    raw = await _body(request)
    try:
        payload = json.loads(raw or b"null")
    except ValueError:
        raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": ["body"]}) from None
    _service(runtime).meta_receive(token, raw, x_hub_signature_256, payload)
    return {"ok": True}


@public_router.post("/{token}/email", response_model=MailOut, status_code=202)
async def intake_mail(token: str, request: Request, runtime: RuntimeDep) -> dict[str, Any]:
    _no_replay(request)
    mail = _mail(await _body(request))
    return {"status": _service(runtime).receive_mail(token, mail)}


@public_router.get("/{token}/form")
def intake_form_page(token: str) -> Response:
    """The hosted lead form: the same fields as the snippet, one page, no script. The address is the credential (as for the snippet); an unknown address shows the same page and its post is refused."""
    if not _TOKEN_SHAPE.fullmatch(token):
        raise not_found()
    shown = html.escape(token, quote=True)   # already letters, digits, "_" and "-" only; escaped anyway, so the page is safe whatever the check above lets through
    page = (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Send us your enquiry</title>'
        "<style>body{font-family:system-ui,sans-serif;margin:0;background:#f6f6f4;color:#1c1c1a}form{max-width:26rem;margin:2rem auto;padding:1.5rem;background:#fff;border-radius:12px}"
        "h1{font-size:1.25rem;margin:0 0 1rem}input,textarea,button{width:100%;box-sizing:border-box;font:inherit;padding:.7rem;margin:0 0 .8rem;border:1px solid #c9c9c4;border-radius:8px}"
        "button{background:#1c1c1a;color:#fff;border:0;cursor:pointer}</style>"
        f'<form method="post" action="/v1/lead-intake/{shown}"><h1>Send us your enquiry</h1>'
        '<input type="text" name="name" placeholder="Your name" required autocomplete="name">'
        '<input type="tel" name="phone" placeholder="Phone or WhatsApp number" required autocomplete="tel">'
        '<input type="email" name="email" placeholder="E-mail (optional)" autocomplete="email">'
        '<textarea name="message" rows="4" placeholder="What do you need?"></textarea>'
        '<input type="text" name="_hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">'
        '<button type="submit">Send</button></form></html>'
    )
    headers = {"Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}
    return HTMLResponse(page, headers=headers)


@public_router.post("/{token}", status_code=202)
async def intake_form(token: str, request: Request, runtime: RuntimeDep) -> Response:
    _no_replay(request)
    raw = await _body(request)
    _service(runtime).receive_form(token, _form_data(request, raw))
    headers = {"Access-Control-Allow-Origin": "*", "Cache-Control": "no-store"}
    if "text/html" in request.headers.get("accept", "").lower():
        return HTMLResponse('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title><p style="font-family:sans-serif;margin:2rem">Thank you. We will contact you shortly.</p>', status_code=202, headers=headers)
    return JSONResponse(ReceivedOut().model_dump(), status_code=202, headers=headers)
