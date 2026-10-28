"""The voices of a call (job natural-voice, job voice-picker; owner decisions of 28 Oct 2026): the CATALOGUE of voices a workspace owner may choose from, per language, with the default of each language and a Bulbul v4
Flash fallback voice of the SAME gender behind every Cartesia voice. All from data (data/voices.json, or any file given to `load_config`), never hard-coded, so a voice can be added, removed or swapped without code.

A workspace's choice (one voice id per language, in the database) is resolved here: the chosen voice if it is in the catalogue for that language, else the language's default. Pure: loads and checks a file; no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.voice.interface import VoiceError

ENGINES: tuple[str, ...] = ("cartesia", "sarvam_v4")
CALL_LANGUAGES: tuple[str, ...] = ("te", "hi", "kn", "en")
GENDERS: tuple[str, ...] = ("female", "male")
DATA = Path(__file__).resolve().parent / "data"
DEFAULT_FILE = DATA / "voices.json"
SAMPLES = DATA / "samples"

# The words of every pre-rendered listening sample (scripts/voice_catalogue_samples.py renders them; GET /voices shows them as `sample_text`). No person's name: the voice says it is the assistant of a neutral business, and
# the lines avoid verbs that carry a gender, so the same words suit a woman's voice and a man's.
SAMPLE_BUSINESS = "Sample Stores"
SAMPLE_LINES: dict[str, str] = {
    "te": "నమస్కారం అండీ, నేను {b} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం అండీ, check చేసి చెప్తాను. సాయంత్రం ఆరు గంటలకి call చేయనా?",
    "hi": "नमस्ते जी, यह {b} की तरफ़ से कॉल है। एक मिनट जी, check करके बताते हैं। शाम छह बजे call करें?",
    "kn": "ನಮಸ್ಕಾರ ಸರ್, ನಾನು {b} ನಿಂದ ಮಾತಾಡ್ತಾ ಇದ್ದೀನಿ. ಒಂದು ನಿಮಿಷ ಸರ್, ನೋಡಿ ಹೇಳ್ತೀನಿ. ಸಂಜೆ ಆರು ಗಂಟೆಗೆ call ಮಾಡ್ಲಾ?",
    "en": "Hello, this is the assistant from {b}. One moment, I'll check and tell you. Shall I call you after six?",
}


def sample_text(language: str) -> str:
    """The exact words of the pre-rendered sample of a voice of this language."""
    return SAMPLE_LINES[language].replace("{b}", SAMPLE_BUSINESS)
LOWEST_TIMEOUT_MS, HIGHEST_TIMEOUT_MS = 200, 3000
ID_FORMAT = re.compile(r"^[a-z]{2}-[a-z0-9_]{2,40}$")  # the same pattern the database holds


@dataclass(frozen=True)
class VoiceChoice:
    engine: str  # one of ENGINES
    model: str
    voice: str  # the provider's own id or name for the voice
    label: str = ""  # for people reading logs and reports; never used to pick
    gender: str = ""  # set on a fallback: it must equal its catalogue entry's gender


@dataclass(frozen=True)
class LanguageVoices:
    primary: VoiceChoice
    fallback: VoiceChoice


@dataclass(frozen=True)
class CatalogueVoice:
    id: str  # '<language>-<name>', what the workspace setting stores
    language: str
    name: str
    label: str  # "Calm", "Cheerful", "Male": plain words for the screen
    gender: str
    default: bool
    voices: LanguageVoices

    @property
    def sample_file(self) -> Path:
        return SAMPLES / f"{self.id}.mp3"


@dataclass(frozen=True)
class VoiceConfig:
    catalogue: dict[str, CatalogueVoice]
    first_audio_timeout_ms: int = 800  # no audio by then: the fallback speaks
    cooldown_s: float = 30.0  # after a primary failure, go straight to the fallback for this long (so a bad minute does not cost 800 ms on every sentence)

    @property
    def languages(self) -> dict[str, LanguageVoices]:
        """The default voices per language."""
        return {c.language: c.voices for c in self.catalogue.values() if c.default}

    def voices_of(self, language: str) -> list[CatalogueVoice]:
        """The catalogue of a language, the default first."""
        return sorted((c for c in self.catalogue.values() if c.language == language), key=lambda c: (not c.default, c.name))

    def default_for(self, language: str) -> CatalogueVoice:
        for c in self.catalogue.values():
            if c.language == language and c.default:
                return c
        raise VoiceError("unsupported_language")

    def resolve(self, language: str, chosen_id: str | None = None) -> CatalogueVoice:
        """The voice that speaks `language`: the workspace's choice when it is a catalogue voice OF THAT LANGUAGE, else the default (an id that was removed from the catalogue, or is stale, is ignored)."""
        picked = self.catalogue.get(chosen_id) if chosen_id else None
        return picked if picked is not None and picked.language == language else self.default_for(language)

    def for_language(self, language: str, chosen_id: str | None = None) -> LanguageVoices:
        return self.resolve(language, chosen_id).voices


def _choice(raw: object, where: str, *, fallback: bool = False) -> VoiceChoice:
    if not isinstance(raw, dict):
        raise ValueError(f"{where}: not an object")
    engine, model, voice = raw.get("engine"), raw.get("model"), raw.get("voice")
    if engine not in ENGINES:
        raise ValueError(f"{where}: engine must be one of {ENGINES}")
    if not isinstance(model, str) or not model or not isinstance(voice, str) or not voice:
        raise ValueError(f"{where}: model and voice are required")
    gender = str(raw.get("gender", ""))
    if fallback and gender not in GENDERS:
        raise ValueError(f"{where}: a fallback names its gender ({GENDERS})")
    return VoiceChoice(str(engine), model, voice, str(raw.get("label", "")), gender)


def parse_config(data: object) -> VoiceConfig:
    """Check a loaded file. Every call language has a catalogue with exactly one default; ids are '<language>-<name>' and unique; a fallback is a DIFFERENT engine from its primary and has the SAME gender as the voice it backs up; the timeout is sane."""
    if not isinstance(data, dict) or not isinstance(data.get("catalogue"), list):
        raise ValueError("voices: 'catalogue' is required")
    timeout = int(data.get("first_audio_timeout_ms", 800))
    if not LOWEST_TIMEOUT_MS <= timeout <= HIGHEST_TIMEOUT_MS:
        raise ValueError(f"voices: first_audio_timeout_ms must be {LOWEST_TIMEOUT_MS} to {HIGHEST_TIMEOUT_MS}")
    catalogue: dict[str, CatalogueVoice] = {}
    for raw in data["catalogue"]:
        if not isinstance(raw, dict):
            raise ValueError("voices: an entry is not an object")
        vid, lang = str(raw.get("id", "")), str(raw.get("language", ""))
        where = f"voices[{vid}]"
        if not ID_FORMAT.match(vid) or vid in catalogue:
            raise ValueError(f"{where}: the id must be '<language>-<name>' (lower case) and unique")
        if lang not in CALL_LANGUAGES or vid[:2] != lang:
            raise ValueError(f"{where}: the language must be one of {CALL_LANGUAGES} and the id must start with it")
        gender, label, name = str(raw.get("gender", "")), str(raw.get("label", "")), str(raw.get("name", ""))
        if gender not in GENDERS or not 0 < len(label) <= 20 or not name:
            raise ValueError(f"{where}: name, a label of at most 20 characters and a gender ({GENDERS}) are required")
        primary, fallback = _choice(raw.get("primary"), f"{where}.primary"), _choice(raw.get("fallback"), f"{where}.fallback", fallback=True)
        if primary.engine == fallback.engine:
            raise ValueError(f"{where}: the fallback must be a different engine from the primary")
        if fallback.gender != gender:
            raise ValueError(f"{where}: the fallback voice must be the same gender as the voice")
        catalogue[vid] = CatalogueVoice(vid, lang, name, label, gender, bool(raw.get("default", False)), LanguageVoices(primary, fallback))
    for lang in CALL_LANGUAGES:
        defaults = [c for c in catalogue.values() if c.language == lang and c.default]
        if len(defaults) != 1:
            raise ValueError(f"voices: language {lang} needs exactly one default (has {len(defaults)})")
    return VoiceConfig(catalogue, timeout, float(data.get("cooldown_s", 30.0)))


def load_config(path: str | Path | None = None) -> VoiceConfig:
    return parse_config(json.loads(Path(path or DEFAULT_FILE).read_text(encoding="utf-8")))


@lru_cache(maxsize=1)
def default_config() -> VoiceConfig:
    return load_config()
