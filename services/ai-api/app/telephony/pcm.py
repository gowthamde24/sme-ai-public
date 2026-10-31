"""16-bit mono PCM helpers for the phone line, without numpy or `audioop` (gone in Python 3.13): a stateful linear resampler and the chunk rules of the provider's stream.

A phone line is 8 or 16 kHz, the speech recogniser takes 16 kHz and the voice engines give 24 kHz. `Resampler(src, dst).process(chunk)` can be fed a stream in pieces and returns the same samples as one big call,
so a chunk boundary leaves no click. Going DOWN a lot (24 to 8 kHz) averages the samples that fall into one output sample first, so high tones do not fold back into the speech band."""

# ruff: noqa: E501

from __future__ import annotations

import array
import math


class Resampler:
    def __init__(self, src: int, dst: int) -> None:
        if src <= 0 or dst <= 0:
            raise ValueError("sample rates must be positive")
        self.src, self.dst = src, dst
        self._step = src / dst            # source samples per output sample
        self._width = max(1, int(round(self._step))) if self._step > 1.25 else 1   # boxcar width when going down by more than a quarter
        self._buf: list[int] = []          # unconsumed source samples (after the boxcar)
        self._pos = 0.0                    # position of the next output sample in self._buf
        self._carry: list[int] = []        # raw samples waiting for a full boxcar window
        self._first = True

    def process(self, pcm: bytes) -> bytes:
        if self.src == self.dst:
            return pcm
        samples = array.array("h")
        samples.frombytes(pcm[: len(pcm) // 2 * 2])
        raw = self._carry + list(samples)
        if self._width > 1:
            n = len(raw) // self._width * self._width
            self._carry = raw[n:]
            smooth = [sum(raw[i : i + self._width]) // self._width for i in range(0, n, self._width)]
            step = self._step / self._width      # smoothed samples are `width` source samples apart
        else:
            self._carry = []
            smooth = raw
            step = self._step
        self._buf.extend(smooth)
        out = array.array("h")
        buf, pos = self._buf, self._pos
        while pos + 1 < len(buf):
            i = int(pos)
            frac = pos - i
            value = buf[i] + (buf[i + 1] - buf[i]) * frac
            out.append(max(-32768, min(32767, int(round(value)))))
            pos += step
        drop = int(pos)
        self._buf = buf[drop:]
        self._pos = pos - drop
        return out.tobytes()


def chunks(pcm: bytes, size: int) -> list[bytes]:
    """`pcm` cut into pieces of `size` bytes (the last one shorter)."""
    return [pcm[i : i + size] for i in range(0, len(pcm), size)]


def pad_to_multiple(pcm: bytes, unit: int) -> bytes:
    """Silence added to the end so the length is a whole number of `unit` bytes."""
    rest = len(pcm) % unit
    return pcm if rest == 0 else pcm + b"\x00" * (unit - rest)


def tone(freq: float, ms: int, rate: int, amplitude: float = 0.3) -> bytes:
    """A sine tone (tests and the simulator)."""
    n = int(rate * ms / 1000)
    return array.array("h", (int(32767 * amplitude * math.sin(2 * math.pi * freq * i / rate)) for i in range(n))).tobytes()
