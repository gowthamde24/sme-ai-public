"""Turn a provider's speech into what WhatsApp plays as a voice note: OGG with the OPUS codec, one channel (job DJ, ADR 0093).

Text-to-speech providers answer in WAV (Sarvam's Bulbul v3 refuses `opus`; the fake provider makes WAV), and WhatsApp takes `audio/ogg` only with the Opus codec and mono input (16 MB at most). ffmpeg does the
conversion. It runs as a child process with FIXED arguments (no shell, nothing from the provider or from a person reaches a command line), reads the audio on its standard input and writes the result to its
standard output: no file is written, nothing is stored. The audio and the words are never logged; an error is a constant code (`ffmpeg_missing`, `convert_timeout`, `convert_failed`, `bad_output`).

  python -m app.voice.convert        a self-test used by the image smoke test: makes a short tone, converts it, checks the result, prints one line and exits 0 (or 1)."""

from __future__ import annotations

import io
import math
import shutil
import struct
import subprocess
import sys
import wave
from collections.abc import Callable
from typing import Any

from app.voice.interface import VoiceError

CONTENT_TYPE = "audio/ogg; codecs=opus"
MAX_OUTPUT_BYTES = 4 * 1024 * 1024   # a minute of speech at 24 kbit/s is about 180 KB; this only bounds a runaway
TIMEOUT_SECONDS = 20.0
BITRATE = "24k"
SAMPLE_RATE = "16000"

Runner = Callable[..., Any]


def ffmpeg_command(binary: str) -> list[str]:
    """The fixed command: stdin -> mono Opus in an Ogg container -> stdout. Metadata is dropped."""
    return [
        binary, "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", "pipe:0", "-vn", "-map_metadata", "-1",
        "-ac", "1", "-ar", SAMPLE_RATE, "-c:a", "libopus", "-b:a", BITRATE, "-application", "voip",
        "-f", "ogg", "pipe:1",
    ]  # fmt: skip


def is_ogg_opus_mono(data: bytes) -> bool:
    """The container says so itself: an Ogg page, then an `OpusHead` packet with one channel."""
    if len(data) < 64 or data[:4] != b"OggS":
        return False
    at = data.find(b"OpusHead", 0, 128)
    return at >= 0 and len(data) > at + 10 and data[at + 9] == 1   # byte 9 of the header: the channel count


class FfmpegConverter:
    """WAV (or any audio ffmpeg reads) -> OGG/Opus mono. `runner` is injected in tests; by default it is subprocess.run."""

    def __init__(self, binary: str = "ffmpeg", *, runner: Runner = subprocess.run, timeout: float = TIMEOUT_SECONDS) -> None:
        self._binary, self._runner, self._timeout = binary, runner, timeout

    def __repr__(self) -> str:
        return "FfmpegConverter()"

    def available(self) -> bool:
        return shutil.which(self._binary) is not None

    def to_ogg_opus(self, audio: bytes) -> bytes:
        if not audio:
            raise VoiceError("bad_input")
        try:
            done = self._runner(ffmpeg_command(self._binary), input=audio, capture_output=True, timeout=self._timeout, check=False, shell=False)  # noqa: S603
        except FileNotFoundError:
            raise VoiceError("ffmpeg_missing") from None
        except subprocess.TimeoutExpired:
            raise VoiceError("convert_timeout") from None
        except OSError:
            raise VoiceError("convert_failed") from None
        if done.returncode != 0:
            raise VoiceError("convert_failed")   # ffmpeg's own words (they can quote the input) are dropped
        out = done.stdout
        if not isinstance(out, bytes) or len(out) > MAX_OUTPUT_BYTES or not is_ogg_opus_mono(out):
            raise VoiceError("bad_output")
        return out


def _tone(seconds: float = 1.0, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 330 * i / rate))) for i in range(int(seconds * rate))))
    return buf.getvalue()


def main() -> int:
    try:
        out = FfmpegConverter().to_ogg_opus(_tone())
    except VoiceError as exc:
        print(f"voice convert self-test failed: {exc.code}")  # noqa: T201
        return 1
    print(f"voice convert self-test ok: ogg/opus mono, {len(out)} bytes")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())
