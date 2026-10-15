"""Voice notes under /v1/tenants/{tenant_id}/voice-notes (job CV, ADR 0088; module `voice_notes`, on for the education pack first).

  GET|PUT /settings                    the business's switch (off by default), the speed of the voice and the calling hours. Owner and Admin read; the Owner sets, with a second factor.
  GET /voices                          the voices a business may choose from (a synthetic machine voice until a provider is configured and a voice has been reviewed)
  PUT /choices/{language}              the voice for a language (Owner, second factor); {"voice_code": null} removes it
  GET /disclosure/{language}           the AI-disclosure line spoken first in every voice note, in the business's name; `usable` false until a native speaker has reviewed it
  GET /usage                           the fair use of the audio in seconds and percent: ok under 80, warn from 80, paused from 100 (the voice note is then left out and the text still goes)
  POST /preview                        one short spoken sample of the disclosure (Owner, Admin; at most ten an hour, at most 20 seconds, counted on the ledger)
  GET|PUT /campaigns/{campaign_id}     whether a campaign's messages also go as voice notes (Owner, Admin, Sales). It is part of what the Owner approves: a change sends an approved campaign back to draft.

The audio of a real note is made by the worker at send time, never by this API and never stored. A model never reads these.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Path

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role
from app.voice.audio import AudioRefused, inspect_audio
from app.voice.interface import VoiceError
from app.voice_notes.models import (
    CampaignVoiceIn,
    CampaignVoiceOut,
    DisclosureOut,
    PreviewIn,
    PreviewOut,
    UsageOut,
    VoiceChoiceIn,
    VoiceOut,
    VoiceSettingsIn,
    VoiceSettingsOut,
    VoicesOut,
)
from app.voice_notes.repository import VoiceNotesRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}/voice-notes", tags=["voice-notes"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Sales = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
LanguagePath = Annotated[str, Path(pattern=r"^(en|te|hi|kn|ta)$")]

# why a preview was not made: a closed word of the database -> the status, the code and a fixed sentence
PREVIEW_REFUSALS: dict[str, tuple[int, str, str]] = {
    "no_voice_for_language": (409, "voice_not_chosen", "Choose a voice for this language first."),
    "disclosure_not_reviewed": (409, "disclosure_not_reviewed", "The spoken AI line for this language has not been reviewed yet."),
    "allowance_used": (429, "voice_allowance_used", "This business has used its voice allowance for now."),
    "too_many_previews": (429, "too_many_previews", "Too many samples this hour. Try again later."),
}
MAX_PREVIEW_SECONDS = 20


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _repo(runtime: Runtime) -> VoiceNotesRepository:
    if runtime.voice_notes is None:
        raise ApiError(503, "voice_notes_unavailable", "Voice notes are not available right now.")
    return runtime.voice_notes


@router.get("/settings", response_model=VoiceSettingsOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> VoiceSettingsOut:
    return VoiceSettingsOut.model_validate(_repo(runtime).settings(ctx.principal.token, ctx.tenant.id))


@router.put("/settings", response_model=VoiceSettingsOut)
def put_settings(body: VoiceSettingsIn, ctx: OwnerStrong, runtime: RuntimeDep) -> VoiceSettingsOut:
    if body.call_from_hour >= body.call_to_hour:
        raise ApiError(422, "validation_error", "Invalid input.")
    return VoiceSettingsOut.model_validate(
        _repo(runtime).set_settings(ctx.principal.token, ctx.tenant.id, body.enabled, body.speed, body.call_from_hour, body.call_to_hour)
    )


@router.get("/voices", response_model=VoicesOut)
def list_voices(ctx: OwnerAdmin, runtime: RuntimeDep) -> VoicesOut:
    return VoicesOut(items=[VoiceOut.model_validate(r) for r in _repo(runtime).voices(ctx.principal.token, ctx.tenant.id)])


@router.put("/choices/{language}", response_model=VoiceSettingsOut)
def put_choice(language: LanguagePath, body: VoiceChoiceIn, ctx: OwnerStrong, runtime: RuntimeDep) -> VoiceSettingsOut:
    return VoiceSettingsOut.model_validate(_repo(runtime).set_choice(ctx.principal.token, ctx.tenant.id, language, body.voice_code))


@router.get("/disclosure/{language}", response_model=DisclosureOut)
def get_disclosure(language: LanguagePath, ctx: Sales, runtime: RuntimeDep) -> DisclosureOut:
    return DisclosureOut.model_validate(_repo(runtime).disclosure(ctx.principal.token, ctx.tenant.id, language))


@router.get("/usage", response_model=UsageOut)
def get_usage(ctx: Sales, runtime: RuntimeDep) -> UsageOut:
    return UsageOut.model_validate(_repo(runtime).usage(ctx.principal.token, ctx.tenant.id))


@router.post("/preview", response_model=PreviewOut)
def preview(body: PreviewIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> PreviewOut:
    repo = _repo(runtime)
    tts = runtime.voice.tts if runtime.voice is not None else None
    if tts is None:
        raise ApiError(503, "voice_unavailable", "Voice is not available right now.")
    plan = repo.preview_plan(ctx.principal.token, ctx.tenant.id, body.language)
    if plan.get("ok") is not True:
        reason = str(plan.get("reason"))
        status, code, sentence = PREVIEW_REFUSALS.get(reason, (409, "voice_not_ready", "A voice note cannot be made yet."))
        raise ApiError(status, code, sentence)
    text, voice_code = plan.get("text"), plan.get("voice_code")
    if not isinstance(text, str) or not isinstance(voice_code, str):
        raise ApiError(502, "upstream_error", "The data layer could not complete the request.")
    try:
        speech = tts.synthesize(text, body.language)
        info = inspect_audio(speech.audio)
    except (VoiceError, AudioRefused):
        raise ApiError(502, "voice_failed", "The voice could not be made this time.") from None
    if info.charged_seconds > MAX_PREVIEW_SECONDS:
        raise ApiError(422, "voice_too_long", "The sample is too long.")
    usage = repo.preview_record(ctx.principal.token, ctx.tenant.id, body.preview_id, body.language, info.charged_seconds, len(text))
    return PreviewOut(
        language=body.language,
        voice_code=voice_code,
        content_type=info.content_type,
        encoding="base64",
        data=base64.b64encode(speech.audio).decode("ascii"),
        seconds=info.charged_seconds,
        usage=UsageOut.model_validate(usage),
    )


@router.get("/campaigns/{campaign_id}", response_model=CampaignVoiceOut)
def get_campaign(campaign_id: str, ctx: Sales, runtime: RuntimeDep) -> CampaignVoiceOut:
    return CampaignVoiceOut.model_validate(_repo(runtime).campaign(ctx.principal.token, ctx.tenant.id, _row_id(campaign_id)))


@router.put("/campaigns/{campaign_id}", response_model=CampaignVoiceOut)
def put_campaign(campaign_id: str, body: CampaignVoiceIn, ctx: Sales, runtime: RuntimeDep) -> CampaignVoiceOut:
    cid = _row_id(campaign_id)
    return CampaignVoiceOut.model_validate(_repo(runtime).set_campaign(ctx.principal.token, ctx.tenant.id, cid, body.enabled))
