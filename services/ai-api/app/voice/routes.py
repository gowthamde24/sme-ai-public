"""POST /v1/tenants/{tenant_id}/assistant/voice (job BD, ADR 0071): audio in, the transcript, the existing Agent OWL flow, the text answer, and optionally the answer spoken.

  query:  message_id (required, a uuid; a retry with the same id replays), conversation_id, language (te | hi | kn | en | ta: a hint for the recogniser), speak (true = also return the spoken answer)
  body:   the recording itself (raw bytes; Content-Type audio/*): WAV, M4A / MP4, WebM, Ogg, FLAC or MP3, at most 60 seconds
  answer: server-sent events, as for /assistant/messages, plus
            event: transcript   {type, text, language, seconds, reused}              first: what was heard (reused = true: this message id was heard before; the stored words are used, the engine is not called, nothing is charged)
            ... text / source / draft / done as usual ...
            event: audio        {type, content_type, encoding: "base64", data, characters}   last, only when speak=true and text-to-speech is configured
            event: audio_error  {type, code}                                          instead of audio when speaking failed (the text answer stands)

OFF unless a provider is configured (503 voice_unavailable). The recording is held in memory for the length of the request and NEVER stored or logged; neither is the transcript beyond what the chat
already keeps (the transcript becomes the owner's message). Fair use: the transcription (10 tokens a second) and the spoken answer (4 tokens a character) are charged to the workspace's AI ledger
before the provider is called; when the allowance is used up the request is refused (429 ai_paused_until) before any audio is sent anywhere.

NOTE: no `from __future__ import annotations` here, for the same reason as app/assistant/routes.py."""

# ruff: noqa: E501

import base64
import json
import logging
import uuid
from collections.abc import Iterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from app.agent_runs import pause
from app.agents.errors import AgentDbError
from app.assistant.models import MessageIn
from app.assistant.routes import SSE_HEADERS, start_message
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError
from app.tenancy.models import Role
from app.voice import usage
from app.voice.audio import MAX_WAV_BYTES, AudioInfo, AudioRefused, inspect_audio
from app.voice.interface import LANGUAGES, VoiceError

logger = logging.getLogger("app.voice.routes")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["voice"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]

REFUSALS: dict[str, tuple[int, str, str]] = {
    "too_large": (413, "audio_too_large", "That recording is too big. Keep it under a minute."),
    "too_long": (
        422,
        "audio_too_long",
        "That recording is longer than a minute. Say it in a shorter piece.",
    ),
    "too_short": (422, "audio_too_short", "That recording is empty or too short."),
    "unsupported_audio": (
        415,
        "audio_unsupported",
        "That kind of recording is not supported. Use WAV, M4A, WebM, Ogg, FLAC or MP3.",
    ),
    "unreadable_audio": (422, "audio_unreadable", "That recording could not be read."),
}
VOICE_FAILURES: dict[str, tuple[int, str, str]] = {
    "timeout": (504, "voice_timeout", "The speech service took too long. Try again."),
    "no_speech": (422, "no_speech", "Nothing could be heard in that recording."),
    "unsupported_audio": (
        415,
        "audio_unsupported",
        "The speech service cannot read that kind of recording.",
    ),
    "unsupported_language": (
        422,
        "language_unsupported",
        "That language is not supported for speech.",
    ),
}


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _stored_transcript(
    runtime: Runtime, token: str, tenant: uuid.UUID, message_id: uuid.UUID
) -> str | None:
    """The words of this message id if the caller already has such a message in this business, else None (also None when the data layer cannot say: the engine is then used as for a new message)."""
    agents = runtime.agents
    if agents is None or agents.assistant_db is None:
        return None
    db = agents.assistant_db(token, uuid.uuid4())
    try:
        return db.user_message_text(message_id, tenant)
    except AgentDbError:
        return None
    finally:
        db.close()


def _voice_error(exc: VoiceError) -> ApiError:
    status, code, message = VOICE_FAILURES.get(
        exc.code, (502, "voice_failed", "The speech service could not do that just now.")
    )
    return ApiError(status, code, message)


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_WAV_BYTES:
        raise ApiError(*REFUSALS["too_large"])
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_WAV_BYTES:
            raise ApiError(*REFUSALS["too_large"])
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/assistant/voice")
async def voice_message(
    request: Request,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    message_id: str,
    conversation_id: str | None = None,
    language: Annotated[str | None, Query(pattern="^(en|te|hi|kn|ta)$")] = None,
    speak: bool = False,
) -> StreamingResponse:
    voice = runtime.voice
    if voice is None or voice.stt is None:
        raise ApiError(503, "voice_unavailable", "Voice is not switched on for this system.")
    if speak and voice.tts is None:
        raise ApiError(
            422, "speech_unavailable", "Spoken answers are not switched on for this system."
        )
    mid = parse_uuid(message_id)
    cid = parse_uuid(conversation_id) if conversation_id is not None else None
    if mid is None or (conversation_id is not None and cid is None):
        raise ApiError(422, "validation_error", "Invalid input.")
    data = await _read_body(request)
    try:
        info: AudioInfo = inspect_audio(data)
    except AudioRefused as exc:
        raise ApiError(*REFUSALS[exc.code]) from None
    token, tenant = ctx.principal.token, ctx.tenant.id
    # A RETRY of a message that was already heard (the same message id): the speech engine is NOT called again. The words it was heard as are in the chat already (the owner's own message, which only they
    # can read); they are reused, the recording is only checked and dropped, and nothing new is charged. The shared start then replays the stored answer (or refuses, as for text).
    stored = await run_in_threadpool(_stored_transcript, runtime, token, tenant, mid)
    reused = stored is not None
    if stored is not None:
        text, heard_language = stored, language
    else:
        # the allowance is checked BEFORE any audio leaves this machine
        until = await run_in_threadpool(pause.paused_until_or_none, runtime.today, token, tenant)
        if until is not None:
            raise pause.paused_error(until)
        try:
            transcript = await run_in_threadpool(
                voice.stt.transcribe, data, info.content_type, language, ()
            )
        except VoiceError as exc:
            logger.warning("voice transcription failed: %s", exc.code)
            raise _voice_error(exc) from None
        text = transcript.text.strip()[:4000]
        if not text:
            raise ApiError(*VOICE_FAILURES["no_speech"])
        heard_language = transcript.language or language
    body = MessageIn(message_id=mid, conversation_id=cid, text=text)
    spoken: dict[str, Any] = {}

    def charge(db: Any) -> None:
        usage.charge(db, "voice-stt", usage.STT_MODEL, usage.stt_tokens(info.charged_seconds))

    def on_reply(db: Any, answer: str, answer_language: str) -> None:
        if not speak or voice.tts is None:
            return
        if answer_language not in LANGUAGES:
            spoken["error"] = "unsupported_language"
            return
        words = answer[: usage.MAX_SPOKEN_CHARS]
        try:
            usage.charge(db, "voice-tts", usage.TTS_MODEL, usage.tts_tokens(len(words)))
        except Exception as exc:  # the allowance ran out between the question and the answer: the text answer stands
            spoken["error"] = "budget"
            logger.warning("spoken answer not charged: %s", exc.__class__.__name__)
            return
        try:
            speech = voice.tts.synthesize(words, answer_language)
        except VoiceError as exc:
            spoken["error"] = exc.code if exc.code in VOICE_FAILURES else "voice_failed"
            logger.warning("voice synthesis failed: %s", exc.code)
            return
        spoken["speech"] = speech
        spoken["characters"] = len(words)

    events = await run_in_threadpool(
        start_message, runtime, ctx, body, charge=None if reused else charge, on_reply=on_reply
    )

    def stream() -> Iterator[str]:
        yield _sse(
            "transcript",
            {
                "type": "transcript",
                "text": text,
                "language": heard_language,
                "seconds": info.seconds,
                "reused": reused,
            },
        )
        yield from events
        if "speech" in spoken:
            speech = spoken["speech"]
            yield _sse(
                "audio",
                {
                    "type": "audio",
                    "content_type": speech.content_type,
                    "encoding": "base64",
                    "data": base64.b64encode(speech.audio).decode("ascii"),
                    "characters": spoken["characters"],
                },
            )
        elif "error" in spoken:
            yield _sse("audio_error", {"type": "audio_error", "code": spoken["error"]})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=SSE_HEADERS)
