"""The opening line and the "mention that I'm an AI assistant" switch (job DT, ADR 0116), under /v1/tenants/{t}/ai-assistant.

  GET /opening-line                     any member: {mention_ai, lines[{language, campaign_id, text}], campaign_overrides[{campaign_id, mention_ai}], placeholders, defaults{language: {with_ai, without_ai}}, disclosure_notice}
  PUT /opening-line                     OWNER: {language, campaign_id?, text}  `text` null resets that line to the default; a campaign's line overrides the workspace's for that campaign
  PUT /mention-ai                       OWNER: {mention_ai, campaign_id?}  default ON; with a campaign, null removes its override. Audited with the old and new value, who and when.
  GET /opening-line/resolved?language=&campaign_id=&assistant_name=     any member: THE opening line (app/opening/resolve.py): {resolved_opening_line, spoken_text, source stored|default|draft, mention_ai, says_ai, assistant_name, business_name}.
      The card, the editor, "Hear it" and a call all read this one text. GET /opening-line carries it per language in `resolved`.
  GET /opening-line/preview?language=&campaign_id=&customer=&agent_role=&assistant_name=     any member: the same fields (and `text`, the older name of resolved_opening_line), with {customer} and {agent_role} filled

Placeholders {customer} {assistant} {business} {agent_role}; any other brace is a 422. When the switch is OFF the greeting is exactly the Owner's text; the assistant still answers honestly if asked whether it is an
AI (app/opening/honesty.py). Languages: the six of the product plus Marathi (mr) and Bengali (bn, drafts)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.opening import render
from app.opening.resolve import Resolved, resolve, saved_assistant_name
from app.tenancy.models import Role
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]

Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr", "bn"]
NOTICE = "The assistant will still answer honestly if someone asks whether it is an AI. Some regulators expect AI calls to be disclosed; check with your advisor."


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LineIn(_Strict):
    language: Language
    campaign_id: uuid.UUID | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=render.MAX_LINE)] | None


class MentionIn(_Strict):
    mention_ai: bool | None
    campaign_id: uuid.UUID | None = None


class LineOut(_Strict):
    language: str
    campaign_id: str | None
    text: str


class OverrideOut(_Strict):
    campaign_id: str
    mention_ai: bool


class DefaultsOut(_Strict):
    with_ai: str
    without_ai: str


class OpeningOut(_Strict):
    mention_ai: bool
    lines: list[LineOut]
    campaign_overrides: list[OverrideOut]
    placeholders: list[str] = Field(default_factory=lambda: list(render.PLACEHOLDERS))
    defaults: dict[str, DefaultsOut]
    resolved: dict[str, ResolvedOut]   # per language, for the workspace: the one resolved line (card, editor, Hear it, calls)
    # show this once when the switch is turned OFF
    disclosure_notice: str = NOTICE
    wording: Literal["draft"] = "draft"


class ResolvedOut(_Strict):
    """THE opening line (app/opening/resolve.py): `resolved_opening_line` is what the card shows and what "Hear it" and a call speak; `spoken_text` is that same text, the one sent to the voice engine."""

    language: str
    resolved_opening_line: str
    spoken_text: str
    source: Literal["stored", "default", "draft"]
    mention_ai: bool
    says_ai: bool
    assistant_name: str | None
    business_name: str


class PreviewOut(ResolvedOut):
    text: str   # (the older name of resolved_opening_line)


def resolved_out(r: Resolved) -> ResolvedOut:
    return ResolvedOut(language=r.language, resolved_opening_line=r.text, spoken_text=r.spoken_text, source=r.source, mention_ai=r.mention_ai, says_ai=r.says_ai, assistant_name=r.assistant_name, business_name=r.business_name)


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def _out(row: dict[str, object], runtime: Runtime, ctx: TenantContext) -> OpeningOut:
    """`defaults` are the very templates a call speaks when the Owner wrote no line (with {business}, and {assistant} only when the Owner set a name); `resolved` is the line in force per language, filled."""
    named = assistant_name(runtime, ctx) is not None
    defaults = {lang: DefaultsOut(with_ai=render.default_line(lang, True, named=named), without_ai=render.default_line(lang, False, named=named)) for lang in render.LANGUAGES}
    resolved = {lang: resolved_out(resolve(runtime, ctx, lang, row=row)) for lang in render.LANGUAGES}
    return OpeningOut.model_validate({**row, "defaults": defaults, "resolved": {k: v.model_dump() for k, v in resolved.items()}})


@router.get("/opening-line", response_model=OpeningOut)
def get_opening(ctx: AnyMember, runtime: RuntimeDep) -> OpeningOut:
    return _out(_repo(runtime).opening(ctx.principal.token, ctx.tenant.id), runtime, ctx)


@router.put("/opening-line", response_model=OpeningOut)
def put_opening(body: LineIn, ctx: OwnerOnly, runtime: RuntimeDep) -> OpeningOut:
    if body.text is not None and not render.valid_line(body.text):
        raise ApiError(422, "validation_error", "Use only {customer} {assistant} {business} {agent_role} in braces.", extra={"fields": ["text"]})
    return _out(_repo(runtime).set_opening_line(ctx.principal.token, ctx.tenant.id, body.language, str(body.campaign_id) if body.campaign_id else None, body.text), runtime, ctx)


@router.put("/mention-ai", response_model=OpeningOut)
def put_mention(body: MentionIn, ctx: OwnerOnly, runtime: RuntimeDep) -> OpeningOut:
    if body.mention_ai is None and body.campaign_id is None:
        raise ApiError(422, "validation_error", "Say on or off.", extra={"fields": ["mention_ai"]})
    return _out(_repo(runtime).set_mention_ai(ctx.principal.token, ctx.tenant.id, str(body.campaign_id) if body.campaign_id else None, body.mention_ai), runtime, ctx)


@router.get("/opening-line/resolved", response_model=ResolvedOut)
def get_resolved(
    ctx: AnyMember,
    runtime: RuntimeDep,
    language: Annotated[Language, Query()],
    campaign_id: Annotated[uuid.UUID | None, Query()] = None,
    assistant_name: Annotated[str | None, Query(max_length=24)] = None,
) -> ResolvedOut:
    """THE opening line of a language: the stored line, else the default template, with the live business name and the assistant's name (`assistant_name` = an unsaved name typed on the screen)."""
    return resolved_out(resolve(runtime, ctx, language, str(campaign_id) if campaign_id else None, name=assistant_name))


@router.get("/opening-line/preview", response_model=PreviewOut)
def preview(
    ctx: AnyMember,
    runtime: RuntimeDep,
    language: Annotated[Language, Query()],
    campaign_id: Annotated[uuid.UUID | None, Query()] = None,
    customer: Annotated[str | None, Query(max_length=40)] = None,
    agent_role: Annotated[str | None, Query(max_length=40)] = None,
    assistant_name: Annotated[str | None, Query(max_length=24)] = None,
) -> PreviewOut:
    got = resolve(runtime, ctx, language, str(campaign_id) if campaign_id else None, customer, agent_role, name=assistant_name)
    return PreviewOut(**resolved_out(got).model_dump(), text=got.text)


def assistant_name(runtime: Runtime, ctx: TenantContext) -> str | None:
    """The name a call gives itself: ONLY the one the Owner saved in Settings > AI assistant (read now); otherwise None. No name is ever made up."""
    return saved_assistant_name(runtime, ctx)


def rendered_opening(
    runtime: Runtime, ctx: TenantContext, language: str, campaign_id: str | None, customer: str | None, agent_role: str | None, *, line: str | None = None, mention_ai: bool | None = None, name: str | None = None
) -> tuple[str, bool]:
    """The greeting a customer hears (a call, the owner chat and a voice note use this): (resolved text, the switch). The same resolver as everything else: app/opening/resolve.py."""
    got = resolve(runtime, ctx, language, campaign_id, customer, agent_role, line=line, mention_ai=mention_ai, name=name)
    return got.text, got.mention_ai
