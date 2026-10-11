"""What an uploaded recording is, and whether it may be used (job BD): the container is read from the FIRST BYTES, never from what the client says it is, the length is measured when the container
tells it (WAV: exactly; M4A / MP4: the movie header), and the size limits are strict. Nothing is decoded and nothing is stored.

Limits: at most MAX_SECONDS seconds (60). A WAV and an M4A are measured, so the limit is exact. WebM, Ogg, FLAC and MP3 do not say their length cheaply, so they are held to MAX_COMPRESSED_BYTES (a
minute of speech at a normal bit rate is far under it) and their length is ESTIMATED for the usage charge (never less than the size suggests at 64 kbit/s)."""

# ruff: noqa: E501

from __future__ import annotations

import io
import math
import struct
import wave
from dataclasses import dataclass

MAX_SECONDS = 60.0
MAX_WAV_BYTES = 12 * 1024 * 1024  # 60 s of 48 kHz 16-bit stereo is 11.5 MB
MAX_COMPRESSED_BYTES = 1_500_000
MIN_BYTES = 200
ASSUMED_BYTES_PER_SECOND = (
    8000  # 64 kbit/s: how a compressed recording's length is estimated for its charge
)


class AudioRefused(Exception):
    """A constant code: too_large, too_long, too_short, unsupported_audio, unreadable_audio."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class AudioInfo:
    content_type: str  # what the bytes are, by their own header
    seconds: float | None  # measured, or None when the container does not say
    charged_seconds: int  # what the usage ledger is charged: the measure, else an estimate; at least 1, at most 60


def _mvhd_seconds(data: bytes) -> float | None:
    """Duration from the movie header box of an MP4 / M4A, or None."""

    def boxes(buf: bytes, start: int, end: int):  # type: ignore[no-untyped-def]
        pos = start
        while pos + 8 <= end:
            size, kind = struct.unpack(">I4s", buf[pos : pos + 8])
            header = 8
            if size == 1 and pos + 16 <= end:
                size = struct.unpack(">Q", buf[pos + 8 : pos + 16])[0]
                header = 16
            elif size == 0:
                size = end - pos
            if size < header or pos + size > end:
                return
            yield kind, pos + header, pos + size
            pos += size

    for kind, start, end in boxes(data, 0, len(data)):
        if kind != b"moov":
            continue
        for inner, istart, iend in boxes(data, start, end):
            if inner != b"mvhd" or iend - istart < 20:
                continue
            version = data[istart]
            if version == 1 and iend - istart >= 32:
                timescale, duration = struct.unpack(">IQ", data[istart + 20 : istart + 32])
            else:
                timescale, duration = struct.unpack(">II", data[istart + 12 : istart + 20])
            return duration / timescale if timescale else None
    return None


def inspect_audio(data: bytes) -> AudioInfo:
    if len(data) < MIN_BYTES:
        raise AudioRefused("too_short")
    head = data[:12]
    seconds: float | None
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        if len(data) > MAX_WAV_BYTES:
            raise AudioRefused("too_large")
        try:
            with wave.open(io.BytesIO(data), "rb") as w:
                seconds = w.getnframes() / float(w.getframerate())
        except (wave.Error, EOFError, ZeroDivisionError):
            raise AudioRefused("unreadable_audio") from None
        content_type = "audio/wav"
    elif head[4:8] == b"ftyp":
        if len(data) > MAX_COMPRESSED_BYTES:
            raise AudioRefused("too_large")
        seconds = _mvhd_seconds(data)
        if seconds is None:
            raise AudioRefused("unreadable_audio")
        content_type = "audio/mp4"
    elif head[:4] == b"\x1a\x45\xdf\xa3":
        content_type, seconds = "audio/webm", None
    elif head[:4] == b"OggS":
        content_type, seconds = "audio/ogg", None
    elif head[:4] == b"fLaC":
        content_type, seconds = "audio/flac", None
    elif head[:3] == b"ID3" or (head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        content_type, seconds = "audio/mpeg", None
    else:
        raise AudioRefused("unsupported_audio")
    if content_type not in ("audio/wav", "audio/mp4") and len(data) > MAX_COMPRESSED_BYTES:
        raise AudioRefused("too_large")
    if seconds is not None:
        if seconds > MAX_SECONDS:
            raise AudioRefused("too_long")
        if seconds <= 0:
            raise AudioRefused("unreadable_audio")
        charged = math.ceil(seconds)
    else:
        charged = math.ceil(len(data) / ASSUMED_BYTES_PER_SECOND)
    return AudioInfo(content_type, seconds, max(1, min(int(MAX_SECONDS), charged)))


def extension(content_type: str) -> str:
    return {
        "audio/wav": "wav",
        "audio/mp4": "m4a",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
        "audio/mpeg": "mp3",
    }.get(content_type, "bin")
