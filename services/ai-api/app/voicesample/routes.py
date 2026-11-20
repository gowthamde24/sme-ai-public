"""The AI assistant's listening sample and preview (job DS; C2's question 3, c1-answers.md). Since 21 Nov 2026 they speak EXACTLY what a call speaks: the same voice catalogue and engines (Cartesia or Sarvam, with the other as fallback),
the same loudness, and the voice, tone and speed come from the same function a real call uses (`app.conversation.sound.resolve_sound`). Owner finding of 19 Nov: "previews do not equal real calls".

  GET /v1/tenants/{t}/ai-assistant/voice-sample?language=<en|te|hi|kn|ta|ml|mr>&style=<warm|respectful|quick>&name=<optional>
      Owner and Admin. The SOUND itself (audio/wav). The voice is the workspace's chosen voice for that language (or its default), the speed the saved speed. `style` is the tone to hear: omitted, the saved tone
      (warm = friendly). 404 `no_sample` when there is none (no voice service), 429 `rate_limited`. `voice` (the old four personas) is still accepted and ignored. Nothing is stored.
  GET /v1/tenants/{t}/ai-assistant/voice-preview?language=&style=&name=         the opening line with this workspace's REAL assistant name and business name, then one reply, in the same voice; the sound (audio/wav).
  GET /v1/tenants/{t}/ai-assistant/voice-preview/text?...                        the same words as {"text", "assistant_name", "business_name", "language", "style", "sound"} (`sound`: the voice id and name, the provider, the tone and the speed that speak them)

NOTE: no `from __future__ import annotations` here (query models are attached to the endpoint signatures at registration time)."""

import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.conversation.sound import Sound
from app.conversation.sound_read import sound_of
from app.errors import ApiError
from app.telephony.tone import STYLE_TONE
from app.tenancy.models import Role
from app.voice.interface import VoiceError
from app.voicesample.service import DEFAULT_NAME, NAME_OK, line_for, preview_text

logger = logging.getLogger("app.voicesample")
router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
TONE_STYLE = {tone: style for style, tone in STYLE_TONE.items()}   # friendly -> warm, respectful -> respectful, quick -> quick

PreviewLanguage = Annotated[Literal["en", "te", "hi", "kn", "ta", "ml", "mr"], Query()]
PreviewStyle = Annotated[Literal["warm", "respectful", "quick"] | None, Query()]
LegacyVoice = Annotated[Literal["female_warm", "female_clear", "male_calm", "male_lively"] | None, Query()]   # accepted and ignored: the voice is the workspace's chosen voice
Name = Annotated[str | None, Query(max_length=24)]


def _sound(runtime: Runtime, ctx: TenantContext, language: str, style: str | None) -> Sound:
    """The one resolution a call uses; `style` is a tone the screen wants to hear before it saves."""
    return sound_of(runtime, ctx, language, tone=STYLE_TONE.get(style) if style else None)


async def _speak(runtime: Runtime, ctx: TenantContext, sound: Sound, text: str, what: str) -> Response:
    service = runtime.call_voice
    if service is None:
        raise ApiError(404, "no_sample", f"There is no {what} for this voice.")
    try:
        wav, engine, voice_id = await service.speak(ctx.tenant.id, sound.language, sound.voice.id, text, sound.gender, sound.pace)
    except VoiceError as err:
        if err.code == "rate_limited":
            raise ApiError(429, "rate_limited", f"Too many {what}s. Please try again a little later.", retry_after=60) from None
        raise ApiError(404, "no_sample", f"There is no {what} for this voice.") from None
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "no-store", "X-Voice-Id": voice_id, "X-Voice-Engine": engine})


@router.get("/voice-sample")
async def voice_sample(ctx: OwnerAdmin, runtime: RuntimeDep, language: PreviewLanguage, voice: LegacyVoice = None, style: PreviewStyle = None, name: Name = None) -> Response:
    if name is not None and not NAME_OK.match(name):
        raise ApiError(422, "validation_error", "Invalid input.")
    sound = _sound(runtime, ctx, language, style)
    text = line_for(language, TONE_STYLE[sound.tone], (name or DEFAULT_NAME).strip(), ctx.tenant.name)
    return await _speak(runtime, ctx, sound, text, "sample")


@router.get("/voice-preview")
async def voice_preview(ctx: OwnerAdmin, runtime: RuntimeDep, language: PreviewLanguage, voice: LegacyVoice = None, style: PreviewStyle = None, name: Name = None) -> Response:
    if name is not None and not NAME_OK.match(name):
        raise ApiError(422, "validation_error", "Invalid input.")
    sound = _sound(runtime, ctx, language, style)
    text = preview_text(language, TONE_STYLE[sound.tone], (name or DEFAULT_NAME).strip(), ctx.tenant.name, _owner_opening(runtime, ctx, language, name))
    return await _speak(runtime, ctx, sound, text, "preview")


@router.get("/voice-preview/text")
def voice_preview_text(ctx: OwnerAdmin, runtime: RuntimeDep, language: PreviewLanguage, style: PreviewStyle = None, name: Name = None) -> dict[str, Any]:
    chosen = (name or DEFAULT_NAME).strip()
    if not NAME_OK.match(chosen):
        raise ApiError(422, "validation_error", "Invalid input.")
    sound = _sound(runtime, ctx, language, style)
    opening = _owner_opening(runtime, ctx, language, name)
    return {"text": preview_text(language, TONE_STYLE[sound.tone], chosen, ctx.tenant.name, opening), "resolved_opening_line": opening or "", "assistant_name": chosen, "business_name": ctx.tenant.name, "language": language, "style": TONE_STYLE[sound.tone], "sound": sound.public()}


def _owner_opening(runtime: Runtime, ctx: TenantContext, language: str, name: str | None = None) -> str | None:
    """THE opening line (app/opening/resolve.py): the stored line or the default template, filled and with the AI switch applied. The preview speaks exactly what a customer hears and what the card shows."""
    if runtime.workspace is None:
        return None
    from app.opening.routes import rendered_opening

    return rendered_opening(runtime, ctx, language, None, None, None, name=name)[0]
