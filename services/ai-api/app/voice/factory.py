"""Wire the voice adapters from settings (job BD). OFF unless a provider is named; a provider named without its key stops the process at start (like every other adapter), so nothing silently
runs without voice or with the wrong one. Keys come from the environment only."""

# ruff: noqa: E501

from __future__ import annotations

from app.config import ConfigurationError, Settings
from app.voice.ai4bharat import Ai4BharatStt, Ai4BharatTts
from app.voice.bhashini import BhashiniStt, BhashiniTts
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


def build_stt(settings: Settings) -> SpeechToText | None:
    name = settings.voice_stt_provider.strip().lower()
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
