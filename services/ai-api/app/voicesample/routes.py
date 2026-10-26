"""The voice picker's listening sample (job DS; C2's question 3, c1-answers.md).

  GET /v1/tenants/{t}/ai-assistant/voice-sample?voice=<female_warm|female_clear|male_calm|male_lively>&language=<en|te|hi|kn|ta|ml>&style=<warm|quick>&name=<optional>
      Owner and Admin. The SOUND itself (audio/wav), at most 2,000,000 bytes. 404 `no_sample` when there is none (a synthetic voice, or voice switched off), 429 `rate_limited` (six a minute, a daily
      character cap per workspace: Sarvam credits are limited), 422 for a bad choice. Nothing is stored; a sample is cached for 24 hours.

NOTE: no `from __future__ import annotations` here (query models are attached to the endpoint signatures at registration time)."""

import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role
from app.voicesample.service import NAME_OK, NoSample, RateLimited

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
