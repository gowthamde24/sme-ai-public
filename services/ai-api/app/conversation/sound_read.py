"""Reading a workspace's saved voice, tone and speed for a PREVIEW (the signed-in member's token), as `app.conversation.sound.Stored`.

The phone line reads the same values with the scheduler account (`public.call_sound_for_call`, app/telephony/inbound_store.py); both then call the one `resolve_sound`. Every read here is best effort: a value that cannot be read is
the default (a preview is never refused because a setting is unreadable, exactly as a call is never)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

from app.auth.deps import Runtime, TenantContext
from app.conversation.sound import Sound, Stored, resolve_sound
from app.conversation.voices import default_config

log = logging.getLogger("app.conversation.sound")


def voice_state(runtime: Runtime, ctx: TenantContext) -> tuple[dict[str, str], str]:
    """The workspace's stored choices {language: voice id} and its voice gender (female unless the owner switched)."""
    if runtime.workspace is None:
        return {}, "female"
    raw = runtime.workspace.voice_choices(ctx.principal.token, ctx.tenant.id)
    choices = raw.get("choices", {})
    gender = raw.get("gender")
    return ({str(k): str(v) for k, v in choices.items()} if isinstance(choices, dict) else {}), (gender if gender in ("female", "male") else "female")


def stored_of(runtime: Runtime, ctx: TenantContext) -> Stored:
    choices, gender = voice_state(runtime, ctx)
    speed: float | None = None
    style: str | None = None
    if runtime.assistant_settings is not None:
        try:
            got = runtime.assistant_settings.get(ctx.principal.token, ctx.tenant.id)
            if got.saved:
                speed, style = float(got.settings.speed), str(got.settings.style)
        except Exception as exc:  # noqa: BLE001 - an unreadable setting is the default
            log.warning("sound_settings_unreadable %s", exc.__class__.__name__)
    training: dict[str, Any] | None = None
    repo = getattr(runtime, "talk_training", None)
    if repo is not None:
        try:
            row = repo.get(ctx.principal.token, ctx.tenant.id)
            doc = row.get("doc") if isinstance(row, dict) else None
            training = doc if isinstance(doc, dict) else None
        except Exception as exc:  # noqa: BLE001
            log.warning("sound_training_unreadable %s", exc.__class__.__name__)
    return Stored(choices=choices, gender=gender, speed=speed, style=style, training=training)


def sound_of(runtime: Runtime, ctx: TenantContext, language: str, *, voice_id: str | None = None, tone: str | None = None, speed: float | None = None) -> Sound:
    """The sound a preview speaks: the SAME `resolve_sound` as a call, on what this workspace saved (plus, optionally, one unsaved part that the screen wants to hear)."""
    return resolve_sound(default_config(), stored_of(runtime, ctx), language, voice_id=voice_id, tone=tone, speed=speed)
