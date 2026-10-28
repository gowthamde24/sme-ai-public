"""The voice picker (job voice-picker, owner decision of 28 Oct 2026): which voice a workspace's assistant uses on calls and in previews, per language (te, hi, kn, en).

  GET  /v1/tenants/{t}/ai-assistant/voices            any member: the catalogue per language with sample URLs, the language's default, the workspace's choice (null = the default) and which voice is active
  PUT  /v1/tenants/{t}/ai-assistant/voices            OWNER or ADMIN: {language, voice_id}  `voice_id` null clears the choice (back to the default). Only a catalogue voice OF THAT LANGUAGE is accepted (422 otherwise). Audited, old and new id.
  GET  /v1/tenants/{t}/ai-assistant/voices/preview?language=   OWNER or ADMIN: the workspace's opening line (real names) spoken in the ACTIVE voice (audio/wav). 404 `no_preview` when the voice service is not configured on this system.
  GET  /v1/voice-samples/{voice_id}.mp3               NO sign-in (an <audio> tag cannot send one): the PRE-RENDERED sample of one catalogue voice, a static file. The provider is never called when someone clicks play.

The catalogue is data (app/conversation/data/voices.json); a voice stored for a workspace that is no longer in it is ignored (the default speaks). A call uses `chosen -> default -> the Bulbul v4 Flash fallback of the same gender`
(voices.py, fallback.py). The preview (the only route here that spends characters) is limited per account and per workspace and day, and cached by voice and text."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.conversation.preview import PREVIEW_DAILY_CHARS as PREVIEW_DAILY_CHARS  # noqa: F401
from app.conversation.voices import (
    CALL_LANGUAGES,
    ID_FORMAT,
    CatalogueVoice,
    VoiceConfig,
    default_config,
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
Language = Literal["en", "te", "hi", "kn"]
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
    return VoiceOut(id=c.id, name=c.name, label=c.label, gender=c.gender, default=c.default, chosen=c.id == chosen, sample_url=SAMPLE_URL.format(id=c.id))  # type: ignore[arg-type]


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


@router.get("/voices/preview")
async def voice_preview(ctx: OwnerAdmin, runtime: RuntimeDep, language: Annotated[Language, Query()]) -> Response:
    service = runtime.call_voice
    if service is None:
        raise ApiError(404, "no_preview", "There is no preview on this system.")
    from app.opening.routes import (
        rendered_opening,  # the greeting a customer hears: the Owner's line, the switch, the live names
    )

    text = rendered_opening(runtime, ctx, language, None, None, None)[0]
    chosen = choices_of(runtime, ctx).get(language)
    try:
        wav, engine = await service.speak(ctx.tenant.id, language, chosen, text)
    except VoiceError as err:
        if err.code == "rate_limited":
            raise ApiError(429, "rate_limited", "Too many previews today. Please try again tomorrow.", retry_after=3600) from None
        raise ApiError(404, "no_preview", "There is no preview on this system right now.") from None
    return Response(content=wav, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600", "X-Voice-Engine": engine})


# ---- the pre-rendered sample (no sign-in) ----------------------------------------------------------------------------------------------------------------


@public_router.get("/{file_name}")
def sample(file_name: str) -> Response:
    voice_id = file_name[:-4] if file_name.endswith(".mp3") else ""
    voice = default_config().catalogue.get(voice_id) if ID_FORMAT.match(voice_id) else None  # only an id of the catalogue becomes a path: nothing the caller types reaches the file system
    if voice is None or not voice.sample_file.is_file():
        raise ApiError(404, "no_sample", "There is no sample for this voice.")
    return FileResponse(voice.sample_file, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=86400"})
