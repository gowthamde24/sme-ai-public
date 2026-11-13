"""THE one place the opening line is resolved (owner, 29 Oct 2026): the line stored for the workspace or campaign in that language, else the default template, filled with the live business name and the assistant's name,
with the "I'm an AI assistant" switch applied. The settings card, the editor, "Hear it", the voice preview, the owner chat greeting and a call all read the text from here; there is no second template anywhere.

`spoken_text` is the resolved text: the words that go to the voice engine's pronunciation step. The draft arguments (`line`, `mention_ai`, `name`) stand in for the SAVED line, switch and name so that the screen can show and speak what
is typed before it is saved; nothing is saved."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.auth.deps import Runtime, TenantContext
from app.errors import ApiError
from app.opening import render
from app.workspace.repository import WorkspaceRepository

NAME_OK = re.compile(r"^[^<>{}@/\\|\x00-\x1f\x7f]{1,24}$")
Source = Literal["stored", "default", "draft"]


@dataclass(frozen=True)
class Resolved:
    language: str
    text: str                  # the resolved opening line: what the card shows and what is spoken
    source: Source             # stored = the Owner's line, default = the template, draft = an unsaved line from the screen
    mention_ai: bool
    says_ai: bool
    assistant_name: str | None  # the name the Owner set (or typed), or None: no name is ever made up
    business_name: str

    @property
    def spoken_text(self) -> str:
        return self.text


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def saved_assistant_name(runtime: Runtime, ctx: TenantContext) -> str | None:
    """The name a call gives itself: ONLY the one the Owner saved in Settings > AI assistant (read now); otherwise None."""
    if runtime.assistant_settings is None:
        return None
    got = runtime.assistant_settings.get(ctx.principal.token, ctx.tenant.id)
    return str(got.settings.name) if got.saved else None


def clean_name(name: str | None) -> str | None:
    if name is None or not name.strip():
        return None
    if not NAME_OK.match(name.strip()):
        raise ApiError(422, "validation_error", "Invalid input.", extra={"fields": ["assistant_name"]})
    return name.strip()


def trained_greeting(runtime: Runtime, ctx: TenantContext, language: str) -> str | None:
    """The greeting the Owner saved in Talk training for this language (only a SAVED one: the pack defaults are not the Owner's words), or None. Owner and Admin read it; anyone else, or an error, gets None."""
    repo = getattr(runtime, "talk_training", None)
    if repo is None:
        return None
    try:
        row = repo.get(ctx.principal.token, ctx.tenant.id)
    except Exception:   # noqa: BLE001 - the greeting is optional: any failure to read it falls back to the next line
        return None
    doc = row.get("doc") if isinstance(row, dict) else None
    words = doc.get("greeting") if isinstance(doc, dict) else None
    text = words.get(language) if isinstance(words, dict) else None
    return text.strip() if isinstance(text, str) and render.braces_ok(text) else None


def resolve(
    runtime: Runtime,
    ctx: TenantContext,
    language: str,
    campaign_id: str | None = None,
    customer: str | None = None,
    agent_role: str | None = None,
    *,
    line: str | None = None,
    mention_ai: bool | None = None,
    name: str | None = None,
    row: dict[str, object] | None = None,
) -> Resolved:
    """`row` is the already-read opening state of the workspace (to resolve several languages with one read)."""
    state = row if row is not None else _repo(runtime).opening(ctx.principal.token, ctx.tenant.id)
    lines = state.get("lines", [])
    overrides = state.get("campaign_overrides", [])
    mention = mention_ai if mention_ai is not None else render.pick_mention(bool(state.get("mention_ai", True)), overrides if isinstance(overrides, list) else [], campaign_id)
    rows = lines if isinstance(lines, list) else []
    stored = render.pick_line(rows, language, campaign_id)
    campaign = render.campaign_line(rows, language, campaign_id)
    # ONE greeting (owner decision 13 Nov 2026, decided by C1): the campaign's own line, else the greeting of Talk training, else the old workspace line (kept read-only as a fallback), else the default
    trained = None if line is not None or campaign is not None else trained_greeting(runtime, ctx, language)
    owner_line = line if line is not None else (campaign or trained or stored)
    assistant = clean_name(name) or saved_assistant_name(runtime, ctx)
    text = render.compose_opening(language, owner_line=owner_line, mention_ai=mention, assistant=assistant, business=ctx.tenant.name, customer=customer, agent_role=agent_role)
    source: Source = "draft" if line is not None else ("stored" if (campaign or trained or stored) else "default")
    return Resolved(language=language, text=text, source=source, mention_ai=mention, says_ai=render.says_ai(text), assistant_name=assistant, business_name=ctx.tenant.name)
