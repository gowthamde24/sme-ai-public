"""Exotel's Voicebot (bidirectional stream) protocol: what comes in, what goes out (job phone-calls part 2). Source: Exotel support article "Working with the Stream and Voicebot Applet" (read 31 Oct 2026).

  In   connected | start (stream_sid, call_sid, account_sid, from, to, custom_parameters, media_format) | media (base64 raw 16-bit mono little-endian PCM at the rate in `?sample-rate=`, 8000 default) | dtmf | stop | mark
  Out  media | mark | clear (drops audio that was sent but not played yet: the barge-in)
  Chunks we send: 100 ms of audio at the call's rate (1600 bytes at 8 kHz), a multiple of 320 bytes, at most 100 KB, sent at the pace they play.
  Messages we send have EXACTLY the documented shape (developer.exotel.com, Stream and Voicebot applet, read 6 Nov 2026): media {"event","stream_sid","media":{"payload"}}, mark {"event","stream_sid","mark":{"name"}},
  clear {"event","stream_sid"}. (6 Nov 2026: our media also carried a numeric `sequence_number` and `media.chunk`; on both real calls Exotel closed the stream right after our first audio.)

Parsing never trusts the wire: a message that is not JSON, has no known event or carries a bad payload becomes `Unknown` and is ignored."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass, field
from typing import Any

CHUNK_MS = 100
CHUNK_UNIT = 320
MAX_CHUNK = 100_000
DEFAULT_RATE = 8000
RATES = (8000, 16000, 24000)


@dataclass(frozen=True)
class Connected:
    pass


APP_ID_FIELDS = ("app_id", "appid", "AppId", "flow_id", "FlowId", "flowid")


@dataclass(frozen=True)
class Start:
    stream_sid: str
    call_sid: str
    account_sid: str
    from_number: str
    to_number: str
    custom: dict[str, str] = field(default_factory=dict)
    sample_rate: int = DEFAULT_RATE
    fields: tuple[str, ...] = ()   # the names (never the values) of the start body's fields, for the diagnostic log line
    app_id: str = ""               # the flow (app) id, when Exotel names one in the start body or its custom parameters
    encoding: str = "pcm_s16le"    # how the audio is coded (Exotel: raw 16-bit PCM; Plivo names it: "audio/x-l16" is the one we accept)


@dataclass(frozen=True)
class Media:
    pcm: bytes
    timestamp_ms: int = 0


@dataclass(frozen=True)
class Dtmf:
    digit: str


@dataclass(frozen=True)
class Stop:
    reason: str = ""


@dataclass(frozen=True)
class Mark:
    name: str


@dataclass(frozen=True)
class Unknown:
    pass


Event = Connected | Start | Media | Dtmf | Stop | Mark | Unknown


def _d(msg: dict[str, Any], key: str) -> dict[str, Any]:
    value = msg.get(key)
    return value if isinstance(value, dict) else {}


def _s(value: Any, limit: int = 200) -> str:
    return value[:limit] if isinstance(value, str) else ""


def parse(raw: str | bytes) -> Event:
    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        return Unknown()
    if not isinstance(msg, dict):
        return Unknown()
    event = msg.get("event")
    if event == "connected":
        return Connected()
    if event == "start":
        body = _d(msg, "start")
        custom_raw = body.get("custom_parameters")
        custom: dict[str, str] = {}
        if isinstance(custom_raw, dict):
            custom = {_s(k, 40): _s(v, 100) for k, v in custom_raw.items() if isinstance(k, str)}
        elif isinstance(custom_raw, str):   # the blog's sample sends "lead=42&loc=blr"
            for part in custom_raw.split("&"):
                key, _, value = part.partition("=")
                if key:
                    custom[_s(key, 40)] = _s(value, 100)
        fmt = _d(body, "media_format")
        try:
            rate = int(fmt.get("sample_rate", DEFAULT_RATE))
        except (TypeError, ValueError):
            rate = DEFAULT_RATE
        app_id = ""
        for source in (body, custom):
            for key in APP_ID_FIELDS:
                raw_id: Any = source.get(key)
                if raw_id and not app_id and isinstance(raw_id, (str, int)) and not isinstance(raw_id, bool):
                    app_id = _s(str(raw_id), 40)
        return Start(_s(body.get("stream_sid") or msg.get("stream_sid"), 100), _s(body.get("call_sid"), 100), _s(body.get("account_sid"), 100), _s(body.get("from"), 40), _s(body.get("to"), 40), custom,
                     rate if rate in RATES else DEFAULT_RATE, tuple(sorted(_s(k, 40) for k in body if isinstance(k, str)))[:30], app_id)
    if event == "media":
        body = _d(msg, "media")
        try:
            pcm = base64.b64decode(body.get("payload", ""), validate=True)
            ts = int(body.get("timestamp", 0))
        except (binascii.Error, ValueError, TypeError):
            return Unknown()
        return Media(pcm[: len(pcm) // 2 * 2], ts)
    if event == "dtmf":
        body = _d(msg, "dtmf")
        digit = _s(body.get("digit"), 2)
        return Dtmf(digit) if digit and digit in "0123456789*#" else Unknown()
    if event == "stop":
        body = _d(msg, "stop")
        return Stop(_s(body.get("reason"), 60))
    if event == "mark":
        body = _d(msg, "mark")
        return Mark(_s(body.get("name"), 100))
    return Unknown()


def event_name(raw: str) -> str:
    """The event's name for the log: a short word of letters (Exotel's are lower case, Plivo's camelCase), `other` for anything else, `unreadable` when the frame is not JSON. Never a value."""
    try:
        msg = json.loads(raw)
    except ValueError:
        return "unreadable"
    name = msg.get("event") if isinstance(msg, dict) else None
    return name if isinstance(name, str) and re.fullmatch(r"[A-Za-z_]{1,24}", name) else "other"   # Plivo's events are camelCase (playedStream, clearedAudio): letters only, never a value


def closed_word(text: str | None) -> str | None:
    """A provider's reason as a short closed word (letters, _ - and spaces, at most 40), else `other`. Never free text with a number in it."""
    if not text:
        return None
    word = text.strip()[:40]
    return word if re.fullmatch(r"[A-Za-z_ -]{1,40}", word) else "other"


def chunk_bytes(rate: int) -> int:
    """100 ms of 16-bit mono audio at `rate`: 1600 bytes at 8 kHz, 3200 at 16 kHz, 4800 at 24 kHz (each a multiple of 320)."""
    return rate * 2 * CHUNK_MS // 1000


def media_message(stream_sid: str, pcm: bytes) -> str:
    return json.dumps({"event": "media", "stream_sid": stream_sid, "media": {"payload": base64.b64encode(pcm).decode()}}, separators=(",", ":"))


def mark_message(stream_sid: str, name: str) -> str:
    return json.dumps({"event": "mark", "stream_sid": stream_sid, "mark": {"name": name}}, separators=(",", ":"))


def clear_message(stream_sid: str) -> str:
    return json.dumps({"event": "clear", "stream_sid": stream_sid}, separators=(",", ":"))


def valid_out_chunk(pcm: bytes) -> bool:
    return CHUNK_UNIT <= len(pcm) <= MAX_CHUNK and len(pcm) % CHUNK_UNIT == 0
