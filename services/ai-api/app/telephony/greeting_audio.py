"""The opening line, already spoken (owner, 6 Nov 2026: "first sound within 1.5 s of pickup"). The greeting a real call speaks is kept (per language and wording) in this process and played
from memory, with no wait for the voice engine, the moment the NEXT call is admitted. Nothing is rendered just to fill the cache (owner, 6 Nov 2026: Cartesia credits are spent only on real calls). Exotel's connection is kept warm with a free account read; the voice engine is never pinged (it would bill, and each call opens its own client).

Nothing here sends audio to anyone: it only prepares it. The line plays it only after the call is admitted."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from typing import Any

from app.browser_voice.audio import OUT_RATE

log = logging.getLogger("app.telephony.greeting_audio")
MAX_ENTRIES = 64
WARM_NUMBER = "+910000000000"
KEEP_WARM_S = 60.0   # (owner's test call, 6 Nov 2026: after 4 idle minutes the database path took 11 s; every minute keeps it, and the sign-in, warm)


def strip_wav(pcm: bytes) -> bytes:
    """Raw 16-bit PCM only: a WAV header (RIFF ... data <size>) is dropped, so the line never plays a header as noise."""
    if pcm[:4] != b"RIFF" or pcm[8:12] != b"WAVE":
        return pcm
    at = pcm.find(b"data", 12)
    return pcm[at + 8:] if at >= 0 else pcm


class GreetingAudio:
    def __init__(self, *, max_entries: int = MAX_ENTRIES) -> None:
        self._cache: OrderedDict[str, bytes] = OrderedDict()
        self._max = max_entries
        self._rendering: dict[str, asyncio.Future[bytes | None]] = {}

    @staticmethod
    def key(language: str, text: str) -> str:
        return hashlib.sha256(f"{language}|{text}".encode()).hexdigest()

    def get(self, language: str, text: str) -> bytes | None:
        """The rendered audio, or None (then the line speaks it the usual way)."""
        k = self.key(language, text)
        pcm = self._cache.get(k)
        if pcm is not None:
            self._cache.move_to_end(k)
        return pcm

    def keep(self, language: str, text: str, pcm: bytes, *, rate: int, engine: str = "") -> bool:
        """Keep audio a real call has just spoken (no extra voice request, no extra credits). Only the primary voice at the line's input rate is kept, so a later call never greets in the
        fallback's voice and then answers in the primary's."""
        pcm = strip_wav(pcm)
        if rate != OUT_RATE or not pcm or (engine and engine != "cartesia"):
            return False
        k = self.key(language, text)
        if k not in self._cache:
            self._cache[k] = pcm
            while len(self._cache) > self._max:
                self._cache.popitem(last=False)
            log.info("greeting_kept language=%s bytes=%d", language, len(pcm))
        return True

    def __len__(self) -> int:
        return len(self._cache)

    async def render(self, tts: Any, language: str, text: str, *, timeout_s: float = 8.0) -> bytes | None:
        """Speak `text` once into memory (16-bit PCM at the voice's own rate) and keep it. Two calls asking for the same greeting share one rendering. A failure keeps nothing."""
        k = self.key(language, text)
        hit = self._cache.get(k)
        if hit is not None:
            return hit
        pending = self._rendering.get(k)
        if pending is not None:
            return await asyncio.shield(pending)
        fut: asyncio.Future[bytes | None] = asyncio.get_running_loop().create_future()
        self._rendering[k] = fut
        pcm: bytes | None = None
        try:
            began = time.monotonic()

            async def collect() -> bytes:
                return b"".join([chunk async for chunk in tts.stream(text, language)])

            pcm = await asyncio.wait_for(collect(), timeout_s) or None
            rate = getattr(tts, "sample_rate", OUT_RATE)
            if pcm and rate != OUT_RATE:   # the line resamples from the voice's 24 kHz; a voice at another rate is streamed, never kept
                log.warning("greeting_not_kept language=%s rate=%s", language, rate)
                pcm = None
            if pcm:
                pcm = strip_wav(pcm)
                self._cache[k] = pcm
                while len(self._cache) > self._max:
                    self._cache.popitem(last=False)
                log.info("greeting_rendered language=%s ms=%d bytes=%d", language, round((time.monotonic() - began) * 1000), len(pcm))
        except Exception as exc:  # noqa: BLE001 - not ready: the line speaks it the usual way
            log.warning("greeting_render_failed language=%s %s", language, exc.__class__.__name__)
            pcm = None
        finally:
            if not fut.done():
                fut.set_result(pcm)
            self._rendering.pop(k, None)
        return pcm


GREETINGS = GreetingAudio()


async def prewarm(tts_for: Callable[[str], Any], texts: dict[str, str]) -> int:
    """At start-up: render the given greetings one after another (never several voice requests at once)."""
    made = 0
    for language, text in texts.items():
        if await GREETINGS.render(tts_for(language), language, text) is not None:
            made += 1
    log.info("greetings_prewarmed count=%d of=%d", made, len(texts))
    return made


async def keep_warm(ping: Callable[[], Any], *, every_s: float = KEEP_WARM_S, stop: asyncio.Event | None = None) -> None:
    """Every few minutes, one free request (Exotel's account record), so that connection stays open."""
    while stop is None or not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), every_s) if stop is not None else await asyncio.sleep(every_s)
        except TimeoutError:
            pass
        if stop is not None and stop.is_set():
            return
        try:
            out = ping()
            if asyncio.iscoroutine(out):
                await out
        except Exception as exc:  # noqa: BLE001 - a missed warm-up costs one slow first word, nothing else
            log.info("keep_warm_failed %s", exc.__class__.__name__)


async def start_warm(service: Any, bv: Any, *, stop: asyncio.Event) -> None:
    """At start-up, in the background (the API answers at once): sign the worker account in, open Exotel's connection; then keep it warm (no voice request: credits only for real calls).
    Only for a process that takes phone calls."""
    principal = getattr(getattr(service, "store", None), "_principal", None)
    if principal is not None:
        try:
            await asyncio.to_thread(principal.token)
        except Exception as exc:  # noqa: BLE001
            log.info("warm_signin_failed %s", exc.__class__.__name__)
    calls = getattr(service, "calls", None)
    if calls is not None:
        try:
            await calls.warm()
        except Exception as exc:  # noqa: BLE001
            log.info("warm_exotel_failed %s", exc.__class__.__name__)
    # owner, 6 Nov 2026: "Don't spend Cartesia credits on anything except real test calls ... no renders, warm-ups or checks". So nothing is rendered here: the first real call streams its
    # greeting as usual and keeps that very audio (GreetingAudio.keep), and every later call plays it from memory.

    store = getattr(service, "store", None)

    async def ping() -> None:
        # Exotel's account record and one tiny database read (the line lookup of a number that is no line: it also refreshes the worker's sign-in when due). Both free. No voice request: every
        # call builds its own voice client, so a synthesis here would cost credits and keep nothing warm.
        if calls is not None:
            await calls.warm()
        if store is not None:
            began = time.monotonic()
            await asyncio.wait_for(asyncio.to_thread(store.line_find, WARM_NUMBER), 10.0)
            ms = round((time.monotonic() - began) * 1000)
            if ms > 1000:
                log.info("keep_warm_db_slow ms=%d", ms)

    await keep_warm(ping, every_s=KEEP_WARM_S, stop=stop)
