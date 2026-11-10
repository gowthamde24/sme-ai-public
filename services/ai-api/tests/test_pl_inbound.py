"""Inbound calls on a Plivo number (job 3 phase A, 10 Nov 2026). Fakes only: no network, no key, no audio engine, no real token.

Proven: Plivo's request is believed only through its V3 signature (a wrong or missing one is a plain 403 and nothing else is read); a call is answered with the <Stream> XML and a per-call token only when the line is a PLIVO
line of a workspace, answers inbound calls, the caller is on the sandbox list and the gate says yes (every other call is answered with <Hangup/>); the socket needs the token for THIS call and the answer request's admission,
and a replay is refused; a whole call runs through the real call session with the Plivo simulator on the other end (no `stop` event: the socket closing ends it), the row is begun as a Plivo call and finished, and the log
carries no phone number and no word of the caller; the barge-in sends clearAudio. Exotel's own tests stay as they were."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from types import SimpleNamespace
from typing import Any, cast

from app.browser_voice.audio import OUT_RATE
from app.browser_voice.limits import Limits
from app.telephony import gate, inbound, plivo_signature
from app.telephony.inbound_routes import InboundService
from app.telephony.line import PhoneLine
from app.telephony.pcm import tone
from app.telephony.plivo_routes import BOOK, Admission, PlivoConfig, handle
from app.telephony.simulator import QueueWire, SimulatedPlivo
from app.telephony.wire import PLIVO
from tests.fakes import make_client
from tests.test_dv_browser_voice import arun, until
from tests.test_ph_inbound import FakeStore, fake_parts

TOKEN = "plivo-auth-token-for-tests-only-0123456789"
BASE = "https://api.example.test"
OWNER = "+919502380998"
LINE = "+918065590129"
TENANT = uuid.UUID(int=0x0B0E)
CALL = "11111111-2222-3333-4444-555555555555"
PLIVO_LINE = {"tenant_id": str(TENANT), "inbound_on": True, "provider": "plivo", "account_ref": None, "external_ref": None, "business": "Stack19 Owner Test", "assistant": None}


def service(*, mode: str = "sandbox", line: dict[str, Any] | None = None, numbers: frozenset[str] = frozenset({OWNER}), store: FakeStore | None = None, plivo_on: bool = True) -> InboundService:
    return InboundService(secret=b"", public_base=BASE, gate_settings=gate.Settings(mode=mode, sandbox_numbers=numbers, max_concurrent=2, outbound=False),  # type: ignore[arg-type]
                          store=cast(Any, store or FakeStore(line=line if line is not None else PLIVO_LINE)), calls=None, cost_paise_per_minute=100, language="en", business="Stack19 Owner Test", max_call_s=20,
                          parts_for=fake_parts, plivo=PlivoConfig(auth_token=TOKEN, public_base=BASE) if plivo_on else None)


def signed(path: str, params: dict[str, str], *, token: str = TOKEN, nonce: str = "n-1") -> dict[str, str]:
    return {"x-plivo-signature-v3": plivo_signature.sign(token, "POST", BASE + path, nonce, params), "x-plivo-signature-v3-nonce": nonce}


ANSWER = "/v1/telephony/plivo/answer"


def ring(**over: str) -> dict[str, str]:
    return {"CallUUID": CALL, "From": "919502380998", "To": "918065590129", "Direction": "inbound", "CallStatus": "ringing", "Event": "StartApp", **over}


class Capture(logging.Handler):
    """Collects log messages (to prove what is, and is not, written)."""

    def __init__(self) -> None:
        super().__init__()
        self.records: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record.getMessage())


def post(client: Any, path: str, params: dict[str, str], headers: dict[str, str] | None = None) -> Any:
    return client.post(path, data=params, headers=headers if headers is not None else signed(path, params))


def _client(svc: InboundService | None) -> Any:
    client, _ = make_client(phone_inbound=svc)
    return client


# ---------------------------------------------------------------------------------------------------------------------------------- the signed answer
def test_a_signed_request_for_a_plivo_line_is_answered_with_the_stream_and_a_token_for_this_call() -> None:
    BOOK._items.clear()
    r = post(_client(service()), ANSWER, ring())
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/xml"), r.text
    assert 'bidirectional="true"' in r.text and 'keepCallAlive="true"' in r.text and 'contentType="audio/x-l16;rate=8000"' in r.text
    ws = r.text.split(">wss://", 1)[1].split("<", 1)[0]
    assert ws.startswith("api.example.test/v1/telephony/plivo/stream/") and "?" not in ws, "the token in the path, nothing else"
    token = ws.rsplit("/", 1)[1]
    secret = PlivoConfig(auth_token=TOKEN, public_base=BASE).ws_secret()
    assert inbound.verify(secret, token, inbound.monotonic(), CALL) and not inbound.verify(secret, token, inbound.monotonic(), "another-call"), "bound to this call"
    assert "919502380998" not in r.text and "8065590129" not in r.text and OWNER not in r.text, "no number in the XML (the hosting logs the stream address)"
    assert 'statusCallbackUrl="https://api.example.test/v1/telephony/plivo/stream-status"' in r.text
    assert CALL in BOOK._items and BOOK._items[CALL].tenant_id == TENANT


def test_a_wrong_missing_or_foreign_signature_is_a_plain_403_and_nothing_is_read() -> None:
    BOOK._items.clear()
    client = _client(service())
    store_calls_before = len(cast(FakeStore, service().store).asked)
    assert store_calls_before == 0
    for headers in ({}, signed(ANSWER, ring(), token="another-token"), signed(ANSWER, ring(), nonce="n-2") | {"x-plivo-signature-v3-nonce": "n-3"}, {"x-plivo-signature-v3": "AAAA", "x-plivo-signature-v3-nonce": "n-1"}):
        r = client.post(ANSWER, data=ring(), headers=headers)
        assert r.status_code == 403 and r.json()["error"]["code"] == "unauthorized", headers
    altered = ring()
    sig = signed(ANSWER, altered)
    assert client.post(ANSWER, data={**altered, "From": "919000000001"}, headers=sig).status_code == 403, "a field changed after signing"
    assert BOOK._items == {}, "a refused request admits nothing"


def test_the_plivo_addresses_answer_off_where_plivo_is_not_configured() -> None:
    client = _client(service(plivo_on=False))
    assert post(client, ANSWER, ring()).status_code == 404
    assert _client(None).post(ANSWER, data=ring()).status_code == 404


def test_a_call_we_do_not_take_is_answered_with_hangup_and_admits_nothing() -> None:
    cases: list[tuple[dict[str, Any], dict[str, str], str]] = [
        (dict(mode="off"), ring(), "telephony_off"),
        (dict(line={}), ring(), "no_such_line"),
        (dict(line={**PLIVO_LINE, "provider": "exotel"}), ring(), "line_not_plivo"),
        (dict(line={**PLIVO_LINE, "inbound_on": False}), ring(), "inbound_off"),
        (dict(), ring(From="919876543210"), "not_on_sandbox_list"),
        (dict(), ring(From="not a number"), "bad_number"),
        (dict(), ring(From=""), "bad_number"),
        (dict(), ring(To="12345"), "bad_number"),
        (dict(), ring(CallUUID=""), "bad_number"),
    ]
    for kw, params, reason in cases:
        BOOK._items.clear()
        handler = Capture()
        records = handler.records
        logging.getLogger("app.telephony.plivo").addHandler(handler)
        logging.getLogger("app.telephony.plivo").setLevel(logging.INFO)
        try:
            r = post(_client(service(**kw)), ANSWER, params)
        finally:
            logging.getLogger("app.telephony.plivo").removeHandler(handler)
        assert r.status_code == 200 and r.text.endswith("<Response><Hangup/></Response>"), (reason, r.text)
        assert BOOK._items == {}, reason
        assert any(f"refused={reason}" in m for m in records), (reason, records)
        assert "9502380998" not in " ".join(records) and "9876543210" not in " ".join(records), "no number in the log"


def test_the_answer_reads_the_signature_with_the_token_of_the_lines_own_account_when_it_has_one() -> None:
    BOOK._items.clear()
    line = {**PLIVO_LINE, "account_ref": "sme-ws-x-plivo-token", "external_ref": "SA2025RK4E639VJFZAMM"}
    svc = service(line=line)
    assert svc.plivo is not None
    svc.plivo.token_for = lambda row: "subaccount-token-0123456789" if row.get("account_ref") == "sme-ws-x-plivo-token" else None
    client = _client(svc)
    assert post(client, ANSWER, ring(), signed(ANSWER, ring(), token="subaccount-token-0123456789")).status_code == 200
    assert post(client, ANSWER, ring(CallUUID="22222222-2222-3333-4444-555555555555"), signed(ANSWER, ring(CallUUID="22222222-2222-3333-4444-555555555555"))).status_code == 403, "the main token does not sign a subaccount's line"


def test_the_hangup_and_stream_status_callbacks_are_signed_and_log_names_and_numbers_only() -> None:
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    logging.getLogger("app.telephony.plivo").addHandler(handler)
    logging.getLogger("app.telephony.plivo").setLevel(logging.INFO)
    try:
        client = _client(service())
        hang = {"CallUUID": CALL, "CallStatus": "completed", "Event": "Hangup", "HangupCauseName": "End Of XML Instructions", "HangupCauseCode": "4010", "HangupSource": "Plivo", "Duration": "38",
                "BillDuration": "60", "From": "919502380998", "To": "918065590129", "Direction": "inbound"}
        assert post(client, "/v1/telephony/plivo/hangup", hang).status_code == 200
        assert client.post("/v1/telephony/plivo/hangup", data=hang, headers=signed("/v1/telephony/plivo/hangup", hang, token="x")).status_code == 403
        status = {"CallUUID": CALL, "Event": "StartStream", "Error": ""}
        assert post(client, "/v1/telephony/plivo/stream-status", status).status_code == 200
        assert client.post("/v1/telephony/plivo/stream-status", data=status).status_code == 403
    finally:
        logging.getLogger("app.telephony.plivo").removeHandler(handler)
    text = " ".join(records)
    assert "End Of XML Instructions" in text and "4010" in text and "StartStream" in text
    assert "9502380998" not in text and "8065590129" not in text and CALL not in text, "no number and no raw call id in the log"


# ---------------------------------------------------------------------------------------------------------------------------------- the socket and a whole call
async def _call(svc: InboundService, token: str, *, admit: bool = True, sim_kw: dict[str, Any] | None = None) -> tuple[SimulatedPlivo, asyncio.Task[None]]:
    BOOK._items.clear()
    if admit:
        BOOK.put(CALL, Admission(LINE, OWNER, TENANT))
    ours, theirs = QueueWire.pair()
    sim = SimulatedPlivo(theirs, **{"pace": 0, "call_id": CALL, **(sim_kw or {})})
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), None, token, ours, open_timeout=2.0))
    await sim.connect()
    return sim, task


def good_token(svc: InboundService, call: str = CALL) -> str:
    assert svc.plivo is not None
    return inbound.mint(svc.plivo.ws_secret(), inbound.monotonic(), call, "")


@arun
async def test_a_call_is_answered_by_the_assistant_recorded_as_plivo_and_ends_when_the_socket_closes() -> None:
    store = FakeStore(line=PLIVO_LINE)
    svc = service(store=store)
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    for name in ("app.telephony.inbound", "app.telephony.plivo"):
        logging.getLogger(name).addHandler(handler)
        logging.getLogger(name).setLevel(logging.INFO)
    try:
        sim, task = await _call(svc, good_token(svc))
        await until(lambda: bool(sim.heard.marks), 5)       # the opening line has played (a checkpoint came after it)
        await sim.speak_for(600)
        await sim.quiet_for(700)
        await until(lambda: len(store.progress) == 1, 5)
        await asyncio.sleep(1.0)
        await sim.hang_up()                                  # Plivo closes the socket: no `stop` message exists
        await asyncio.wait_for(task, 10)
    finally:
        for name in ("app.telephony.inbound", "app.telephony.plivo"):
            logging.getLogger(name).removeHandler(handler)
    assert store.begun == [(TENANT, "en")] and store.providers == ["plivo"], "the row says Plivo"
    assert store.progress[0][1] == CALL, "the provider's call id is kept on the row"
    assert len(store.finished) == 1 and store.finished[0][1].end_reason == "caller_hung_up"
    first = next(t["text"] for t in store.finished[0][1].transcript if t["who"] == "assistant")
    assert "AI" in first, "the first thing said is still that it is an AI"
    assert sim.heard.problems == [], sim.heard.problems
    assert sim.heard.audio_bytes > 0 and sim.heard.marks, "audio went out in Plivo's shape, with checkpoints"
    numbers = svc.last_numbers
    assert numbers is not None and numbers["line_rate"] == 8000 and numbers["out_chunk_bytes"] == 1600 and numbers["events"].get("start") == 1 and "stop" not in numbers["events"]
    assert numbers["end_how"] == "socket_closed" and numbers["end"] == "caller_hung_up"
    text = " ".join(records)
    assert "9502380998" not in text and "8065590129" not in text and CALL not in text and "what time" not in text, "no number, no raw call id, no word of the caller in the log"
    assert CALL not in json.dumps(numbers), "and none in the numbers of the call"
    assert "plivo_inbound admitted" in text and "exotel_inbound" not in text, "the log names the provider that called"
    assert "playedStream" in numbers["events"] and numbers["events"].get("other", 0) == 0, "Plivo's camelCase events are counted by name, not as other"


# ---- the line itself, over Plivo's protocol -------------------------------------------------------------------------------------------------------
async def plivo_line(rate: int = 8000) -> tuple[PhoneLine, SimulatedPlivo]:
    ours, theirs = QueueWire.pair()
    sim = SimulatedPlivo(theirs, rate=rate, pace=0)
    line = PhoneLine(ours, proto=PLIVO)
    await sim.connect()
    assert await line.open(2.0) is not None
    return line, sim


async def drain(line: PhoneLine, wait: float = 0.2) -> list[tuple[str, object]]:
    out: list[tuple[str, object]] = []
    while True:
        try:
            out.append(await asyncio.wait_for(line.receive(), wait))
        except TimeoutError:
            return out


@arun
async def test_the_line_learns_the_call_the_rate_and_the_encoding_from_plivos_start_and_has_no_numbers_yet() -> None:
    line, sim = await plivo_line()
    assert line.start is not None and line.start.call_sid == CALL and line.start.stream_sid == "sid-sim-1" and line.rate == 8000 and line.chunk == 1600
    assert line.start.from_number == "" and line.start.to_number == "" and line.start.encoding == "audio/x-l16"
    await sim.close()
    wide, sim16 = await plivo_line(16000)
    assert wide.rate == 16000 and wide.chunk == 3200
    await sim16.close()


@arun
async def test_the_voices_audio_goes_out_in_plivos_shape_in_100_ms_chunks_with_a_checkpoint_after_each_turn() -> None:
    line, sim = await plivo_line()
    await line.send_bytes(tone(300.0, 500, OUT_RATE))
    await line.send_json({"type": "audio_end"})
    await asyncio.sleep(0.8)
    assert sim.heard.problems == [] and sim.heard.audio_bytes > 0
    assert all(len(p) == 1600 for _, p in sim.heard.media), "whole 100 ms chunks at 8 kHz"
    assert sim.heard.marks and sim.heard.marks[0][1] == "turn-1" and sim.heard.order[-1] == "mark", "the checkpoint comes after the last chunk"
    await sim.close()


@arun
async def test_a_stop_sends_clearaudio_for_this_stream_gets_the_ack_and_drops_what_was_waiting() -> None:
    line, sim = await plivo_line()
    await line.send_bytes(tone(300.0, 80, OUT_RATE))   # less than a chunk: waiting
    await line.send_json({"type": "audio_stop"})
    await asyncio.sleep(0.1)
    assert len(sim.heard.clears) == 1 and sim.cleared_acks == 1 and not line.playing() and sim.heard.problems == []
    await line.flush()
    await asyncio.sleep(0.05)
    assert sim.heard.audio_bytes == 0, "nothing of the stopped speech is sent afterwards"
    await sim.close()


@arun
async def test_a_new_reply_sent_the_moment_after_a_clear_goes_out_after_it_in_order() -> None:
    """What the line does when the caller cuts in and the assistant answers at once: clearAudio first, then the new audio. (Whether PLIVO plays audio that arrives within milliseconds of a clear is the staging
    diagnostic's question, docs/runbooks/plivo-inbound.md; this test pins our side of the order.)"""
    line, sim = await plivo_line()
    await line.send_bytes(tone(300.0, 1500, OUT_RATE))
    await asyncio.sleep(0.05)
    await line.send_json({"type": "audio_stop"})
    after_clear = len(sim.heard.media)
    await line.send_bytes(tone(500.0, 400, OUT_RATE))
    await line.send_json({"type": "audio_end"})
    await asyncio.sleep(0.6)
    order = sim.heard.order
    clear_at = order.index("clear")
    assert "media" in order[clear_at + 1 :] and len(sim.heard.media) > after_clear, "new audio follows the clear"
    assert sim.heard.problems == []
    await sim.close()


@arun
async def test_the_caller_talking_over_the_assistant_is_a_barge_in_but_only_while_it_speaks() -> None:
    line, sim = await plivo_line()
    await sim.speak_for(400)
    assert all(k == "bytes" for k, _ in await drain(line)), "no barge-in while the assistant is quiet"
    await line.send_bytes(tone(300.0, 2000, OUT_RATE))
    await sim.speak_for(800)
    assert ("text", {"type": "barge_in", "verify": False}) in await drain(line)
    assert line.interruptions == {"stopped": 1, "ignored": 0}
    await sim.close()


@arun
async def test_a_stop_fades_out_through_a_clear_and_a_short_tail_that_ends_in_silence() -> None:
    import array

    line, sim = await plivo_line(8000)
    await line.send_bytes(tone(300.0, 1000, OUT_RATE))
    await asyncio.sleep(0.2)
    before = len(sim.heard.media)
    await line.send_json({"type": "audio_stop"})
    await asyncio.sleep(0.2)
    tail = b"".join(p for _, p in sim.heard.media[before:])
    assert len(sim.heard.clears) == 1 and tail and line.fade_ms and 40 <= line.fade_ms[0] <= 250
    samples = array.array("h")
    samples.frombytes(tail)
    assert samples[-1] == 0 and max(abs(x) for x in samples[-40:]) < 0.1 * max(abs(x) for x in samples[: len(samples) // 4])
    await sim.close()


@arun
async def test_the_socket_closing_is_the_caller_hanging_up_there_is_no_stop_message() -> None:
    line, sim = await plivo_line()
    await sim.hang_up()
    seen = await drain(line, 0.5)
    assert ("close", None) in seen and line.closed() and line.end_reason == "caller_hung_up" and line.end_how == "socket_closed" and "stop" not in line.events


@arun
async def test_a_key_press_is_an_event_for_the_session() -> None:
    line, sim = await plivo_line()
    await sim.press("2")
    assert ("text", {"type": "dtmf", "digit": "2"}) in await drain(line) and line.dtmf == ["2"]
    await sim.close()


@arun
async def test_the_socket_needs_the_token_of_this_call_and_the_answer_requests_admission_and_a_replay_is_refused() -> None:
    svc = service()
    other = good_token(svc, "99999999-2222-3333-4444-555555555555")
    forged = inbound.mint(b"z" * 32, inbound.monotonic(), CALL, "")
    expired = inbound.mint(PlivoConfig(auth_token=TOKEN, public_base=BASE).ws_secret(), inbound.monotonic() - inbound.TOKEN_TTL_S - 5, CALL, "")
    for token, admit in (("", True), ("nonsense", True), (forged, True), (expired, True), (other, True), (good_token(svc), False)):
        store = FakeStore(line=PLIVO_LINE)
        sim, task = await _call(service(store=store), token, admit=admit)
        await asyncio.wait_for(task, 5)
        assert store.begun == [] and not sim.heard.audio_bytes, (token[:6], admit)
    store = FakeStore(line=PLIVO_LINE)
    svc = service(store=store)
    first, task = await _call(svc, good_token(svc))
    await until(lambda: bool(first.heard.media), 5)
    await first.hang_up()
    await asyncio.wait_for(task, 10)
    assert len(store.begun) == 1
    again_store = FakeStore(line=PLIVO_LINE)
    ours, theirs = QueueWire.pair()
    replay = SimulatedPlivo(theirs, pace=0, call_id=CALL)
    task2 = asyncio.ensure_future(handle(service(store=again_store), SimpleNamespace(limits=Limits()), None, good_token(svc), ours, open_timeout=2.0))
    await replay.connect()
    await asyncio.wait_for(task2, 5)
    assert again_store.begun == [] and not replay.heard.audio_bytes, "the admission is used once: the same call id cannot open a second socket"


@arun
async def test_a_stream_in_an_encoding_we_do_not_read_is_refused_before_any_audio() -> None:
    store = FakeStore(line=PLIVO_LINE)
    svc = service(store=store)
    sim, task = await _call(svc, good_token(svc), sim_kw={"encoding": "audio/x-mulaw"})
    await asyncio.wait_for(task, 5)
    assert store.begun == [] and not sim.heard.audio_bytes


@arun
async def test_a_call_over_the_open_line_limit_is_refused_on_the_socket_too() -> None:
    class Busy:
        def count(self) -> int:
            return 2

        def add(self, *a: Any) -> None: ...
        def remove(self, *a: Any) -> None: ...
        def also_known_as(self, *a: Any) -> None: ...

    store = FakeStore(line=PLIVO_LINE)
    svc = service(store=store)
    BOOK._items.clear()
    BOOK.put(CALL, Admission(LINE, OWNER, TENANT))
    ours, theirs = QueueWire.pair()
    sim = SimulatedPlivo(theirs, pace=0, call_id=CALL)
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), Busy(), good_token(svc), ours, open_timeout=2.0))
    await sim.connect()
    await asyncio.wait_for(task, 5)
    assert store.begun == [] and not sim.heard.audio_bytes
