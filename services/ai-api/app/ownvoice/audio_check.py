"""Looking at a recording before it is kept (job DP part 5). Pure: bytes in, an answer or a closed code out.

The API has no audio decoder, so it does what it can: the file must START like the audio type it says it is (no page of HTML called .wav); a WAV is read properly and its real length must match the claim; any other
type is checked by plausibility (a speech recording of the claimed length is between 1 and 400 kilobytes a second). A closed code is returned, never the file's content."""

from __future__ import annotations

import io
import wave

MAGIC = {
    "audio/wav": (b"RIFF",),
    "audio/x-wav": (b"RIFF",),
    "audio/ogg": (b"OggS",),
    "audio/webm": (b"\x1a\x45\xdf\xa3",),
    "video/webm": (b"\x1a\x45\xdf\xa3",),
    "audio/mpeg": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xe3"),
    "audio/mp4": (b"\x00\x00\x00",),
    "audio/x-m4a": (b"\x00\x00\x00",),
    "video/mp4": (b"\x00\x00\x00",),
}
EXTENSION = {
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "video/mp4": "mp4",
}  # fmt: skip
TOLERANCE_SECONDS = 2.0
MIN_BYTES_PER_SECOND = 1_000
MAX_BYTES_PER_SECOND = 400_000


class AudioRefused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def check(data: bytes, content_type: str, claimed_seconds: float) -> float:
    """The length to trust, in seconds, or AudioRefused(code): `not_audio`, `length_mismatch`, `implausible_length`."""
    magic = MAGIC.get(content_type)
    if magic is None or not data.startswith(magic):
        raise AudioRefused("not_audio")
    if content_type in ("audio/wav", "audio/x-wav"):
        try:
            with wave.open(io.BytesIO(data)) as w:
                real = float(w.getnframes()) / float(w.getframerate())
        except (wave.Error, EOFError, ZeroDivisionError):
            raise AudioRefused("not_audio") from None
        if abs(real - claimed_seconds) > TOLERANCE_SECONDS:
            raise AudioRefused("length_mismatch")
        return round(real, 1)
    rate = len(data) / max(claimed_seconds, 1.0)
    if not MIN_BYTES_PER_SECOND <= rate <= MAX_BYTES_PER_SECOND:
        raise AudioRefused("implausible_length")
    return round(claimed_seconds, 1)
