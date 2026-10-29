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
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

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
Language = Literal["en", "te", "hi", "kn", "ta", "ml"]
Gender = Literal["female", "male"]
SAMPLE_URL = "/v1/voice-samples/{id}.mp3"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VoiceIn(_Strict):
    """Two forms: `{gender}` flips the workspace (its per-language choices go back to the new gender's defaults); `{language, voice_id}` picks (or, with null, clears) one language's voice."""

    gender: Gender | None = None
    language: Language | None = None
    voice_id: str | None = None

    @model_validator(mode="after")
    def _one_form(self) -> VoiceIn:
        picks = self.language is not None or "voice_id" in self.model_fields_set
        if (self.gender is not None) == picks or (picks and self.language is None):
            raise ValueError("send either {gender} or {language, voice_id}")
        return self


class VoiceOut(_Strict):
    id: str
    name: str
    label: str
    gender: Gender
    tags: list[str]
    recommended: bool
    default: bool   # the default of its gender in its language
    chosen: bool
    sample_url: str
    sample_text: str   # the exact words of the pre-rendered sample (the same line for every voice of a language)


class LanguageOut(_Strict):
    language: Language
    default_id: str   # the default voice of the workspace's gender
    chosen_id: str | None
    active_id: str
    voices: list[VoiceOut]   # voices of BOTH genders; the screen shows the workspace's


class VoicesOut(_Strict):
    gender: Gender
    languages: list[LanguageOut]


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def _voice(c: CatalogueVoice, chosen: str | None) -> VoiceOut:
    return VoiceOut(id=c.id, name=c.name, label=c.label, gender=c.gender, tags=list(c.tags), recommended=c.recommended, default=c.default, chosen=c.id == chosen, sample_url=SAMPLE_URL.format(id=c.id), sample_text=sample_text(c.language))  # type: ignore[arg-type]


def out(config: VoiceConfig, choices: dict[str, str], gender: str = "female") -> VoicesOut:
    """The catalogue with this workspace's choices. A stored choice that is not (any longer) a catalogue voice of its language AND of the workspace's gender is reported as no choice."""
    rows: list[LanguageOut] = []
    for lang in CALL_LANGUAGES:
        default = config.default_for(lang, gender)
        picked = config.catalogue.get(choices.get(lang, ""))
        chosen = picked.id if picked is not None and picked.language == lang and picked.gender == gender else None
        active = config.resolve(lang, chosen, gender).id
        rows.append(LanguageOut(language=lang, default_id=default.id, chosen_id=chosen, active_id=active, voices=[_voice(c, chosen) for c in config.voices_of(lang)]))  # type: ignore[arg-type]
    return VoicesOut(gender=gender, languages=rows)  # type: ignore[arg-type]


def voice_state(runtime: Runtime, ctx: TenantContext) -> tuple[dict[str, str], str]:
    """The workspace's stored choices {language: voice id} and its voice gender (female unless the owner switched)."""
    raw = _repo(runtime).voice_choices(ctx.principal.token, ctx.tenant.id)
    choices = raw.get("choices", {})
    gender = raw.get("gender")
    return ({str(k): str(v) for k, v in choices.items()} if isinstance(choices, dict) else {}), (gender if gender in ("female", "male") else "female")


def choices_of(runtime: Runtime, ctx: TenantContext) -> dict[str, str]:
    return voice_state(runtime, ctx)[0]


def gender_of(runtime: Runtime, ctx: TenantContext) -> str:
    return voice_state(runtime, ctx)[1]


@router.get("/voices", response_model=VoicesOut)
def get_voices(ctx: AnyMember, runtime: RuntimeDep) -> VoicesOut:
    choices, gender = voice_state(runtime, ctx)
    return out(default_config(), choices, gender)


@router.put("/voices", response_model=VoicesOut)
def put_voices(body: VoiceIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> VoicesOut:
    config = default_config()
    if body.gender is not None:
        row = _repo(runtime).set_voice_gender(ctx.principal.token, ctx.tenant.id, body.gender)
    else:
        current = gender_of(runtime, ctx)
        if body.voice_id is not None:
            picked = config.catalogue.get(body.voice_id) if ID_FORMAT.match(body.voice_id) else None
            if picked is None or picked.language != body.language or picked.gender != current:
                raise ApiError(422, "validation_error", "Choose one of the voices on the list for this language and voice type.", extra={"fields": ["voice_id"]})
        row = _repo(runtime).set_voice_choice(ctx.principal.token, ctx.tenant.id, str(body.language), body.voice_id)
    raw = row.get("choices", {})
    after = "male" if row.get("gender") == "male" else "female"
    return out(config, {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}, after)


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
    voice_id: str   # the catalogue voice that spoke (also X-Voice-Id on the GET)


async def _speak_opening(runtime: Runtime, ctx: TenantContext, body: PreviewIn) -> tuple[str, bytes, str, str]:
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
    choices, gender = voice_state(runtime, ctx)
    try:
        wav, engine, voice_id = await service.speak(ctx.tenant.id, body.language, choices.get(body.language), spoken, gender)
    except VoiceError as err:
        if err.code == "rate_limited":
            raise ApiError(429, "rate_limited", "Too many previews today. Please try again tomorrow.", retry_after=3600) from None
        raise ApiError(404, "no_preview", "There is no preview on this system right now.") from None
    return spoken, wav, engine, voice_id


@router.get("/voices/preview")
async def voice_preview(ctx: OwnerAdmin, runtime: RuntimeDep, language: Annotated[Language, Query()]) -> Response:
    """The SAVED opening line as a customer hears it (audio/wav); the words spoken are in the header `X-Spoken-Text` (percent-encoded UTF-8). To hear an unsaved line use POST."""
    spoken, wav, engine, voice_id = await _speak_opening(runtime, ctx, PreviewIn(language=language))
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600", "X-Voice-Engine": engine, "X-Voice-Id": voice_id, "X-Spoken-Text": quote(spoken, safe="")})


@router.post("/voices/preview", response_model=PreviewOut)
async def voice_preview_line(body: PreviewIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> PreviewOut:
    """"Hear it": the line as it is on the screen, unsaved edits included, in the workspace's chosen voice for its language. Returns the exact words spoken so the screen can show them."""
    spoken, wav, engine, voice_id = await _speak_opening(runtime, ctx, body)
    return PreviewOut(spoken_text=spoken, audio=PreviewAudio(mime="audio/wav", base64=base64.b64encode(wav).decode("ascii")), engine=engine, voice_id=voice_id)


# ---- the pre-rendered sample (no sign-in) ----------------------------------------------------------------------------------------------------------------


@public_router.get("/{file_name}")
def sample(file_name: str) -> Response:
    voice_id = file_name[:-4] if file_name.endswith(".mp3") else ""
    voice = default_config().catalogue.get(voice_id) if ID_FORMAT.match(voice_id) else None  # only an id of the catalogue becomes a path: nothing the caller types reaches the file system
    if voice is None or not voice.sample_file.is_file():
        raise ApiError(404, "no_sample", "There is no sample for this voice.")
    return FileResponse(voice.sample_file, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})
