"""Plivo's audio-streaming protocol (job 3 phase A, 10 Nov 2026): what comes in, what goes out. Every fact here was seen on REAL calls in the throwaway test of 10 Nov 2026 (docs/runbooks/plivo-inbound.md).

  In   start (callId, streamId, accountId, tracks, mediaFormat{encoding, sampleRate}) | media (media.payload: base64 raw 16-bit mono LITTLE-endian PCM, 320 bytes = 20 ms at 8 kHz) | dtmf | playedStream (a checkpoint played)
       | clearedAudio (the queue was cleared). There is NO `stop` event: the end of a call is the socket closing, plus the HTTP callbacks.
  Out  playAudio {"event","media":{"contentType","sampleRate","payload"}} | checkpoint {"event","streamId","name"} | clearAudio {"event","streamId"}
  The XML we answer with:  <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=8000">wss://...</Stream>
  Chunks we send: 100 ms of audio at the call's rate, paced in real time (a burst was not tested). Closing the socket ends the call (cause "End Of XML Instructions", about 1.3 s later).

Parsing never trusts the wire: a message that is not JSON, has no known event or carries a bad payload becomes `Unknown` and is ignored. The events are the SAME dataclasses as Exotel's (app/telephony/exotel.py), so the phone line
does not care which provider it listens to; Plivo has no `from` / `to` in `start` (they come from the signed answer request), so those two stay empty here."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import binascii
import json
from typing import Any

from app.telephony.exotel import (  # noqa: F401 - re-exported: one set of events for every provider
    Connected,
    Dtmf,
    Event,
    Mark,
    Media,
    Start,
    Stop,
    Unknown,
    closed_word,
    event_name,
)

__all__ = ["Connected", "Dtmf", "Event", "Mark", "Media", "Start", "Stop", "Unknown", "closed_word", "event_name", "parse", "chunk_bytes", "media_message", "mark_message", "clear_message", "valid_out_chunk", "stream_xml", "hangup_xml", "NAME", "RATES", "DEFAULT_RATE", "ENCODING_L16"]

NAME = "plivo"
RATES = (8000, 16000)       # linear PCM; mu-law (8 kHz) is offered by Plivo too but never asked for
DEFAULT_RATE = 8000
ENCODING_L16 = "audio/x-l16"
CHUNK_MS = 100
CHUNK_UNIT = 2              # 16-bit samples: any whole number of samples is a valid chunk (Plivo states no other rule)
MAX_CHUNK = 100_000


def _d(msg: dict[str, Any], key: str) -> dict[str, Any]:
    value = msg.get(key)
    return value if isinstance(value, dict) else {}


def _s(value: Any, limit: int = 200) -> str:
    return value[:limit] if isinstance(value, str) else ""


def _extra(raw: Any) -> dict[str, str]:
    """`extra_headers` as Plivo returns it: "{X-PH-variant: a}" or "k=v;k2=v2". Names and short values only."""
    if not isinstance(raw, str):
        return {}
    text = raw.strip().strip("{}")
    out: dict[str, str] = {}
    for part in text.replace(";", ",").split(","):
        key, sep, value = part.partition(":" if ":" in part and "=" not in part else "=")
        if sep and key.strip():
            out[_s(key.strip(), 40)] = _s(value.strip(), 100)
    return out


def parse(raw: str | bytes) -> Event:
    try:
        msg = json.loads(raw)
    except (ValueError, TypeError):
        return Unknown()
    if not isinstance(msg, dict):
        return Unknown()
    event = msg.get("event")
    if event == "start":
        body = _d(msg, "start")
        fmt = _d(body, "mediaFormat")
        try:
            rate = int(fmt.get("sampleRate", DEFAULT_RATE))
        except (TypeError, ValueError):
            rate = DEFAULT_RATE
        return Start(_s(body.get("streamId"), 100), _s(body.get("callId"), 100), _s(body.get("accountId"), 100), "", "", _extra(msg.get("extra_headers")),
                     rate if rate in RATES else DEFAULT_RATE, tuple(sorted(_s(k, 40) for k in body if isinstance(k, str)))[:30], "", _s(fmt.get("encoding"), 40) or ENCODING_L16)
    if event == "media":
        body = _d(msg, "media")
        try:
            pcm = base64.b64decode(body.get("payload", ""), validate=True)
            ts = int(body.get("timestamp", 0))
        except (binascii.Error, ValueError, TypeError):
            return Unknown()
        return Media(pcm[: len(pcm) // 2 * 2], ts)
    if event == "dtmf":
        digit = _s(_d(msg, "dtmf").get("digit"), 2)
        return Dtmf(digit) if digit and digit in "0123456789*#" else Unknown()
    if event == "playedStream":
        return Mark(_s(msg.get("name"), 100))
    return Unknown()   # clearedAudio and anything else: nothing for the line to do


def chunk_bytes(rate: int) -> int:
    """100 ms of 16-bit mono audio at `rate`: 1600 bytes at 8 kHz, 3200 at 16 kHz."""
    return rate * 2 * CHUNK_MS // 1000


def media_message(stream_id: str, pcm: bytes, rate: int) -> str:
    """`stream_id` is not part of playAudio (Plivo takes the audio for the stream the socket belongs to); the type and rate must equal the stream's."""
    return json.dumps({"event": "playAudio", "media": {"contentType": ENCODING_L16, "sampleRate": rate, "payload": base64.b64encode(pcm).decode()}}, separators=(",", ":"))


def mark_message(stream_id: str, name: str) -> str:
    return json.dumps({"event": "checkpoint", "streamId": stream_id, "name": name}, separators=(",", ":"))


def clear_message(stream_id: str) -> str:
    return json.dumps({"event": "clearAudio", "streamId": stream_id}, separators=(",", ":"))


def valid_out_chunk(pcm: bytes) -> bool:
    return CHUNK_UNIT <= len(pcm) <= MAX_CHUNK and len(pcm) % CHUNK_UNIT == 0


def stream_xml(ws_url: str, rate: int = DEFAULT_RATE, *, status_callback: str | None = None, extra_headers: str | None = None, max_seconds: int = 3600) -> str:
    """The answer to Plivo's `answer_url`: stream the call, both ways, to `ws_url`. `ws_url` must hold no number of a person (it is logged by the hosting)."""
    from xml.sax.saxutils import escape, quoteattr

    attrs = f'bidirectional="true" keepCallAlive="true" streamTimeout="{int(max_seconds)}" contentType="{ENCODING_L16};rate={int(rate)}"'
    if extra_headers:
        attrs += f" extraHeaders={quoteattr(extra_headers)}"
    if status_callback:
        attrs += f' statusCallbackUrl={quoteattr(status_callback)} statusCallbackMethod="POST"'
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Stream {attrs}>{escape(ws_url)}</Stream></Response>'


def hangup_xml() -> str:
    """For a call we refuse: hang up at once (the caller hears the line drop)."""
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'
