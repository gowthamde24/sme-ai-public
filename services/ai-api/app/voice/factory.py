"""Wire the voice adapters from settings (job BD). OFF unless a provider is named; a provider named without its key stops the process at start (like every other adapter), so nothing silently
runs without voice or with the wrong one. Keys come from the environment only."""

# ruff: noqa: E501

from __future__ import annotations

from app.config import ConfigurationError, Settings
from app.voice.ai4bharat import Ai4BharatStt, Ai4BharatTts
from app.voice.bhashini import BhashiniStt, BhashiniTts
from app.voice.convert import FfmpegConverter
from app.voice.fake import FakeStt, FakeTts
from app.voice.google import GoogleStt, GoogleTts
from app.voice.interface import SpeechToText, TextToSpeech, VoiceStack
from app.voice.sarvam import SarvamStt, SarvamTts

STT_PROVIDERS = ("off", "fake", "sarvam", "bhashini", "google", "ai4bharat")
TTS_PROVIDERS = STT_PROVIDERS


def _secret(value: object) -> str | None:
    getter = getattr(value, "get_secret_value", None)
    text = getter() if getter else None
    return text.strip() if isinstance(text, str) and text.strip() else None


SPEECH_SWITCH = ("", "fake", "sarvam")


def _speech_default(settings: Settings) -> str:
    """The provider the ONE switch SPEECH_PROVIDER names (night 3, ADR 0101); "off" when it is not set. A provider named explicitly in VOICE_STT_PROVIDER / VOICE_TTS_PROVIDER wins over it."""
    switch = settings.speech_provider.strip().lower()
    if switch not in SPEECH_SWITCH:
        raise ConfigurationError("SPEECH_PROVIDER must be empty, fake or sarvam")
    return switch or "off"


def build_stt(settings: Settings) -> SpeechToText | None:
    name = settings.voice_stt_provider.strip().lower()
    if name == "off":
        name = _speech_default(settings)
    if name not in STT_PROVIDERS:
        raise ConfigurationError(f"VOICE_STT_PROVIDER must be one of {', '.join(STT_PROVIDERS)}")
    if name == "off":
        return None
    if name == "fake":
        if not settings.is_development:
            raise ConfigurationError("VOICE_STT_PROVIDER=fake is for development only")
        return FakeStt()
    if name == "sarvam":
        key = _secret(settings.sarvam_api_key)
        if not key:
            raise ConfigurationError("VOICE_STT_PROVIDER=sarvam needs SARVAM_API_KEY")
        return SarvamStt(key, settings.sarvam_stt_model)
    if name == "bhashini":
        key = _secret(settings.bhashini_api_key)
        if not key or not settings.bhashini_asr_service_id:
            raise ConfigurationError(
                "VOICE_STT_PROVIDER=bhashini needs BHASHINI_API_KEY and BHASHINI_ASR_SERVICE_ID"
            )
        return BhashiniStt(key, settings.bhashini_asr_service_id.strip())
    if name == "google":
        key = _secret(settings.google_api_key)
        if not key:
            raise ConfigurationError("VOICE_STT_PROVIDER=google needs GOOGLE_API_KEY")
        return GoogleStt(key)
    if not settings.ai4bharat_stt_url:
        raise ConfigurationError("VOICE_STT_PROVIDER=ai4bharat needs AI4BHARAT_STT_URL")
    try:
        return Ai4BharatStt(settings.ai4bharat_stt_url.strip(), _secret(settings.ai4bharat_token))
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


def build_tts(settings: Settings) -> TextToSpeech | None:
    name = settings.voice_tts_provider.strip().lower()
    if name == "off":
        name = _speech_default(settings)
    if name not in TTS_PROVIDERS:
        raise ConfigurationError(f"VOICE_TTS_PROVIDER must be one of {', '.join(TTS_PROVIDERS)}")
    if name == "off":
        return None
    if name == "fake":
        if not settings.is_development:
            raise ConfigurationError("VOICE_TTS_PROVIDER=fake is for development only")
        return FakeTts()
    if name == "sarvam":
        key = _secret(settings.sarvam_api_key)
        if not key:
            raise ConfigurationError("VOICE_TTS_PROVIDER=sarvam needs SARVAM_API_KEY")
        return SarvamTts(key, settings.sarvam_tts_model, settings.sarvam_tts_speaker)
    if name == "bhashini":
        key = _secret(settings.bhashini_api_key)
        if not key or not settings.bhashini_tts_service_id:
            raise ConfigurationError(
                "VOICE_TTS_PROVIDER=bhashini needs BHASHINI_API_KEY and BHASHINI_TTS_SERVICE_ID"
            )
        return BhashiniTts(key, settings.bhashini_tts_service_id.strip())
    if name == "google":
        key = _secret(settings.google_api_key)
        if not key:
            raise ConfigurationError("VOICE_TTS_PROVIDER=google needs GOOGLE_API_KEY")
        return GoogleTts(key)
    if not settings.ai4bharat_tts_url:
        raise ConfigurationError("VOICE_TTS_PROVIDER=ai4bharat needs AI4BHARAT_TTS_URL")
    try:
        return Ai4BharatTts(settings.ai4bharat_tts_url.strip(), _secret(settings.ai4bharat_token))
    except ValueError as exc:
        raise ConfigurationError(str(exc)) from None


NOTE_PROVIDERS = ("auto", "off", "fake", "sarvam")


def build_note_voice(settings: Settings) -> tuple[TextToSpeech | None, FfmpegConverter | None]:
    """The speech and the coder of WhatsApp voice notes (job DJ, ADR 0093): (text-to-speech, converter to OGG/Opus), either may be None.

    A provider that makes real speech (Sarvam) is always paired with the converter, and the process stops at start when ffmpeg is not there: a voice note that WhatsApp cannot play would be sent as text only,
    silently, for ever. The fake provider needs no converter. With nothing configured outside development there is no speech at all and every message goes as text."""
    name = settings.voice_note_tts_provider.strip().lower()
    if name not in NOTE_PROVIDERS:
        raise ConfigurationError(f"VOICE_NOTE_TTS_PROVIDER must be one of {', '.join(NOTE_PROVIDERS)}")
    key = _secret(settings.sarvam_api_key)
    if name == "auto" and _speech_default(settings) != "off":
        name = _speech_default(settings)   # the one switch decides, key or no key (SPEECH_PROVIDER=fake keeps a staging worker with a key silent)
    if name == "auto":
        if key:
            name = "sarvam"
        elif settings.voice_tts_provider.strip().lower() not in ("off", ""):
            return build_tts(settings), _converter_for(settings, build_tts(settings))
        else:
            name = "fake" if settings.is_development else "off"
    if name == "off":
        return None, None
    if name == "fake":
        if not settings.is_development:
            raise ConfigurationError("VOICE_NOTE_TTS_PROVIDER=fake is for development only")
        return FakeTts(), None
    if not key:
        raise ConfigurationError("VOICE_NOTE_TTS_PROVIDER=sarvam needs SARVAM_API_KEY")
    tts = SarvamTts(key, settings.sarvam_tts_model, settings.sarvam_tts_speaker)
    return tts, _converter_for(settings, tts)


def _converter_for(settings: Settings, tts: TextToSpeech | None) -> FfmpegConverter | None:
    if tts is None or tts.name == "fake":
        return None
    converter = FfmpegConverter(settings.voice_note_ffmpeg)
    if not converter.available():
        raise ConfigurationError("voice notes with a real speech provider need ffmpeg (VOICE_NOTE_FFMPEG names the program); it is in the API image")
    return converter


def build_voice(settings: Settings) -> VoiceStack | None:
    """None when voice is off (no provider named): the route then answers 503 voice_unavailable."""
    stt, tts = build_stt(settings), build_tts(settings)
    if stt is None:
        if tts is not None:
            raise ConfigurationError(
                "VOICE_TTS_PROVIDER is set but VOICE_STT_PROVIDER is off: voice needs speech-to-text"
            )
        return None
    return VoiceStack(stt=stt, tts=tts)
