"""The audio side of turn-taking: Indic Smart Turn (BSD-2-Clause, github/huggingface `adimyth/indic-smart-turn`) says from the last seconds of the caller's AUDIO how likely the turn is over.

Whisper encoder + pooling + a small head, ONNX, int8; 8 s of 16 kHz audio in, one probability out. It covers English and eleven Indian languages (Telugu, Kannada, Tamil, Malayalam, Hindi among them), which the Pipecat
and LiveKit detectors do not. It is OPTIONAL everywhere: no onnxruntime, no numpy, no model file or any failure while loading or running gives None, and the caller falls back to the text rules in turntaking.py.

The front end is Whisper's log-mel (n_fft 400, hop 160, 80 mel bins, 8 s), written out here so the service needs numpy and onnxruntime and nothing else (not transformers or torch); `tests/test_or_audio_turn.py`
pins it against the reference values. Nothing the caller said is kept or logged: only the probability.
"""

# ruff: noqa: E501
from __future__ import annotations

import logging
import math
import os
import threading
from typing import Any

log = logging.getLogger("app.conversation.audio_turn")

SAMPLE_RATE = 16000
WINDOW_S = 8
WINDOW_SAMPLES = SAMPLE_RATE * WINDOW_S
N_FFT = 400
HOP = 160
N_MELS = 80
FRAMES = WINDOW_SAMPLES // HOP   # 800
MIN_AUDIO_S = 0.4   # less than this is not a turn to judge


def _hz_to_mel(hz: Any, np: Any) -> Any:
    hz = np.asarray(hz, dtype=np.float64)
    mel = 3.0 * hz / 200.0
    log_region = hz >= 1000.0
    return np.where(log_region, 15.0 + np.log(np.maximum(hz, 1e-10) / 1000.0) / (math.log(6.4) / 27.0), mel)


def _mel_to_hz(mel: Any, np: Any) -> Any:
    mel = np.asarray(mel, dtype=np.float64)
    hz = 200.0 * mel / 3.0
    log_region = mel >= 15.0
    return np.where(log_region, 1000.0 * np.exp((math.log(6.4) / 27.0) * (mel - 15.0)), hz)


def mel_filters(np: Any) -> Any:
    """Whisper's 80 Slaney-scale triangular filters over the 201 FFT bins: shape (201, 80)."""
    bins = N_FFT // 2 + 1
    fft_freqs = np.linspace(0.0, SAMPLE_RATE / 2, bins)
    edges = _mel_to_hz(np.linspace(_hz_to_mel(0.0, np), _hz_to_mel(SAMPLE_RATE / 2, np), N_MELS + 2), np)
    widths = np.diff(edges)
    ramps = edges[None, :] - fft_freqs[:, None]
    down = -ramps[:, :-2] / widths[:-1]
    up = ramps[:, 2:] / widths[1:]
    filters = np.maximum(0.0, np.minimum(down, up))
    return filters * (2.0 / (edges[2 : N_MELS + 2] - edges[:N_MELS]))[None, :]


def log_mel(pcm16_16k: bytes, np: Any, filters: Any = None) -> Any:
    """(1, 80, 800) float32 for the last 8 s of the audio (zero-padded at the end when shorter), exactly as Whisper's feature extractor with chunk_length=8 and do_normalize=True makes it."""
    wave = np.frombuffer(pcm16_16k[-2 * WINDOW_SAMPLES :], dtype="<i2").astype(np.float32) / 32768.0
    n = int(wave.shape[0])
    if n:
        wave = (wave - wave.mean()) / np.sqrt(wave.var() + 1e-7)
    padded = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    padded[:n] = wave
    padded64 = np.pad(padded.astype(np.float64), N_FFT // 2, mode="reflect")
    starts = np.arange(FRAMES + 1) * HOP
    index = starts[:, None] + np.arange(N_FFT)[None, :]
    window = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(N_FFT) / N_FFT)   # periodic Hann
    power = np.abs(np.fft.rfft(padded64[index] * window[None, :], axis=1)) ** 2   # (frames+1, 201)
    spec = np.log10(np.maximum((mel_filters(np) if filters is None else filters).T @ power.T, 1e-10))   # (80, frames+1)
    spec = spec[:, :-1]
    spec = np.maximum(spec, spec.max() - 8.0)
    return ((spec + 4.0) / 4.0).astype(np.float32)[None, :, :]


class IndicSmartTurn:
    """`probability_complete(pcm16_16k)` -> 0..1, the chance that the caller's turn is over (None when it cannot say). One CPU thread: it runs beside the live turn, not in front of it."""

    def __init__(self, session: Any, np: Any, name: str) -> None:
        self._session, self._np, self.name = session, np, name
        self._features = np.zeros((1, N_MELS, FRAMES), dtype=np.float32)
        self._lock = threading.Lock()   # one inference at a time per process (a session never needs two at once)
        self._mel = mel_filters(np)

    def probability_complete(self, pcm16_16k: bytes) -> float | None:
        if len(pcm16_16k) < 2 * int(SAMPLE_RATE * MIN_AUDIO_S):
            return None
        try:
            with self._lock:
                features = log_mel(pcm16_16k, self._np, self._mel)
                out = self._session.run(None, {"input_features": features})[0]
            value = float(self._np.asarray(out).ravel()[0])
        except Exception:   # noqa: BLE001 - any failure is "no opinion"; the text rules decide
            log.warning("audio turn model failed on one call")
            return None
        return value if 0.0 <= value <= 1.0 else None


_cache: dict[str, IndicSmartTurn | None] = {}
_cache_lock = threading.Lock()


def load(path: str) -> IndicSmartTurn | None:
    """The model at `path`, loaded once per process; None (and one log line saying why, without any content) when onnxruntime or numpy is missing, the file is missing or the model does not load."""
    if not path:
        return None
    with _cache_lock:
        if path in _cache:
            return _cache[path]
        model: IndicSmartTurn | None = None
        try:
            if not os.path.isfile(path):
                raise FileNotFoundError("model file not found")
            import numpy as np  # noqa: PLC0415 - optional dependency
            import onnxruntime as ort  # type: ignore[import-untyped, import-not-found, unused-ignore]  # noqa: PLC0415

            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
            model = IndicSmartTurn(session, np, os.path.basename(path))
            if model.probability_complete(b"\x00\x01" * SAMPLE_RATE) is None:   # a one-second test run: the model loads AND answers
                log.warning("audio turn model loaded but did not answer; text rules only")
                model = None
        except Exception as exc:   # noqa: BLE001 - optional: any reason means the text rules decide
            log.warning("audio turn model not available (%s); text rules only", type(exc).__name__)
            model = None
        _cache[path] = model
        return model
