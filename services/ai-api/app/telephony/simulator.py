"""A stand-in for Exotel (job phone-calls part 2): speaks the same Voicebot protocol on the other end of a `PhoneLine`, so a call can be run end to end without an account, in CI and on a laptop. It is a SANDBOX
tool: the scripted caller plays the audio it is given at real time (or faster with `pace`), presses digits, hangs up, and records what the line sent back, with the provider's own chunk rules checked on every message."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import base64
import json
import time
from dataclasses import dataclass, field
from typing import Literal

from app.telephony import exotel
from app.telephony.pcm import tone


class QueueWire:
    """One end of an in-memory connection; `pair()` gives the two ends."""

    def __init__(self, inbox: asyncio.Queue[str | None], outbox: asyncio.Queue[str | None]) -> None:
        self._in, self._out = inbox, outbox

    async def send_text(self, data: str) -> None:
        await self._out.put(data)

    async def receive_text(self) -> str | None:
        return await self._in.get()

    def close(self) -> None:
        self._out.put_nowait(None)

    @staticmethod
    def pair() -> tuple[QueueWire, QueueWire]:
        a: asyncio.Queue[str | None] = asyncio.Queue()
        b: asyncio.Queue[str | None] = asyncio.Queue()
        return QueueWire(a, b), QueueWire(b, a)


Step = tuple[Literal["say", "wait", "dtmf", "hangup"], object]


@dataclass
class Heard:
    """What the line sent to the 'telephone'."""

    media: list[tuple[float, bytes]] = field(default_factory=list)
    marks: list[tuple[float, str]] = field(default_factory=list)
    clears: list[float] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)   # chunk rule violations and the like

    @property
    def audio_bytes(self) -> int:
        return sum(len(p) for _, p in self.media)


class SimulatedExotel:
    """Plays the telephone side. `wire` is the end the test keeps; the line gets the other end."""

    def __init__(self, wire: QueueWire, *, rate: int = 16000, call_sid: str = "CAsim0001", stream_sid: str = "XPsim0001", from_number: str = "+919876543210", to_number: str = "+918000000000",
                 custom: dict[str, str] | None = None, pace: float = 1.0) -> None:
        self._wire, self.rate, self.pace = wire, rate, pace
        self._start = {"event": "start", "sequence_number": 1, "stream_sid": stream_sid, "start": {"stream_sid": stream_sid, "call_sid": call_sid, "account_sid": "sim", "from": from_number, "to": to_number,
                       "custom_parameters": custom or {}, "media_format": {"encoding": "raw/slin", "sample_rate": str(rate), "bit_rate": "128kbps"}}}
        self.heard = Heard()
        self._t0 = time.monotonic()
        self._reader: asyncio.Task[None] | None = None

    async def connect(self) -> None:
        await self._wire.send_text(json.dumps({"event": "connected"}))
        await self._wire.send_text(json.dumps(self._start))
        self._t0 = time.monotonic()
        self._reader = asyncio.ensure_future(self._listen())

    async def _listen(self) -> None:
        while True:
            raw = await self._wire.receive_text()
            if raw is None:
                return
            now = time.monotonic() - self._t0
            msg = json.loads(raw)
            event = msg.get("event")
            if event == "media":
                event_obj = exotel.parse(raw)
                if not isinstance(event_obj, exotel.Media):
                    self.heard.problems.append("media that does not decode")
                    continue
                if not exotel.valid_out_chunk(event_obj.pcm) or len(event_obj.pcm) < exotel.MIN_CHUNK:
                    self.heard.problems.append(f"chunk of {len(event_obj.pcm)} bytes")
                self.heard.media.append((now, event_obj.pcm))
            elif event == "mark":
                self.heard.marks.append((now, str(msg.get("mark", {}).get("name", ""))))
            elif event == "clear":
                self.heard.clears.append(now)

    async def say(self, pcm: bytes, *, frame_ms: int = 20) -> None:
        """Send audio the way the provider does: small frames, paced."""
        size = self.rate * 2 * frame_ms // 1000
        for i in range(0, len(pcm), size):
            frame = pcm[i : i + size]
            await self._wire.send_text(json.dumps({"event": "media", "stream_sid": self._start["stream_sid"], "media": {"chunk": i // size, "timestamp": str(i // size * frame_ms), "payload": base64.b64encode(frame).decode()}}))
            if self.pace:
                await asyncio.sleep(frame_ms / 1000 * self.pace)

    async def speak_for(self, ms: int, freq: float = 220.0) -> None:
        await self.say(tone(freq, ms, self.rate, amplitude=0.4))

    async def quiet_for(self, ms: int) -> None:
        await self.say(b"\x00\x00" * (self.rate * ms // 1000))

    async def press(self, digit: str) -> None:
        await self._wire.send_text(json.dumps({"event": "dtmf", "stream_sid": self._start["stream_sid"], "dtmf": {"digit": digit, "duration": "200"}}))

    async def hang_up(self, reason: str = "callended") -> None:
        await self._wire.send_text(json.dumps({"event": "stop", "stream_sid": self._start["stream_sid"], "stop": {"call_sid": self._start["start"]["call_sid"], "reason": reason}}))  # type: ignore[index]

    async def run(self, script: list[Step]) -> None:
        for what, arg in script:
            if what == "say":
                await self.say(arg if isinstance(arg, bytes) else tone(220.0, int(arg), self.rate, 0.4))  # type: ignore[call-overload]
            elif what == "wait":
                await self.quiet_for(int(arg))  # type: ignore[call-overload]
            elif what == "dtmf":
                await self.press(str(arg))
            elif what == "hangup":
                await self.hang_up()

    async def close(self) -> None:
        self._wire.close()
        if self._reader is not None:
            self._reader.cancel()
