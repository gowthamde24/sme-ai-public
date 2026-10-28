"""The opening line and the "mention that I'm an AI assistant" switch (job DT, ADR 0116), under /v1/tenants/{t}/ai-assistant.

  GET /opening-line                     any member: {mention_ai, lines[{language, campaign_id, text}], campaign_overrides[{campaign_id, mention_ai}], placeholders, defaults{language: {with_ai, without_ai}}, disclosure_notice}
  PUT /opening-line                     OWNER: {language, campaign_id?, text}  `text` null resets that line to the default; a campaign's line overrides the workspace's for that campaign
  PUT /mention-ai                       OWNER: {mention_ai, campaign_id?}  default ON; with a campaign, null removes its override. Audited with the old and new value, who and when.
  GET /opening-line/preview?language=&campaign_id=&customer=&agent_role=     any member: the greeting exactly as a customer would hear it ({text, mention_ai, says_ai})

Placeholders {customer} {assistant} {business} {agent_role}; any other brace is a 422. When the switch is OFF the greeting is exactly the Owner's text; the assistant still answers honestly if asked whether it is an
AI (app/opening/honesty.py). Languages: the six of the product plus Marathi (mr) and Bengali (bn, drafts)."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.assistant_settings import data as settings_data
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.opening import render
from app.tenancy.models import Role
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]

Language = Literal["en", "te", "hi", "kn", "ta", "ml", "mr", "bn"]
NOTICE = "Vijaya will still answer honestly if someone asks whether she's an AI. Some regulators expect AI calls to be disclosed; check with your advisor."


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
    # show this once when the switch is turned OFF
    disclosure_notice: str = NOTICE
    wording: Literal["draft"] = "draft"


class PreviewOut(_Strict):
    language: str
    text: str
    mention_ai: bool
    says_ai: bool


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def _out(row: dict[str, object]) -> OpeningOut:
    defaults = {
        lang: DefaultsOut(with_ai=f"{render.DEFAULT_PLAIN[lang]} {render.DISCLOSURE[lang]}", without_ai=render.DEFAULT_PLAIN[lang]) for lang in render.LANGUAGES
    }
    return OpeningOut.model_validate({**row, "defaults": defaults})


@router.get("/opening-line", response_model=OpeningOut)
def get_opening(ctx: AnyMember, runtime: RuntimeDep) -> OpeningOut:
    return _out(_repo(runtime).opening(ctx.principal.token, ctx.tenant.id))


@router.put("/opening-line", response_model=OpeningOut)
def put_opening(body: LineIn, ctx: OwnerOnly, runtime: RuntimeDep) -> OpeningOut:
    if body.text is not None and not render.valid_line(body.text):
        raise ApiError(422, "validation_error", "Use only {customer} {assistant} {business} {agent_role} in braces.", extra={"fields": ["text"]})
    return _out(_repo(runtime).set_opening_line(ctx.principal.token, ctx.tenant.id, body.language, str(body.campaign_id) if body.campaign_id else None, body.text))


@router.put("/mention-ai", response_model=OpeningOut)
def put_mention(body: MentionIn, ctx: OwnerOnly, runtime: RuntimeDep) -> OpeningOut:
    if body.mention_ai is None and body.campaign_id is None:
        raise ApiError(422, "validation_error", "Say on or off.", extra={"fields": ["mention_ai"]})
    return _out(_repo(runtime).set_mention_ai(ctx.principal.token, ctx.tenant.id, str(body.campaign_id) if body.campaign_id else None, body.mention_ai))


@router.get("/opening-line/preview", response_model=PreviewOut)
def preview(
    ctx: AnyMember,
    runtime: RuntimeDep,
    language: Annotated[Language, Query()],
    campaign_id: Annotated[uuid.UUID | None, Query()] = None,
    customer: Annotated[str | None, Query(max_length=40)] = None,
    agent_role: Annotated[str | None, Query(max_length=40)] = None,
) -> PreviewOut:
    text, mention = rendered_opening(runtime, ctx, language, str(campaign_id) if campaign_id else None, customer, agent_role)
    return PreviewOut(language=language, text=text, mention_ai=mention, says_ai=render.says_ai(text))


def rendered_opening(runtime: Runtime, ctx: TenantContext, language: str, campaign_id: str | None, customer: str | None, agent_role: str | None) -> tuple[str, bool]:
    """The greeting a customer hears (the preview, the voice preview, a call and a voice note all use this): the live business name, the assistant's name from its settings, the Owner's line and the switch."""
    row = _repo(runtime).opening(ctx.principal.token, ctx.tenant.id)
    mention = render.pick_mention(bool(row.get("mention_ai", True)), row.get("campaign_overrides", []), campaign_id)
    line = render.pick_line(row.get("lines", []), language, campaign_id)
    name: object = settings_data.default_name()
    if runtime.assistant_settings is not None:  # the name the Owner chose in Settings > AI assistant
        name = runtime.assistant_settings.get(ctx.principal.token, ctx.tenant.id).settings.name
    ai_intro = settings_data.intro(language, str(name), ctx.tenant.name) if language in settings_data.load()["intro"] else None
    text = render.compose_opening(language, owner_line=line, mention_ai=mention, assistant=str(name), business=ctx.tenant.name, customer=customer, agent_role=agent_role, ai_intro=ai_intro)
    return text, mention
