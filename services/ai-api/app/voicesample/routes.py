"""The voice picker's listening sample (job DS; C2's question 3, c1-answers.md).

  GET /v1/tenants/{t}/ai-assistant/voice-sample?voice=<female_warm|female_clear|male_calm|male_lively>&language=<en|te|hi|kn|ta|ml>&style=<warm|quick>&name=<optional>
      Owner and Admin. The SOUND itself (audio/wav), at most 2,000,000 bytes. 404 `no_sample` when there is none (a synthetic voice, or voice switched off), 429 `rate_limited` (six a minute, a daily
      character cap per workspace: Sarvam credits are limited), 422 for a bad choice. Nothing is stored; a sample is cached for 24 hours.

  GET /v1/tenants/{t}/ai-assistant/voice-preview?voice=&language=&style=&name=         (same choices and limits as the sample)
      The PREVIEW of the voice: the opening line with this workspace's REAL assistant name and business name (read now, never a stored copy), then one reply, in the chosen language and way of sounding. The
      sound (audio/wav). The cache is keyed by the spoken text, so a renamed business is heard under the new name at once. Never a fixed recording.
  GET /v1/tenants/{t}/ai-assistant/voice-preview/text?...                              the same words as {"text", "assistant_name", "business_name", "language", "style"} (to show beside the player)

NOTE: no `from __future__ import annotations` here (query models are attached to the endpoint signatures at registration time)."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role
from app.voicesample.service import DEFAULT_NAME, NAME_OK, NoSample, RateLimited, preview_text

logger = logging.getLogger("app.voicesample")
router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


@router.get("/voice-sample")
def voice_sample(
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    voice: Annotated[Literal["female_warm", "female_clear", "male_calm", "male_lively"], Query()],
    language: Annotated[Literal["en", "te", "hi", "kn", "ta", "ml"], Query()],
    style: Annotated[Literal["warm", "quick"], Query()] = "warm",
    name: Annotated[str | None, Query(max_length=24)] = None,
) -> Response:
    service = runtime.voice_sample
    if service is None:
        raise ApiError(404, "no_sample", "There is no sample for this voice.")
    if name is not None and not NAME_OK.match(name):
        raise ApiError(422, "validation_error", "Invalid input.")
    try:
        speech = service.sample(ctx.tenant.id, ctx.tenant.name, voice, language, style, name)
    except NoSample:
        raise ApiError(404, "no_sample", "There is no sample for this voice.") from None
    except RateLimited as exc:
        raise ApiError(429, "rate_limited", "Too many samples. Please try again a little later.", retry_after=exc.retry_after) from None
    return Response(content=speech.audio, media_type=speech.content_type, headers={"Cache-Control": "private, max-age=3600"})


PreviewVoice = Annotated[Literal["female_warm", "female_clear", "male_calm", "male_lively"], Query()]
PreviewLanguage = Annotated[Literal["en", "te", "hi", "kn", "ta", "ml"], Query()]


@router.get("/voice-preview")
def voice_preview(
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    voice: PreviewVoice,
    language: PreviewLanguage,
    style: Annotated[Literal["warm", "quick"], Query()] = "warm",
    name: Annotated[str | None, Query(max_length=24)] = None,
) -> Response:
    service = runtime.voice_sample
    if service is None:
        raise ApiError(404, "no_sample", "There is no preview for this voice.")
    if name is not None and not NAME_OK.match(name):
        raise ApiError(422, "validation_error", "Invalid input.")
    try:
        opening = _owner_opening(runtime, ctx, language, name)
        _, speech = service.preview(ctx.tenant.id, ctx.tenant.name, voice, language, style, name, opening)
    except NoSample:
        raise ApiError(404, "no_sample", "There is no preview for this voice.") from None
    except RateLimited as exc:
        raise ApiError(429, "rate_limited", "Too many previews. Please try again a little later.", retry_after=exc.retry_after) from None
    return Response(content=speech.audio, media_type=speech.content_type, headers={"Cache-Control": "no-store"})


@router.get("/voice-preview/text")
def voice_preview_text(
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    language: PreviewLanguage,
    style: Annotated[Literal["warm", "quick"], Query()] = "warm",
    name: Annotated[str | None, Query(max_length=24)] = None,
) -> dict[str, str]:
    chosen = (name or DEFAULT_NAME).strip()
    if not NAME_OK.match(chosen):
        raise ApiError(422, "validation_error", "Invalid input.")
    opening = _owner_opening(runtime, ctx, language, name)
    return {"text": preview_text(language, style, chosen, ctx.tenant.name, opening), "resolved_opening_line": opening or "", "assistant_name": chosen, "business_name": ctx.tenant.name, "language": language, "style": style}


def _owner_opening(runtime: Runtime, ctx: TenantContext, language: str, name: str | None = None) -> str | None:
    """THE opening line (app/opening/resolve.py): the stored line or the default template, filled and with the AI switch applied. The preview speaks exactly what a customer hears and what the card shows."""
    if runtime.workspace is None:
        return None
    from app.opening.routes import rendered_opening

    return rendered_opening(runtime, ctx, language, None, None, None, name=name)[0]
