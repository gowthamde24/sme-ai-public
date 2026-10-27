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
