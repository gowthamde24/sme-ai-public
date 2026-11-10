"""The wire protocols the phone line can speak (job 3 phase A): one small record per provider, so `PhoneLine` never names a provider. The events that come in are the same dataclasses for all
(app/telephony/exotel.py: Start, Media, Dtmf, Stop, Mark, Unknown); what differs is how a raw message is read and how audio, a checkpoint and a clear are written.

Exotel and Plivo are here. Vobiz speaks Plivo's protocol (same events, same playAudio / checkpoint / clearAudio, 8, 16 or 24 kHz playback): when its first real call is proven it is another record here
(a few lines), not another line."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.telephony import exotel, plivo


@dataclass(frozen=True)
class WireProtocol:
    name: str
    default_rate: int
    rates: tuple[int, ...]
    parse: Callable[[str | bytes], exotel.Event]
    event_name: Callable[[str], str]
    chunk_bytes: Callable[[int], int]
    media_message: Callable[[str, bytes, int], str]    # (stream id, 16-bit mono PCM, the call's rate)
    mark_message: Callable[[str, str], str]            # (stream id, name): the provider tells us when it has played everything up to here (Exotel: mark, Plivo: checkpoint)
    clear_message: Callable[[str], str]                # (stream id): drop audio that was sent but not played yet (the barge-in)
    valid_out_chunk: Callable[[bytes], bool]
    ends_with_stop_event: bool                         # Exotel sends `stop`; Plivo does not (the socket closes)


EXOTEL = WireProtocol("exotel", exotel.DEFAULT_RATE, exotel.RATES, exotel.parse, exotel.event_name, exotel.chunk_bytes, lambda stream, pcm, rate: exotel.media_message(stream, pcm),
                      exotel.mark_message, exotel.clear_message, exotel.valid_out_chunk, True)
PLIVO = WireProtocol("plivo", plivo.DEFAULT_RATE, plivo.RATES, plivo.parse, plivo.event_name, plivo.chunk_bytes, plivo.media_message, plivo.mark_message, plivo.clear_message, plivo.valid_out_chunk, False)

PROTOCOLS: dict[str, WireProtocol] = {"exotel": EXOTEL, "plivo": PLIVO}
