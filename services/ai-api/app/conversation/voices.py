"""Which engine and voice speak each language on a call (job natural-voice, owner decision of 28 Oct 2026): Cartesia first, Sarvam Bulbul v4 Flash as the automatic fallback, per language, from DATA (data/voices.json,
or the file named by the CALL_VOICES_FILE setting), never hard-coded, so a voice or an engine can be swapped without touching code.

Pure: loads and checks a file; no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.voice.interface import VoiceError

ENGINES: tuple[str, ...] = ("cartesia", "sarvam_v4")
CALL_LANGUAGES: tuple[str, ...] = ("te", "hi", "kn", "en")
DEFAULT_FILE = Path(__file__).resolve().parent / "data" / "voices.json"
LOWEST_TIMEOUT_MS, HIGHEST_TIMEOUT_MS = 200, 3000


@dataclass(frozen=True)
class VoiceChoice:
    engine: str  # one of ENGINES
    model: str
    voice: str  # the provider's own id or name for the voice
    label: str = ""  # for people reading logs and reports; never used to pick


@dataclass(frozen=True)
class LanguageVoices:
    primary: VoiceChoice
    fallback: VoiceChoice


@dataclass(frozen=True)
class VoiceConfig:
    languages: dict[str, LanguageVoices]
    first_audio_timeout_ms: int = 800  # no audio by then: the fallback speaks
    cooldown_s: float = 30.0  # after a primary failure, go straight to the fallback for this long (so a bad minute does not cost 800 ms on every sentence)

    def for_language(self, language: str) -> LanguageVoices:
        try:
            return self.languages[language]
        except KeyError:
            raise VoiceError("unsupported_language") from None


def _choice(raw: object, where: str) -> VoiceChoice:
    if not isinstance(raw, dict):
        raise ValueError(f"{where}: not an object")
    engine, model, voice = raw.get("engine"), raw.get("model"), raw.get("voice")
    if engine not in ENGINES:
        raise ValueError(f"{where}: engine must be one of {ENGINES}")
    if not isinstance(model, str) or not model or not isinstance(voice, str) or not voice:
        raise ValueError(f"{where}: model and voice are required")
    return VoiceChoice(str(engine), model, voice, str(raw.get("label", "")))


def parse_config(data: object) -> VoiceConfig:
    """Check a loaded file: every call language has a primary and a fallback that are DIFFERENT engines (a fallback on the same engine would fail with it), the timeout is sane."""
    if not isinstance(data, dict) or not isinstance(data.get("languages"), dict):
        raise ValueError("voices: 'languages' is required")
    timeout = int(data.get("first_audio_timeout_ms", 800))
    if not LOWEST_TIMEOUT_MS <= timeout <= HIGHEST_TIMEOUT_MS:
        raise ValueError(f"voices: first_audio_timeout_ms must be {LOWEST_TIMEOUT_MS} to {HIGHEST_TIMEOUT_MS}")
    languages: dict[str, LanguageVoices] = {}
    for lang, raw in data["languages"].items():
        if not isinstance(raw, dict):
            raise ValueError(f"voices.{lang}: not an object")
        primary, fallback = _choice(raw.get("primary"), f"voices.{lang}.primary"), _choice(raw.get("fallback"), f"voices.{lang}.fallback")
        if primary.engine == fallback.engine:
            raise ValueError(f"voices.{lang}: the fallback must be a different engine from the primary")
        languages[lang] = LanguageVoices(primary, fallback)
    missing = [lang for lang in CALL_LANGUAGES if lang not in languages]
    if missing:
        raise ValueError(f"voices: missing languages {missing}")
    return VoiceConfig(languages, timeout, float(data.get("cooldown_s", 30.0)))


def load_config(path: str | Path | None = None) -> VoiceConfig:
    return parse_config(json.loads(Path(path or DEFAULT_FILE).read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def default_config() -> VoiceConfig:
    return load_config()
