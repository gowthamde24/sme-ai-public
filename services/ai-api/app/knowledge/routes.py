"""The knowledge base under /v1/tenants/{tenant_id}/knowledge (job DR / A1). The contract is docs/contracts/leads-pack.md section 3.

  GET  /sources                          Owner, Admin: the sources (never their text)
  POST /sources                          Owner, Admin: paste text, or upload a brochure / price list / FAQ (base64); only the text is kept
  POST /sources/{id}/draft-facts         Owner, Admin: the model drafts facts (a run of the assistant: it counts against AI use)
  POST /sources/{id}/discard             Owner, Admin: hide the source and drop its undecided drafts
  GET  /facts?status=&source_id=&limit=&cursor=   Owner, Admin: every fact; Sales and Viewer: the approved ones only
  POST /facts                            Owner, Admin: a fact written by hand (a draft)
  POST /facts/{id}/edit                  Owner, Admin: change the text (back to draft)
  POST /facts/{id}/decide                Owner, Admin: approve or reject; a PRICE fact needs the Owner with a second factor

The assistant may only state APPROVED facts (docs/adr/0106). NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.assistant.routes import _refusal
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.knowledge.models import (
    CorrectionIn,
    CorrectionOut,
    DecisionIn,
    DraftOut,
    FactEditIn,
    FactIn,
    FactOut,
    FactsOut,
    SourceIn,
    SourceOut,
    SourcesOut,
)
from app.knowledge.readers import (
    NoText,
    ReaderError,
    ReaderUnavailable,
    TooLarge,
    Unreadable,
    Unsupported,
)
from app.knowledge.service import KnowledgeService, decode_cursor
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/knowledge", tags=["knowledge"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]

_READER_STATUS = {TooLarge: (413, "source_too_large", "That file is too big (5 MB at most)."), Unsupported: (415, "unsupported_type", "That kind of file cannot be read. Use PDF, Word or a text file, or paste the text."),
                  Unreadable: (422, "unreadable_file", "That file could not be read."), NoText: (422, "no_text_found", "No text was found in that file."),
                  ReaderUnavailable: (503, "reader_unavailable", "Pictures and scanned pages cannot be read yet. Type or paste the text instead.")}  # fmt: skip


def _service(runtime: Runtime) -> KnowledgeService:
    if runtime.knowledge is None:
        raise ApiError(503, "knowledge_unavailable", "This is not available right now.")
    return runtime.knowledge


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("/sources", response_model=SourcesOut)
def list_sources(ctx: Manager, runtime: RuntimeDep) -> SourcesOut:
    return _service(runtime).sources(ctx.principal.token, ctx.tenant.id)


@router.post("/sources", response_model=SourceOut, status_code=201)
def add_source(body: SourceIn, ctx: Manager, runtime: RuntimeDep) -> SourceOut:
    try:
        return _service(runtime).add_source(ctx.principal.token, ctx.tenant.id, body)
    except ReaderError as exc:
        status, code, message = _READER_STATUS.get(type(exc), (422, "unreadable_file", "That file could not be read."))
        raise ApiError(status, code, message) from None


@router.post("/sources/{source_id}/draft-facts", response_model=DraftOut)
def draft_facts(source_id: str, ctx: Manager, runtime: RuntimeDep) -> DraftOut:
    parsed = _id(source_id)
    facts = _service(runtime).draft_facts(runtime, ctx.principal.token, ctx.tenant.id, parsed, lambda exc: _refusal(exc, runtime.today, ctx.principal.token, ctx.tenant.id))
    return DraftOut(facts=facts)


@router.post("/sources/{source_id}/discard", response_model=SourceOut)
def discard_source(source_id: str, ctx: Manager, runtime: RuntimeDep) -> SourceOut:
    return _service(runtime).discard(ctx.principal.token, ctx.tenant.id, _id(source_id))


@router.get("/facts", response_model=FactsOut)
def list_facts(
    ctx: AnyMember, runtime: RuntimeDep, status: Literal["draft", "approved", "rejected"] | None = None, source_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50, cursor: str | None = None,
) -> FactsOut:  # fmt: skip
    after = None
    if cursor is not None:
        after = decode_cursor(cursor)
        if after is None:
            raise ApiError(422, "bad_cursor", "That page marker is not valid.")
    return _service(runtime).facts(ctx.principal.token, ctx.tenant.id, status, _id(source_id) if source_id else None, limit, after)


@router.post("/facts", response_model=FactOut, status_code=201)
def add_fact(body: FactIn, ctx: Manager, runtime: RuntimeDep) -> FactOut:
    return _service(runtime).add_fact(ctx.principal.token, ctx.tenant.id, body)


@router.post("/facts/{fact_id}/edit", response_model=FactOut)
def edit_fact(fact_id: str, body: FactEditIn, ctx: Manager, runtime: RuntimeDep) -> FactOut:
    return _service(runtime).edit_fact(ctx.principal.token, ctx.tenant.id, _id(fact_id), body)


@router.post("/facts/{fact_id}/decide", response_model=FactOut)
def decide_fact(fact_id: str, body: DecisionIn, ctx: Manager, runtime: RuntimeDep) -> FactOut:
    return _service(runtime).decide(ctx.principal.token, ctx.tenant.id, _id(fact_id), body.decision)


# ---- "Teach this" (13 Nov 2026): a corrected answer on one line of a call or a chat becomes a fact, with an undo
_NS = uuid.UUID("4d6e8f10-2a3b-4c5d-8e9f-0a1b2c3d4e5f")


def _check_line(runtime: Runtime, ctx: TenantContext, body: CorrectionIn) -> None:
    """The line must exist in THIS business's call or chat (404 for another business's), and for a call it must be the assistant's own line."""
    from app.crm.repository import NotFoundError

    source = _id(str(body.source_id))
    try:
        if body.source == "call":
            calls = getattr(runtime, "calls", None)
            if calls is None:
                raise ApiError(503, "knowledge_unavailable", "This is not available right now.")
            lines = calls.get(ctx.principal.token, ctx.tenant.id, source).transcript or []
            if body.line_index >= len(lines):
                raise ApiError(422, "line_not_found", "That line is not in the call.")
            if getattr(lines[body.line_index], "who", "assistant") != "assistant":
                raise ApiError(422, "not_an_answer", "Only a line the assistant said can be corrected.")
        else:
            wa = getattr(runtime, "whatsapp", None)
            if wa is None:
                raise ApiError(503, "knowledge_unavailable", "This is not available right now.")
            items = wa.repository.conversation_thread(ctx.principal.token, ctx.tenant.id, source, 100, None).get("items") or []
            if body.line_index >= len(items):
                raise ApiError(422, "line_not_found", "That line is not in the chat.")
    except NotFoundError:
        raise not_found() from None


@router.post("/corrections", response_model=CorrectionOut, status_code=201)
def teach_this(body: CorrectionIn, ctx: Manager, runtime: RuntimeDep) -> CorrectionOut:
    """Save a corrected answer into Knowledge. The same line corrected with the same words twice changes nothing. An answer that states an amount stays a DRAFT for the Owner to approve (with a second factor)."""
    from app.knowledge.models import PRICE_LOOKING

    service = _service(runtime)
    _check_line(runtime, ctx, body)
    kind: Literal["price", "faq"] = "price" if PRICE_LOOKING.search(body.corrected_answer) else "faq"
    fact_id = uuid.uuid5(_NS, f"{ctx.tenant.id}|{body.source}|{body.source_id}|{body.line_index}|{body.corrected_answer}")
    fact = service.add_fact(ctx.principal.token, ctx.tenant.id, FactIn(fact_id=fact_id, kind=kind, text=body.corrected_answer))
    if fact.status == "draft" and kind == "faq":
        fact = service.decide(ctx.principal.token, ctx.tenant.id, fact_id, "approve")
    state: Literal["saved", "waiting_for_owner"] = "saved" if fact.status == "approved" else "waiting_for_owner"
    return CorrectionOut(id=fact.id, state=state, kind=fact.kind, text=fact.text)


@router.post("/corrections/{correction_id}/undo", response_model=CorrectionOut)
def undo_teach_this(correction_id: str, ctx: Manager, runtime: RuntimeDep) -> CorrectionOut:
    """Take a corrected answer back: the fact is rejected, so the assistant stops using it (the API has no DELETE verb: an undo is a POST). Safe to repeat."""
    fact = _service(runtime).decide(ctx.principal.token, ctx.tenant.id, _id(correction_id), "reject")
    return CorrectionOut(id=fact.id, state="undone", kind=fact.kind, text=fact.text)

