"""VoiceLink's WebSocket-bot protocol (24 Nov 2026; source: VoiceLink's public documentation portal, reports/voicelink-docs/websocket-events.txt and webhook.txt; NOT yet seen on a real call).

  In   connected | start {stream_sid, call_sid, account_sid, from, to, custom_parameters, media_format{encoding "audio/alaw", sample_rate 8000}} | media {track "inbound", payload: base64 A-LAW 8 kHz mono, chunk, timestamp}
       | mark {name} | transfer {target} | stop {callSid}
  Out  media {"event","media":{"payload": base64 A-law}} | mark {"event","mark":{"name"}} | clear {"event","stream_sid"} (= discard what was queued and not yet played: the barge-in)
  VoiceLink's advice: send audio in short segments (under 2 s) so a clear cuts quickly: ours are 100 ms.

The line works in 16-bit PCM, so this module is the A-law codec as well: what comes in is decoded to PCM, what goes out is encoded (a G.711 table lookup per sample, no audioop). The events are the SAME dataclasses as Exotel's and Plivo's. Parsing never trusts the wire:
a message that is not JSON, has no known event or carries a bad payload becomes `Unknown`. UNVERIFIED until the first test call: whether VoiceLink echoes our marks back as `mark` once played (the line has its own estimate when it does not) and what `transfer` needs."""

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

__all__ = ["Connected", "Dtmf", "Event", "Mark", "Media", "Start", "Stop", "Unknown", "closed_word", "event_name", "parse", "chunk_bytes", "media_message", "mark_message", "clear_message", "valid_out_chunk", "alaw_to_pcm", "pcm_to_alaw"]

NAME = "voicelink"
RATES = (8000,)
DEFAULT_RATE = 8000
ENCODING = "audio/alaw"
CHUNK_MS = 100
CHUNK_UNIT = 2
MAX_CHUNK = 100_000

_SEG_END = (0x1F, 0x3F, 0x7F, 0xFF, 0x1FF, 0x3FF, 0x7FF, 0xFFF)


def _decode_one(a: int) -> int:
    a ^= 0x55
    t = (a & 0x0F) << 4
    seg = (a & 0x70) >> 4
    if seg == 0:
        t += 8
    elif seg == 1:
        t += 0x108
    else:
        t = (t + 0x108) << (seg - 1)
    return t if a & 0x80 else -t


def _encode_one(pcm: int) -> int:
    pcm >>= 3
    if pcm >= 0:
        mask = 0xD5
    else:
        mask = 0x55
        pcm = -pcm - 1
    seg = next((i for i, end in enumerate(_SEG_END) if pcm <= end), 8)
    if seg >= 8:
        return 0x7F ^ mask
    aval = seg << 4
    aval |= (pcm >> 1) & 0x0F if seg < 2 else (pcm >> seg) & 0x0F
    return aval ^ mask


_DECODE = tuple(_decode_one(i) for i in range(256))
_ENCODE = tuple(_encode_one((i - 4096) << 3) for i in range(8192))   # indexed by the 13-bit value (sample >> 3) + 4096


def alaw_to_pcm(data: bytes) -> bytes:
    """A-law bytes to 16-bit little-endian PCM (twice as long)."""
    out = bytearray(len(data) * 2)
    for i, a in enumerate(data):
        v = _DECODE[a]
        out[2 * i] = v & 0xFF
        out[2 * i + 1] = (v >> 8) & 0xFF
    return bytes(out)


def pcm_to_alaw(pcm: bytes) -> bytes:
    """16-bit little-endian PCM (an odd last byte is dropped) to A-law bytes (half as long)."""
    out = bytearray(len(pcm) // 2)
    for i in range(len(out)):
        s = pcm[2 * i] | (pcm[2 * i + 1] << 8)
        if s >= 0x8000:
            s -= 0x10000
        out[i] = _ENCODE[(s >> 3) + 4096]
    return bytes(out)


def _d(msg: dict[str, Any], key: str) -> dict[str, Any]:
    value = msg.get(key)
    return value if isinstance(value, dict) else {}


def _s(value: Any, limit: int = 200) -> str:
    return value[:limit] if isinstance(value, str) else ""


def _custom(raw: Any) -> dict[str, str]:
    """`custom_parameters`: short names and short string values only."""
    if not isinstance(raw, dict):
        return {}
    return {_s(k, 40): _s(v if isinstance(v, str) else str(v), 100) for k, v in list(raw.items())[:20] if isinstance(k, str) and isinstance(v, str | int | float)}


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
        body = _d(msg, "start") or msg
        fmt = _d(body, "media_format")
        try:
            rate = int(fmt.get("sample_rate", DEFAULT_RATE))
        except (TypeError, ValueError):
            rate = DEFAULT_RATE
        stream = _s(body.get("stream_sid") or msg.get("stream_sid"), 100)
        return Start(stream, _s(body.get("call_sid"), 100), _s(body.get("account_sid"), 100), _s(body.get("from"), 40), _s(body.get("to"), 40), _custom(body.get("custom_parameters")),
                     rate if rate in RATES else DEFAULT_RATE, tuple(sorted(_s(k, 40) for k in body if isinstance(k, str)))[:30], "", _s(fmt.get("encoding"), 40) or ENCODING)
    if event == "media":
        body = _d(msg, "media")
        if body.get("track", "inbound") != "inbound":
            return Unknown()
        try:
            alaw = base64.b64decode(body.get("payload", ""), validate=True)
            ts = int(body.get("timestamp", 0) or 0)
        except (binascii.Error, ValueError, TypeError):
            return Unknown()
        return Media(alaw_to_pcm(alaw), ts)
    if event == "mark":
        name = _s(_d(msg, "mark").get("name"), 100)
        return Mark(name) if name else Unknown()
    if event == "stop":
        return Stop("stop")
    return Unknown()   # transfer and anything else: nothing for the line to do


def chunk_bytes(rate: int) -> int:
    """100 ms of 16-bit mono PCM at `rate` (the line's unit; half as many bytes go on the wire as A-law): 1600 bytes at 8 kHz."""
    return rate * 2 * CHUNK_MS // 1000


def media_message(stream_sid: str, pcm: bytes, rate: int) -> str:
    """`pcm` is 16-bit PCM at 8 kHz; A-law goes out. The documented bot response carries no stream id."""
    return json.dumps({"event": "media", "media": {"payload": base64.b64encode(pcm_to_alaw(pcm)).decode()}}, separators=(",", ":"))


def mark_message(stream_sid: str, name: str) -> str:
    return json.dumps({"event": "mark", "mark": {"name": name}}, separators=(",", ":"))


def clear_message(stream_sid: str) -> str:
    return json.dumps({"event": "clear", "stream_sid": stream_sid}, separators=(",", ":"))


def valid_out_chunk(pcm: bytes) -> bool:
    return CHUNK_UNIT <= len(pcm) <= MAX_CHUNK and len(pcm) % CHUNK_UNIT == 0
