"""One loudness for every voice (owner finding of 19 Nov 2026: "Calm is only quieter"). Voices of different engines and different speakers come out at different levels; a caller must not hear one voice louder than another, and the
Calm voice must not be the Warm voice turned down. Two pure tools on 16-bit mono little-endian PCM, no numpy:

  * `normalise_clip(pcm)`: a whole clip (a sample, a preview) gets ONE gain so the RMS of its spoken parts is exactly `TARGET_RMS` (clamped to MIN_GAIN..MAX_GAIN), then a peak limiter keeps every sample under `CEILING`.
  * `StreamNormaliser`: the same for a stream that arrives in pieces (a live call): the level of the voiced samples is followed with a slow memory, the gain moves toward the target a little with every piece and is ramped
    inside the piece (no click at the join), and the same limiter runs on every sample. Silence (below SILENCE_RMS) is never amplified: the gain is not changed by it and a quiet piece is passed through unchanged.

The target is a level on the digital scale of the audio as it is produced (24 kHz from the voice engines); it is the same for every voice, every language, every tone."""

# ruff: noqa: E501

from __future__ import annotations

import array
import math

TARGET_RMS = 3000.0     # about -20.8 dBFS: clear on a phone line, with room for peaks
CEILING = 29491         # the limiter's ceiling, 0.9 of full scale (about -0.9 dBFS): no sample ever goes above it
KNEE = 24000            # the limiter starts to bend a sample above this (a soft knee, so a peak is rounded, not chopped)
SILENCE_RMS = 300.0     # a frame below this is not speech: it never moves the level estimate or the gain
MIN_GAIN, MAX_GAIN = 0.25, 4.0
FRAME = 240             # 10 ms at 24 kHz: the unit in which "voiced" is judged
MEMORY_S = 2.0          # how long the stream's level estimate remembers
STEP = 0.5              # how far the gain moves toward the target with each piece (0..1)


def _samples(pcm: bytes) -> array.array[int]:
    out: array.array[int] = array.array("h")
    out.frombytes(pcm[: len(pcm) // 2 * 2])
    return out


def limit(value: float) -> int:
    """One sample through the soft limiter: unchanged up to KNEE, bent toward CEILING above it, never beyond."""
    mag = abs(value)
    if mag > KNEE:
        mag = KNEE + (CEILING - KNEE) * math.tanh((mag - KNEE) / (CEILING - KNEE))
    return int(round(math.copysign(min(mag, CEILING), value)))


def voiced(samples: array.array[int]) -> tuple[float, int]:
    """(the sum of squares, the number of samples) of the voiced frames of `samples`: frames of FRAME samples whose RMS is at least SILENCE_RMS."""
    energy, count = 0.0, 0
    for start in range(0, len(samples), FRAME):
        frame = samples[start : start + FRAME]
        if not frame:
            break
        e = float(sum(x * x for x in frame))
        if math.sqrt(e / len(frame)) >= SILENCE_RMS:
            energy += e
            count += len(frame)
    return energy, count


def rms_of(pcm: bytes) -> float:
    """The RMS of all samples of a clip (0 for an empty one)."""
    s = _samples(pcm)
    return math.sqrt(sum(x * x for x in s) / len(s)) if s else 0.0


def voiced_rms(pcm: bytes) -> float:
    """The RMS of the voiced frames of a clip (0 when there are none)."""
    energy, count = voiced(_samples(pcm))
    return math.sqrt(energy / count) if count else 0.0


def peak_of(pcm: bytes) -> int:
    s = _samples(pcm)
    return max((abs(x) for x in s), default=0)


def gain_for(level: float) -> float:
    return MAX_GAIN if level <= 0 else max(MIN_GAIN, min(MAX_GAIN, TARGET_RMS / level))


def normalise_clip(pcm: bytes) -> bytes:
    """A whole clip at the target level with the peak limiter. A clip with no voiced frame is returned as it is."""
    samples = _samples(pcm)
    energy, count = voiced(samples)
    if not count:
        return bytes(samples.tobytes())
    gain = gain_for(math.sqrt(energy / count))
    return array.array("h", (limit(x * gain) for x in samples)).tobytes()


class StreamNormaliser:
    """The stream form: feed it the pieces of one voice's audio in order; it returns the same number of bytes, at the target level."""

    def __init__(self, rate: int = 24000) -> None:
        self._rate = rate
        self._decay_per_sample = math.exp(-1.0 / (MEMORY_S * rate))
        self._energy = 0.0
        self._count = 0.0
        self._gain: float | None = None
        self._odd = b""

    @property
    def gain(self) -> float | None:
        return self._gain

    def process(self, pcm: bytes) -> bytes:
        pcm = self._odd + pcm
        self._odd = pcm[len(pcm) // 2 * 2 :]
        samples = _samples(pcm)
        n = len(samples)
        if n == 0:
            return b""
        energy, count = voiced(samples)
        if count:
            fade = self._decay_per_sample**count
            self._energy = self._energy * fade + energy
            self._count = self._count * fade + count
        if self._gain is None and not count:
            return bytes(samples.tobytes())   # nothing voiced yet: pass the quiet start through unchanged
        target = gain_for(math.sqrt(self._energy / self._count)) if self._count else (self._gain or 1.0)
        start = target if self._gain is None else self._gain
        end = start + (target - start) * STEP if self._gain is not None else target
        self._gain = end
        if n == 1:
            return array.array("h", [limit(samples[0] * end)]).tobytes()
        step = (end - start) / (n - 1)
        return array.array("h", (limit(x * (start + step * i)) for i, x in enumerate(samples))).tobytes()
