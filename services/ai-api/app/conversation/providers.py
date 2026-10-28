"""The real streaming parts of the conversation loop (job natural-voice): Sarvam realtime speech recognition (WebSocket), Sarvam streaming voice (WebSocket), Cartesia Sonic streaming voice (HTTP) and the Anthropic
streaming model (server-sent events). Each takes its key as an argument (the caller reads it from the environment; a key is never logged, never in an error) and speaks the interfaces of types.py.

A provider error is a constant code (`VoiceError`), never the provider's text. Audio and transcripts are never logged here. NOTHING in the tests or in CI imports a real socket: only scripts/voice_latency_live.py and the
explicit bake-off use these classes."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
from collections.abc import AsyncIterator
from urllib.parse import urlencode

import httpx
import websockets

from app.conversation.parts import SttEvent
from app.voice.interface import TAGS, VoiceError

SARVAM_WS = "wss://api.sarvam.ai"
CARTESIA = "https://api.cartesia.ai"
ANTHROPIC = "https://api.anthropic.com/v1/messages"
STT_RATE = 16000


def strip_wav_header(chunk: bytes) -> bytes:
    """A streamed WAV may start with a RIFF header; the loop wants bare PCM."""
    if chunk[:4] == b"RIFF" and b"data" in chunk[:64]:
        return chunk[chunk.index(b"data") + 8 :]
    return chunk


class SarvamRealtimeStt:
    """saaras:v3-realtime / saaras:v4 over `GET /speech-to-text-realtime/ws` (docs.sarvam.ai, Realtime Streaming): 16 kHz linear16 in, `vad.speech_start`, `vad.speech_end`, `transcript.partial`, `transcript.final` out."""

    sample_rate = STT_RATE

    def __init__(self, key: str, *, language: str = "te", model: str = "saaras:v3-realtime", stream_type: str = "fast", silence_ms: int = 350, min_speech_ms: int = 150) -> None:
        self._key, self._language, self._model, self._stream_type, self._silence_ms, self._min_speech_ms = key, language, model, stream_type, silence_ms, min_speech_ms

    def __repr__(self) -> str:
        return f"SarvamRealtimeStt(model={self._model})"

    async def events(self, frames: AsyncIterator[bytes]) -> AsyncIterator[SttEvent]:
        query = urlencode({"language_code": TAGS.get(self._language, "unknown"), "model": self._model, "stream_type": self._stream_type, "silence_duration_ms": self._silence_ms, "min_speech_duration_ms": self._min_speech_ms, "sample_rate": STT_RATE, "encoding": "linear16"})
        try:
            async with websockets.connect(f"{SARVAM_WS}/speech-to-text-realtime/ws?{query}", additional_headers={"api-subscription-key": self._key}, max_size=None) as ws:

                async def send() -> None:
                    async for frame in frames:
                        await ws.send(json.dumps({"event": "audio_input", "audio": base64.b64encode(frame).decode()}))

                sender = asyncio.ensure_future(send())
                try:
                    async for raw in ws:
                        msg = json.loads(raw)
                        name = msg.get("event") or msg.get("type") or ""
                        text = str(msg.get("text") or (msg.get("data") or {}).get("text") or "")
                        if name == "vad.speech_start":
                            yield SttEvent("speech_start")
                        elif name == "vad.speech_end":
                            yield SttEvent("speech_end")
                        elif name == "transcript.partial":
                            yield SttEvent("partial", text)
                        elif name == "transcript.final":
                            yield SttEvent("final", text)
                            return
                        elif name == "error":
                            raise VoiceError(f"stt_{msg.get('code', 'error')}")
                finally:
                    sender.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await sender
        except (OSError, websockets.WebSocketException):
            raise VoiceError("unreachable") from None


class SarvamStreamTts:
    """Bulbul v3 / v4 Flash over `/text-to-speech/ws`. `prewarm()` opens and configures the connection while the model is still thinking; the next `stream()` uses it. No in-band cancel exists, so an interrupted
    piece is stopped by closing the socket (the docs' own barge-in recipe)."""

    sample_rate = 24000

    def __init__(self, key: str, *, speaker: str, language: str = "te", model: str = "bulbul:v4-flash", pace: float = 1.05, min_buffer: int = 30) -> None:
        self._key, self._model, self._speaker, self._pace, self._min_buffer, self._language = key, model, speaker, pace, min_buffer, language
        self._warm: websockets.ClientConnection | None = None
        self._warm_language = ""

    def __repr__(self) -> str:
        return f"SarvamStreamTts(model={self._model})"

    async def _open(self, language: str) -> websockets.ClientConnection:
        ws = await websockets.connect(f"{SARVAM_WS}/text-to-speech/ws?{urlencode({'model': self._model, 'send_completion_event': 'true'})}", additional_headers={"api-subscription-key": self._key}, max_size=None)
        await ws.send(json.dumps({"type": "config", "data": {"speaker": self._speaker, "target_language_code": TAGS.get(language, "en-IN"), "language_code": TAGS.get(language, "en-IN"), "pace": self._pace, "min_buffer_size": self._min_buffer, "max_chunk_length": 150, "output_audio_codec": "linear16", "speech_sample_rate": self.sample_rate}}))
        return ws

    async def prewarm(self) -> None:
        if self._warm is None:
            with contextlib.suppress(OSError, websockets.WebSocketException):
                self._warm, self._warm_language = await self._open(self._language), self._language

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        ws, self._warm = (self._warm, None) if self._warm is not None and self._warm_language == language else (None, self._warm)
        try:
            ws = ws or await self._open(language)
            await ws.send(json.dumps({"type": "text", "data": {"text": text}}))
            await ws.send(json.dumps({"type": "flush"}))
            async for raw in ws:
                msg = json.loads(raw)
                kind = msg.get("type")
                if kind == "audio":
                    chunk = strip_wav_header(base64.b64decode(msg["data"]["audio"]))
                    if chunk:
                        yield chunk
                elif kind == "event" and (msg.get("data") or {}).get("event_type") == "final":
                    return
                elif kind == "error":
                    raise VoiceError("tts_error")
        except (OSError, websockets.WebSocketException):
            raise VoiceError("unreachable") from None
        finally:
            if ws is not None:
                with contextlib.suppress(Exception):
                    await ws.close()


class CartesiaStreamTts:
    """Cartesia Sonic over HTTP: `POST /tts/bytes` streamed (raw 16-bit PCM). One HTTP/2-capable client is kept, so the connection is already open when the first clause arrives."""

    sample_rate = 24000

    def __init__(self, key: str, *, voice_id: str, model: str = "sonic-3.6", client: httpx.AsyncClient | None = None) -> None:
        self._key, self._voice_id, self._model = key, voice_id, model
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))

    def __repr__(self) -> str:
        return f"CartesiaStreamTts(model={self._model})"

    async def prewarm(self) -> None:
        with contextlib.suppress(httpx.HTTPError):
            await self._client.head(CARTESIA)  # opens the TLS connection

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        body = {"model_id": self._model, "transcript": text, "voice": {"mode": "id", "id": self._voice_id}, "language": language, "output_format": {"container": "raw", "encoding": "pcm_s16le", "sample_rate": self.sample_rate}}
        try:
            async with self._client.stream("POST", f"{CARTESIA}/tts/bytes", headers={"X-API-Key": self._key, "Cartesia-Version": "2025-04-16"}, json=body) as resp:
                if resp.status_code != 200:
                    raise VoiceError(f"http_{resp.status_code}")
                carry = b""
                async for chunk in resp.aiter_bytes():
                    data = carry + chunk
                    carry = data[len(data) // 2 * 2 :]
                    if len(data) >= 2:
                        yield data[: len(data) // 2 * 2]
        except httpx.HTTPError:
            raise VoiceError("unreachable") from None


class AnthropicStream:
    """The streaming model: `POST /v1/messages` with `stream: true`, server-sent events; yields the text pieces. Short replies only (`max_tokens`), the prompt carries the spoken-style rules."""

    def __init__(self, key: str, *, max_tokens: int = 160, client: httpx.AsyncClient | None = None) -> None:
        self._key, self._max_tokens = key, max_tokens
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))

    def __repr__(self) -> str:
        return "AnthropicStream()"

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        body = {"model": model, "max_tokens": self._max_tokens, "system": system, "messages": messages, "stream": True}
        try:
            async with self._client.stream("POST", ANTHROPIC, headers={"x-api-key": self._key, "anthropic-version": "2023-06-01"}, json=body) as resp:
                if resp.status_code != 200:
                    raise VoiceError(f"llm_http_{resp.status_code}")
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    event = json.loads(line[5:].strip() or "{}")
                    if event.get("type") == "content_block_delta" and (event.get("delta") or {}).get("type") == "text_delta":
                        yield str(event["delta"]["text"])
        except httpx.HTTPError:
            raise VoiceError("unreachable") from None
