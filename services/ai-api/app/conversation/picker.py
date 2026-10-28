"""The voice picker (job voice-picker, owner decision of 28 Oct 2026): which voice a workspace's assistant uses on calls and in previews, per language (te, hi, kn, en).

  GET  /v1/tenants/{t}/ai-assistant/voices            any member: the catalogue per language with sample URLs, the language's default, the workspace's choice (null = the default) and which voice is active
  PUT  /v1/tenants/{t}/ai-assistant/voices            OWNER or ADMIN: {language, voice_id}  `voice_id` null clears the choice (back to the default). Only a catalogue voice OF THAT LANGUAGE is accepted (422 otherwise). Audited, old and new id.
  GET  /v1/tenants/{t}/ai-assistant/voices/preview?language=   OWNER or ADMIN: the SAVED opening line as a customer hears it, in the ACTIVE voice (audio/wav; the words spoken are in the header X-Spoken-Text, percent-encoded).
  POST /v1/tenants/{t}/ai-assistant/voices/preview {language, text|null, mention_ai|null, campaign_id|null}   "Hear it": the line AS ON THE SCREEN (unsaved edits included), placeholders filled and the AI sentence added as a call does; JSON {spoken_text, audio{mime, base64}, engine}. 404 `no_preview` when the voice service is not configured on this system.
  GET  /v1/voice-samples/{voice_id}.mp3               NO sign-in (an <audio> tag cannot send one): the PRE-RENDERED sample of one catalogue voice, a static file. The provider is never called when someone clicks play.

The catalogue is data (app/conversation/data/voices.json); a voice stored for a workspace that is no longer in it is ignored (the default speaks). A call uses `chosen -> default -> the Bulbul v4 Flash fallback of the same gender`
(voices.py, fallback.py). The preview (the only route here that spends characters) is limited per account and per workspace and day, and cached by voice and text."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import uuid
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.conversation.preview import PREVIEW_DAILY_CHARS as PREVIEW_DAILY_CHARS  # noqa: F401
from app.conversation.voices import (
    CALL_LANGUAGES,
    ID_FORMAT,
    CatalogueVoice,
    VoiceConfig,
    default_config,
    sample_text,
)
from app.errors import ApiError
from app.tenancy.models import Role
from app.voice.interface import VoiceError
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
public_router = APIRouter(prefix="/v1/voice-samples", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Language = Literal["te", "hi", "kn", "en"]
SAMPLE_URL = "/v1/voice-samples/{id}.mp3"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VoiceIn(_Strict):
    language: Language
    voice_id: str | None


class VoiceOut(_Strict):
    id: str
    name: str
    label: str
    gender: Literal["female", "male"]
    default: bool
    chosen: bool
    sample_url: str
    sample_text: str   # the exact words of the pre-rendered sample, so the picker can show what it says


class LanguageOut(_Strict):
    language: Language
    default_id: str
    chosen_id: str | None
    active_id: str
    voices: list[VoiceOut]


class VoicesOut(_Strict):
    languages: list[LanguageOut]


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def _voice(c: CatalogueVoice, chosen: str | None, active: str) -> VoiceOut:
    return VoiceOut(id=c.id, name=c.name, label=c.label, gender=c.gender, default=c.default, chosen=c.id == chosen, sample_url=SAMPLE_URL.format(id=c.id), sample_text=sample_text(c.language))  # type: ignore[arg-type]


def out(config: VoiceConfig, choices: dict[str, str]) -> VoicesOut:
    """The catalogue with this workspace's choices. A stored choice that is not (any longer) a catalogue voice of its language is reported as no choice."""
    rows: list[LanguageOut] = []
    for lang in CALL_LANGUAGES:
        default = config.default_for(lang)
        picked = config.catalogue.get(choices.get(lang, ""))
        chosen = picked.id if picked is not None and picked.language == lang else None
        active = config.resolve(lang, chosen).id
        rows.append(LanguageOut(language=lang, default_id=default.id, chosen_id=chosen, active_id=active, voices=[_voice(c, chosen, active) for c in config.voices_of(lang)]))  # type: ignore[arg-type]
    return VoicesOut(languages=rows)


def choices_of(runtime: Runtime, ctx: TenantContext) -> dict[str, str]:
    """The workspace's stored choices {language: voice id}; what a call and a preview start from."""
    raw = _repo(runtime).voice_choices(ctx.principal.token, ctx.tenant.id).get("choices", {})
    return {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}


@router.get("/voices", response_model=VoicesOut)
def get_voices(ctx: AnyMember, runtime: RuntimeDep) -> VoicesOut:
    return out(default_config(), choices_of(runtime, ctx))


@router.put("/voices", response_model=VoicesOut)
def put_voices(body: VoiceIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> VoicesOut:
    config = default_config()
    if body.voice_id is not None:
        picked = config.catalogue.get(body.voice_id) if ID_FORMAT.match(body.voice_id) else None
        if picked is None or picked.language != body.language:
            raise ApiError(422, "validation_error", "Choose one of the voices on the list for this language.", extra={"fields": ["voice_id"]})
    row = _repo(runtime).set_voice_choice(ctx.principal.token, ctx.tenant.id, body.language, body.voice_id)
    raw = row.get("choices", {})
    return out(config, {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {})


# ---- the preview: the opening line in the active voice ------------------------------------------------------------------------------------------------


class PreviewIn(BaseModel):
    """"Hear it": the opening line AS ON THE SCREEN (unsaved edits included). `text` null = the saved line; `mention_ai` null = the saved switch; `campaign_id` null = the workspace's own line."""

    model_config = ConfigDict(extra="forbid")

    language: Language
    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None   # (300 is checked by the same rule as the opening line itself: 422 invalid_text)
    mention_ai: bool | None = None
    campaign_id: uuid.UUID | None = None


class PreviewAudio(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mime: Literal["audio/wav"]
    base64: str


class PreviewOut(BaseModel):
    """`spoken_text` is the EXACT string sent to the voice engine's pronunciation step (placeholders filled, the AI sentence added when the switch says so)."""

    model_config = ConfigDict(extra="forbid")

    spoken_text: str
    audio: PreviewAudio
    engine: str


async def _speak_opening(runtime: Runtime, ctx: TenantContext, body: PreviewIn) -> tuple[str, bytes, str]:
    """(the spoken text, the sound, the engine): the line as sent (or the saved one), filled with the live names and given the AI sentence exactly as a call does (rendered_opening), spoken in the workspace's chosen
    voice of the line's language through the call voice's pronunciation map. Nothing is saved and no sample sentence is added."""
    from app.assistant.language import detect_language
    from app.opening import render
    from app.opening.routes import rendered_opening

    service = runtime.call_voice
    if service is None:
        raise ApiError(404, "no_preview", "There is no preview on this system.")
    if body.text is not None and not render.valid_line(body.text):
        raise ApiError(422, "invalid_text", "The opening line must be 10 to 300 characters and may use only {customer}, {assistant}, {business} and {agent_role}.", extra={"fields": ["text"]})
    spoken, _ = rendered_opening(runtime, ctx, body.language, str(body.campaign_id) if body.campaign_id else None, None, None, line=body.text, mention_ai=body.mention_ai)
    found = detect_language(spoken)
    if found != "en" and found != body.language:
        raise ApiError(422, "language_mismatch", "This line is written in a different language from the one chosen.", extra={"fields": ["language"]})
    chosen = choices_of(runtime, ctx).get(body.language)
    try:
        wav, engine = await service.speak(ctx.tenant.id, body.language, chosen, spoken)
    except VoiceError as err:
        if err.code == "rate_limited":
            raise ApiError(429, "rate_limited", "Too many previews today. Please try again tomorrow.", retry_after=3600) from None
        raise ApiError(404, "no_preview", "There is no preview on this system right now.") from None
    return spoken, wav, engine


@router.get("/voices/preview")
async def voice_preview(ctx: OwnerAdmin, runtime: RuntimeDep, language: Annotated[Language, Query()]) -> Response:
    """The SAVED opening line as a customer hears it (audio/wav); the words spoken are in the header `X-Spoken-Text` (percent-encoded UTF-8). To hear an unsaved line use POST."""
    spoken, wav, engine = await _speak_opening(runtime, ctx, PreviewIn(language=language))
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600", "X-Voice-Engine": engine, "X-Spoken-Text": quote(spoken, safe="")})


@router.post("/voices/preview", response_model=PreviewOut)
async def voice_preview_line(body: PreviewIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> PreviewOut:
    """"Hear it": the line as it is on the screen, unsaved edits included, in the workspace's chosen voice for its language. Returns the exact words spoken so the screen can show them."""
    spoken, wav, engine = await _speak_opening(runtime, ctx, body)
    return PreviewOut(spoken_text=spoken, audio=PreviewAudio(mime="audio/wav", base64=base64.b64encode(wav).decode("ascii")), engine=engine)


# ---- the pre-rendered sample (no sign-in) ----------------------------------------------------------------------------------------------------------------


@public_router.get("/{file_name}")
def sample(file_name: str) -> Response:
    voice_id = file_name[:-4] if file_name.endswith(".mp3") else ""
    voice = default_config().catalogue.get(voice_id) if ID_FORMAT.match(voice_id) else None  # only an id of the catalogue becomes a path: nothing the caller types reaches the file system
    if voice is None or not voice.sample_file.is_file():
        raise ApiError(404, "no_sample", "There is no sample for this voice.")
    return FileResponse(voice.sample_file, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})
