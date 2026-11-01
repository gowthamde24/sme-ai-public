"""Is this the same voice as the person talking in THIS session? (owner decision, 31 Oct 2026: browser sessions only; phone calls stay off until the December lawyer review.)

While the assistant speaks, a sound can be the owner interrupting or a television. The recogniser cannot say which; a small open speaker model can say whether a voice is the same as the one that has been talking in this session.
CAM++ from 3D-Speaker (Apache-2.0, 28 MB ONNX, 192-number embedding, trained on Mandarin and English; speaker identity does not depend on the language), 80-band Kaldi filterbank features from `kaldi-native-fbank`
(Apache-2.0), one CPU thread, about 25 ms for a 1.5 s clip on an Apple core.

WHAT IS KEPT, AND FOR HOW LONG. `SessionVoice` holds a signature (the mean of a few embeddings of what the person said in the session) in MEMORY, for ONE session. It is never written to disk, a database, a log, analytics or any
provider (the only thing sent anywhere is nothing: the model runs here); it is dropped when the session ends (`close()`); it is never compared across sessions and never says WHO anyone is: it answers only "the same voice as this session's
speaker, or not". With no signature yet, a clip that is too short, or a score that cannot decide, the answer is None and the caller treats the sound as an interruption (stopping beats talking over the person).
Optional: no packages, no model file or a failed load gives None from `load()` and the session behaves as before."""

# ruff: noqa: E501
from __future__ import annotations

import logging
import os
import threading
from typing import Any

log = logging.getLogger("app.conversation.speaker")

SAMPLE_RATE = 16000
MIN_SPEECH_S = 0.8        # less than this much speech is not enough to judge a voice
FRAME = 320               # 20 ms
QUIET_RMS = 300.0         # below this a frame is not speech
SAME_AT_LEAST = 0.40      # measured (31 Oct 2026, 47 other voices): at 0.40 the owner's windows are accepted 94 % and other voices rejected 98 %; 0.45 rejects 100 %
MAX_ENROLLED = 8          # embeddings in the signature
ENROL_CONFIRM_AT = 0.50   # after the first turns, only a clip this close to the signature is added to it (a television never drifts the signature)
FIRST_TURNS_FREE = 2      # the first turns build the signature without a check
MIN_ENROLLED_S = 6.0      # seconds of the person's speech in the signature before it is used (measured on staging 1 Nov 2026: a signature of 3 s of speech scored the owner's own voice at 0.14 to 0.42; the owner's windows against 5 recordings scored 0.61 on average). Until then: no opinion, the sound interrupts


def speech_only(pcm16_16k: bytes, np: Any) -> Any:
    """The loud 20 ms frames of the clip, joined (float32): silence and pauses are not part of a voice."""
    x = np.frombuffer(pcm16_16k[: len(pcm16_16k) // 2 * 2], dtype="<i2").astype(np.float32)
    n = len(x) // FRAME
    if n == 0:
        return x[:0]
    frames = x[: n * FRAME].reshape(n, FRAME)
    loud = np.sqrt((frames**2).mean(axis=1)) >= QUIET_RMS
    return frames[loud].reshape(-1)


class SpeakerModel:
    """The shared model (one per process): clip -> unit-length embedding, or None when there is not enough speech."""

    def __init__(self, session: Any, np: Any, fbank: Any, name: str) -> None:
        self._session, self._np, self._fbank, self.name = session, np, fbank, name
        self._lock = threading.Lock()

    def embed(self, pcm16_16k: bytes) -> Any | None:
        np = self._np
        speech = speech_only(pcm16_16k, np)
        if len(speech) < MIN_SPEECH_S * SAMPLE_RATE:
            return None
        try:
            options = self._fbank.FbankOptions()
            options.frame_opts.dither = 0.0
            options.frame_opts.snip_edges = True
            options.frame_opts.samp_freq = SAMPLE_RATE
            options.mel_opts.num_bins = 80
            extractor = self._fbank.OnlineFbank(options)
            extractor.accept_waveform(SAMPLE_RATE, (speech / 32768.0).tolist())
            extractor.input_finished()
            feats = np.stack([extractor.get_frame(i) for i in range(extractor.num_frames_ready)])
            feats = (feats - feats.mean(axis=0, keepdims=True)).astype(np.float32)
            with self._lock:
                vector = self._session.run(None, {"x": feats[None]})[0][0]
            norm = float(np.linalg.norm(vector))
            return vector / norm if norm > 0 else None
        except Exception:   # noqa: BLE001 - no opinion is the safe answer
            log.warning("speaker model failed on one clip")
            return None


class SessionVoice:
    """One session's signature, in memory. Nothing in here is ever stored or sent; `close()` forgets it."""

    def __init__(self, model: Any, np: Any) -> None:
        self._model, self._np = model, np
        self._vectors: list[Any] = []
        self.turns = 0
        self.enrolled_s = 0.0

    def _signature(self) -> Any | None:
        if not self._vectors:
            return None
        mean = self._np.mean(self._vectors, axis=0)
        norm = float(self._np.linalg.norm(mean))
        return mean / norm if norm > 0 else None

    def similarity(self, pcm16_16k: bytes) -> float | None:
        """How like the session's speaker this clip is (-1..1), or None: no signature yet, or too little speech to say."""
        signature = self._signature()
        if signature is None:
            return None
        vector = self._model.embed(pcm16_16k)
        return None if vector is None else float(self._np.dot(signature, vector))

    @property
    def ready(self) -> bool:
        """Is there enough of the person's speech in the signature to judge another voice against it?"""
        return self.enrolled_s >= MIN_ENROLLED_S

    def same_voice(self, pcm16_16k: bytes, threshold: float = SAME_AT_LEAST) -> bool | None:
        """True / False when it can tell, None when it cannot (no signature, not enough enrolled speech yet, a clip too short): the caller then treats the sound as the person."""
        score = self.similarity(pcm16_16k)
        return None if score is None or not self.ready else score >= threshold

    def enrol(self, pcm16_16k: bytes) -> tuple[bool, float]:
        """Add what the person just said (a confirmed turn): the first turns freely, later ones only when they are still the same voice. Returns (kept, seconds of speech in the clip) for the numbers-only log.
        A clip with too little speech is NOT a turn: it does not use up one of the free first turns (otherwise a failed first enrolment would let the next voice, a television, become the signature)."""
        vector = self._model.embed(pcm16_16k)
        seconds = len(speech_only(pcm16_16k, self._np)) / SAMPLE_RATE
        if vector is None:
            return False, seconds
        self.turns += 1
        signature = self._signature()
        if signature is not None and self.turns > FIRST_TURNS_FREE and float(self._np.dot(signature, vector)) < ENROL_CONFIRM_AT:
            return False, seconds
        self._vectors = [*self._vectors, vector][-MAX_ENROLLED:]
        self.enrolled_s += seconds
        return True, seconds

    def close(self) -> None:
        self._vectors = []
        self.enrolled_s = 0.0


_cache: dict[str, SpeakerModel | None] = {}
_cache_lock = threading.Lock()


def load(path: str) -> SpeakerModel | None:
    """The model at `path`, loaded once per process; None (one log line, no content) when a package or the file is missing or it does not load."""
    if not path:
        return None
    with _cache_lock:
        if path in _cache:
            return _cache[path]
        model: SpeakerModel | None = None
        try:
            if not os.path.isfile(path):
                raise FileNotFoundError("model file not found")
            import kaldi_native_fbank as fbank  # type: ignore[import-untyped, import-not-found, unused-ignore]  # noqa: PLC0415
            import numpy as np  # type: ignore[import-not-found, import-untyped, unused-ignore]  # noqa: PLC0415
            import onnxruntime as ort  # type: ignore[import-untyped, import-not-found, unused-ignore]  # noqa: PLC0415

            options = ort.SessionOptions()
            options.intra_op_num_threads = 1
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(path, options, providers=["CPUExecutionProvider"])
            model = SpeakerModel(session, np, fbank, os.path.basename(path))
            probe = (np.sin(np.arange(SAMPLE_RATE * 2) * 0.05) * 6000).astype("<i2").tobytes()   # a two-second test: it loads AND answers
            if model.embed(probe) is None:
                log.warning("speaker model loaded but did not answer; no speaker check")
                model = None
        except Exception as exc:   # noqa: BLE001 - optional: any reason means no speaker check
            log.warning("speaker model not available (%s); no speaker check", type(exc).__name__)
            model = None
        _cache[path] = model
        return model


def new_session_voice(model: SpeakerModel | None) -> SessionVoice | None:
    """A fresh, empty signature for one session (None when there is no model)."""
    if model is None:
        return None
    import numpy as np  # type: ignore[import-not-found, import-untyped, unused-ignore]  # noqa: PLC0415

    return SessionVoice(model, np)
