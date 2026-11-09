"""POST /v1/tenants/{tenant_id}/speech/transcribe: a short recording in, the words out, for the mic on every free-text field (owner decision, 9 Nov 2026: voice input everywhere).

  body:    multipart/form-data. `audio` (the recording, whatever MediaRecorder gives: WebM/Opus on Android Chrome, MP4/AAC on iPhone Safari, also Ogg, WAV, FLAC, MP3) and `language`
           (te | kn | hi | en | auto; auto = a mix of languages).
  answer:  {"text": "...", "language": "te" | "kn" | ... | null}
  errors:  too_long (422)  empty (422)  cap_reached (429, `retry_after`)  unsupported (415)  unavailable (503)  timeout (504)

The recogniser is Sarvam's (the same vendor and key as the assistant's mic; no new account). A named language uses Saaras v4 (clean punctuation, English words written in the language's script);
`auto` uses Saaras v3 in code-mixed mode (English words stay in Latin letters, the language is detected). Measured on synthetic clips, 9 Nov 2026; see the PR.

PRIVACY: the recording is held in memory for the length of the request and is never stored. The words are never logged: the log line holds the length of the recording, the number of characters,
the language, the milliseconds and the cost, nothing else.

LIMITS: at most MAX_SECONDS per recording (Sarvam's REST endpoint refuses more than 30 s; our API image has no ffmpeg, so a longer one cannot be cut here), 1.5 MB (12 MB for a WAV). The day's
total counts against the workspace's existing talking-time ledger (the same seconds as Live talk and dictation: `BROWSER_VOICE_DAY_SECONDS`) and against a per-person allowance (USER_DAY_SECONDS).

NOTE: no `from __future__ import annotations` here, for the same reason as app/voice/routes.py."""

# ruff: noqa: E501

import email.parser
import email.policy
import logging
import re
import threading
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.pronunciation.brand import write_brand
from app.tenancy.models import Role
from app.voice.audio import MAX_WAV_BYTES, AudioInfo, AudioRefused, inspect_audio
from app.voice.interface import LANGUAGES, VoiceError
from app.voice.sarvam import SarvamStt

logger = logging.getLogger("app.voice.transcribe")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["voice"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]

MAX_SECONDS = 30.0   # Sarvam's REST speech-to-text refuses more ("Audio duration exceeds the maximum limit of 30 seconds", tested 9 Nov 2026)
USER_DAY_SECONDS = 1200   # one person: 20 minutes of dictation a day (at the list price of Rs 0.49 a minute: under Rs 10)
BURST_PER_MINUTE = 12   # one person: recordings in any minute
LIST_INR_PER_MINUTE = 0.49   # Sarvam's pay-as-you-go speech-to-text, sarvam.ai/api-pricing (9 Nov 2026)
HINTS = ("te", "kn", "hi", "en", "auto")
IST = timezone(timedelta(hours=5, minutes=30))

ERRORS: dict[str, tuple[int, str]] = {
    "too_long": (422, "That recording is too long. Keep it under 30 seconds."),
    "empty": (422, "Nothing could be heard in that recording."),
    "cap_reached": (429, "You have used today's talking time for typing. Type this one, or try again tomorrow."),
    "unsupported": (415, "That kind of recording is not supported."),
    "unavailable": (503, "Typing by voice is not switched on for this system."),
    "timeout": (504, "The speech service took too long. Try again."),
}


def refusal(code: str, **kw: Any) -> ApiError:
    status, message = ERRORS[code]
    return ApiError(status, code, message, **kw)


class TranscribeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    language: str | None = None


# ---- multipart, with the standard library (python-multipart is not a dependency of this API) ----------------------------------------------------------


def parse_multipart(content_type: str | None, body: bytes) -> dict[str, tuple[str | None, bytes]]:
    """name -> (file name or None, content) of every part. Anything that is not a well-formed multipart/form-data body is `unsupported`."""
    if not content_type or not content_type.lower().startswith("multipart/form-data"):
        raise refusal("unsupported")
    try:
        message = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\nMIME-Version: 1.0\r\n\r\n" + body)
        parts = list(message.iter_parts())
    except Exception:  # noqa: BLE001 - a malformed body is the caller's mistake, never an error page
        raise refusal("unsupported") from None
    out: dict[str, tuple[str | None, bytes]] = {}
    for part in parts:
        name = part.get_param("name", header="content-disposition")
        payload = part.get_payload(decode=True)
        if isinstance(name, str) and isinstance(payload, bytes):
            out[name] = (part.get_filename(), payload)
    return out


async def read_body(request: Request) -> bytes:
    limit = MAX_WAV_BYTES + 65536
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise refusal("too_long")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise refusal("too_long")
        chunks.append(chunk)
    return b"".join(chunks)


# ---- the per-person allowance -------------------------------------------------------------------------------------------------------------------------


def seconds_to_midnight() -> int:
    """`retry_after` for a daily limit: the seconds to the next Indian midnight."""
    now_ist = datetime.now(IST)
    return int((datetime.combine(now_ist.date() + timedelta(days=1), datetime.min.time(), tzinfo=IST) - now_ist).total_seconds())


class PersonAllowance:
    """A person's seconds today and recordings this minute. In memory, per server: with two servers a person could use at most twice the allowance. The business cap is exact (the database ledger)."""

    def __init__(self, day_seconds: int = USER_DAY_SECONDS, per_minute: int = BURST_PER_MINUTE, *, clock: Callable[[], float] = time.monotonic, today: Callable[[], str] | None = None) -> None:
        self.day_seconds, self.per_minute, self._clock = day_seconds, per_minute, clock
        self._today = today or (lambda: datetime.now(IST).date().isoformat())
        self._lock = threading.Lock()
        self._seconds: dict[tuple[uuid.UUID, uuid.UUID, str], int] = defaultdict(int)
        self._recent: dict[tuple[uuid.UUID, uuid.UUID], deque[float]] = defaultdict(deque)

    def reserve(self, tenant: uuid.UUID, user: uuid.UUID, seconds: int) -> int | None:
        """None when the recording may go; else the seconds to wait (`retry_after`)."""
        now = self._clock()
        with self._lock:
            recent = self._recent[(tenant, user)]
            while recent and now - recent[0] > 60:
                recent.popleft()
            if len(recent) >= self.per_minute:
                return max(1, int(60 - (now - recent[0])))
            key = (tenant, user, self._today())
            if self._seconds[key] + seconds > self.day_seconds:
                return seconds_to_midnight()
            recent.append(now)
            self._seconds[key] += seconds
        return None

    def refund(self, tenant: uuid.UUID, user: uuid.UUID, seconds: int) -> None:
        with self._lock:
            key = (tenant, user, self._today())
            self._seconds[key] = max(0, self._seconds[key] - seconds)


ALLOWANCE = PersonAllowance()


# ---- the words -----------------------------------------------------------------------------------------------------------------------------------------

_AMOUNT = re.compile(r"(₹\s?)(\d{4,})(?![\d,])")
_AMOUNT_WORD = re.compile(r"(?<![\d,])(\d{4,})(\s?(?:రూపాయలు|రూపాయి|ರೂಪಾಯಿ|रुपये|रुपए|rupees?|rs\.?))", re.IGNORECASE)


def indian_grouping(digits: str) -> str:
    """1250000 -> 12,50,000 (the last three digits, then pairs)."""
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    pairs: list[str] = []
    while len(head) > 2:
        pairs.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([p for p in [head, *pairs] if p] + [tail])


def tidy(text: str) -> str:
    """What the recogniser wrote, in the app's own forms: the brand as "Stack19" (the recogniser writes "Stack 19" or the name in script), and an amount in Indian grouping (₹2600 -> ₹2,600)."""
    out = write_brand(" ".join(text.split()))
    out = _AMOUNT.sub(lambda m: m.group(1) + indian_grouping(m.group(2)), out)
    return _AMOUNT_WORD.sub(lambda m: indian_grouping(m.group(1)) + m.group(2), out)


def stt_for(key: str, language: str) -> SarvamStt:
    """A named language: Saaras v4 (clean punctuation). `auto`: Saaras v3, code-mixed (English words stay in Latin letters, the language is detected). Tests replace this."""
    if language == "auto":
        return SarvamStt(key, model="saaras:v3", mode="codemix")
    return SarvamStt(key, model="saaras:v4")


def _transcribe(runtime: Runtime, ctx: TenantContext, data: bytes, info: AudioInfo, language: str) -> TranscribeOut:
    bv = runtime.browser_voice
    if bv is None:
        raise refusal("unavailable")
    seconds = max(1, info.charged_seconds)
    token, tenant, user = ctx.principal.token, ctx.tenant.id, ctx.principal.user_id
    ledger = bv.ledger
    began = time.perf_counter()
    ledger.sync(tenant, token)   # the day's numbers, read from the database (blocking)
    if ledger.seconds_left(tenant) < seconds:
        raise refusal("cap_reached", retry_after=seconds_to_midnight())
    wait = ALLOWANCE.reserve(tenant, user, seconds)
    if wait is not None:
        raise refusal("cap_reached", retry_after=wait)
    ledger.add_seconds(tenant, seconds)
    try:
        heard = stt_for(bv.sarvam_key, language).transcribe(data, info.content_type, None if language == "auto" else language, ())
    except VoiceError as exc:
        ALLOWANCE.refund(tenant, user, seconds)   # a refused or failed request is not charged
        ledger.add_seconds(tenant, -seconds)
        logger.warning("speech_transcribe_failed code=%s ms=%d", exc.code.split(":")[0], round((time.perf_counter() - began) * 1000))
        if exc.code == "timeout":
            raise refusal("timeout") from None
        if exc.code in ("unsupported_audio", "unsupported_language"):
            raise refusal("unsupported") from None
        if exc.code == "http_400":   # the speech service refuses a recording it cannot take: from a valid file of unknown length that is almost always one over 30 s
            raise refusal("too_long" if info.seconds is None else "unsupported") from None
        raise refusal("unavailable") from None
    ledger.flush(tenant, token)
    text = tidy(heard.text)[:4000]
    spoken = heard.language or (language if language in LANGUAGES else None)
    logger.info("speech_transcribe seconds=%d chars=%d language=%s ms=%d cost_inr=%.2f", seconds, len(text), spoken or "-", round((time.perf_counter() - began) * 1000), seconds / 60 * LIST_INR_PER_MINUTE)
    if not text:
        raise refusal("empty")
    return TranscribeOut(text=text, language=spoken)


@router.post("/speech/transcribe", response_model=TranscribeOut)
async def transcribe(request: Request, ctx: SalesPlus, runtime: RuntimeDep) -> TranscribeOut:
    voice = runtime.browser_voice
    if voice is None or not voice.sarvam_key:
        raise refusal("unavailable")
    fields = parse_multipart(request.headers.get("content-type"), await read_body(request))
    audio = fields.get("audio") or fields.get("file")
    language = (fields.get("language") or (None, b"auto"))[1].decode("utf-8", "replace").strip().lower() or "auto"
    if audio is None or language not in HINTS:
        raise refusal("unsupported")
    data = audio[1]
    try:
        info = inspect_audio(data)
    except AudioRefused as exc:
        raise refusal({"too_large": "too_long", "too_long": "too_long", "too_short": "empty"}.get(exc.code, "unsupported")) from None
    if info.seconds is not None and info.seconds > MAX_SECONDS:
        raise refusal("too_long")
    return await run_in_threadpool(_transcribe, runtime, ctx, data, info, language)
