"""A very quiet background bed under OUR voice on a phone call (owner, 20 Nov 2026: the bed is wanted after all; reverses the 19 Nov "no ambient sound").

  * Mixed ONLY into the audio we send (`PhoneLine._emit`, one chunk at a time): the caller's audio and the speech recogniser never hear it, and nothing is added in front of the first sound: the bed is a pre-rendered loop in memory,
    each outgoing chunk gets the next stretch of it added, the output has exactly the length of the input (no buffer, no look-ahead, so zero added latency).
  * The level is fixed against the voice: the bed is scaled so its RMS is BED_DB (-30 dB) under the voice's target level (app/voice/loudness.py makes every voice that loud), whatever level its file has. The sum goes
    through the same soft limiter as the voice, so it can never clip.
  * The loops are data files, `data/ambience/<name>.pcm` (8 kHz, 16-bit mono little-endian). A file that is missing, empty or odd gives NO background: a call never fails because of the bed. The files that ship are a
    deterministic synthetic placeholder (scripts/make_ambience_placeholders.py, seeded); real recordings can replace them later without any code change.
  * The setting is a closed word: quiet_office (the default) | shop | off. It sits in the Talk training document (`background`), is shown by GET/PUT how-assistant-speaks, and changes nothing the caller is told: the
    opening and the AI disclosure are not touched by anything in this module."""

# ruff: noqa: E501

from __future__ import annotations

import array
import logging
import math
import random
from functools import lru_cache
from pathlib import Path

from app.telephony.pcm import Resampler
from app.voice import loudness

log = logging.getLogger("app.telephony.ambience")

BACKGROUNDS: tuple[str, ...] = ("quiet_office", "shop", "off")
DEFAULT_BACKGROUND = "quiet_office"
BED_DB = -30.0                  # under the voice's own level, never louder
BED_RATE = 8000                 # the rate of the files
MIN_LOOP_S = 2.0                # a shorter file is refused (it would sound like a buzz)
CROSSFADE_MS = 200              # the end of the loop is faded into its start, so the seam is not heard
DATA = Path(__file__).resolve().parent / "data" / "ambience"
LANGUAGES: tuple[str, ...] = ("en", "te", "hi", "kn", "ta", "ml", "mr")
# the words on the screen (a draft for a native read: Telugu, Hindi and the others are not reviewed)
LABELS: dict[str, dict[str, str]] = {
    "quiet_office": {"en": "Quiet office", "te": "ప్రశాంతమైన office", "hi": "शांत office", "kn": "ಶಾಂತ office", "ta": "அமைதியான office", "ml": "ശാന്തമായ office", "mr": "शांत office"},
    "shop": {"en": "Shop", "te": "షాప్", "hi": "दुकान", "kn": "ಅಂಗಡಿ", "ta": "கடை", "ml": "കട", "mr": "दुकान"},
    "off": {"en": "Off", "te": "వద్దు", "hi": "बंद", "kn": "ಬೇಡ", "ta": "வேண்டாம்", "ml": "വേണ്ട", "mr": "बंद"},
}


def bed_rms() -> float:
    """The RMS the bed has in the mix: BED_DB under the voice's target level."""
    return loudness.TARGET_RMS * 10 ** (BED_DB / 20)


def valid(word: object) -> str:
    """A setting word as stored (anything unknown or missing is the default)."""
    return word if isinstance(word, str) and word in BACKGROUNDS else DEFAULT_BACKGROUND


def make_loop(pcm: bytes, rate: int = BED_RATE, crossfade_ms: int = CROSSFADE_MS) -> bytes:
    """A recording made into a loop with no seam: the last `crossfade_ms` are faded out while the first `crossfade_ms` fade in over them, and the loop is the rest. The end of the loop then runs on into its start."""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    n = min(rate * crossfade_ms // 1000, len(samples) // 3)
    if n < 2:
        return bytes(samples.tobytes())
    body = samples[: len(samples) - n]
    for i in range(n):
        w = (i + 1) / (n + 1)   # 0 -> 1: the weight of the start of the recording
        body[i] = max(-32768, min(32767, int(round(samples[len(samples) - n + i] * (1 - w) + samples[i] * w))))
    return bytes(body.tobytes())


def scale_to(pcm: bytes, rms: float) -> bytes:
    """The loop with a constant gain so its RMS is `rms` (silence stays silence)."""
    current = loudness.rms_of(pcm)
    if current <= 0:
        return pcm
    gain = rms / current
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    return array.array("h", (max(-32768, min(32767, int(round(x * gain)))) for x in samples)).tobytes()


def mix(voice: bytes, bed: bytes) -> bytes:
    """`voice` plus `bed` (same length or longer), sample by sample, through the soft limiter. The answer has exactly the length of `voice`."""
    v = array.array("h")
    v.frombytes(voice[: len(voice) // 2 * 2])
    b = array.array("h")
    b.frombytes(bed[: len(v) * 2])
    out = array.array("h", (loudness.limit(x + y) for x, y in zip(v, b, strict=False)))
    out.extend(v[len(b) :])   # (a bed that is too short leaves the rest of the voice as it is)
    tail = voice[len(voice) // 2 * 2 :]
    return out.tobytes() + tail


class Bed:
    """One call's bed: the shared loop and this call's own position in it. `mix_into(chunk)` returns the chunk with the next stretch of the loop added; it advances by exactly the chunk's length."""

    def __init__(self, loop: bytes) -> None:
        if len(loop) // 2 * 2 != len(loop) or len(loop) < 4:
            raise ValueError("a bed is whole 16-bit samples")
        self._loop = loop
        self._pos = 0   # in bytes, always even

    def frame(self, n_bytes: int) -> bytes:
        """The next `n_bytes` (even) of the bed, running round the loop."""
        n_bytes -= n_bytes % 2
        out = bytearray()
        while len(out) < n_bytes:
            take = min(n_bytes - len(out), len(self._loop) - self._pos)
            out += self._loop[self._pos : self._pos + take]
            self._pos = (self._pos + take) % len(self._loop)
        return bytes(out)

    def mix_into(self, chunk: bytes) -> bytes:
        return mix(chunk, self.frame(len(chunk)))


@lru_cache(maxsize=8)
def _loop(name: str, rate: int, directory: str) -> bytes | None:
    path = Path(directory) / f"{name}.pcm"
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if len(raw) < BED_RATE * 2 * MIN_LOOP_S:
        log.warning("ambience_refused name=%s reason=too_short", name)
        return None
    pcm = make_loop(raw)
    if rate != BED_RATE:
        pcm = Resampler(BED_RATE, rate).process(pcm)
    return scale_to(pcm, bed_rms())


def load_bed(name: str, rate: int = BED_RATE, directory: Path | None = None) -> Bed | None:
    """A new Bed of the named background at the line's sample rate, or None (off, unknown, file missing or unusable). Never raises."""
    if name not in BACKGROUNDS or name == "off":
        return None
    try:
        loop = _loop(name, rate, str(directory or DATA))
        return Bed(loop) if loop else None
    except Exception as exc:  # noqa: BLE001 - never a failed call because of the bed
        log.warning("ambience_unavailable name=%s %s", name, exc.__class__.__name__)
        return None


def placeholder(name: str, seconds: float = 8.0, seed: int = 20261120, rate: int = BED_RATE) -> bytes:
    """The deterministic synthetic bed that ships until real recordings exist: seeded noise through one-pole filters (`quiet_office`: a low hum with a slow swell; `shop`: a brighter murmur with soft, sparse bumps).
    Same name and seed give the same bytes on every machine."""
    rng = random.Random(f"{name}:{seed}")  # noqa: S311 - a sound, not a secret
    n = int(seconds * rate)
    low, mid = 0.0, 0.0
    a_low, a_mid = (0.04, 0.0) if name == "quiet_office" else (0.03, 0.35)
    out = array.array("h")
    bump = 0.0
    for i in range(n):
        white = rng.uniform(-1.0, 1.0)
        low += a_low * (white - low)
        mid += a_mid * (white - mid) if a_mid else 0.0
        swell = 0.75 + 0.25 * math.sin(2 * math.pi * i / (rate * 3.1))
        if name == "shop":
            if rng.random() < 2.0 / rate:
                bump = 0.8
            bump *= 0.9992
            value = (low * 2.0 + mid * 0.8 + bump * rng.uniform(-1.0, 1.0) * 0.3) * swell
        else:
            value = low * 3.0 * swell
        out.append(max(-32768, min(32767, int(value * 6000))))
    return scale_to(out.tobytes(), 1500.0)
