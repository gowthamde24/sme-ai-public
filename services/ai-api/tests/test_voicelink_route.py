"""The VoiceLink WebSocket-bot route (24 Nov 2026) against a FAKE VoiceLink server that speaks the documented messages: the address token, the admission steps, a whole call through the real call session recorded as a VoiceLink call, and the refusals. No network, no key, no number of a person."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

from app.browser_voice.limits import Limits
from app.telephony import gate
from app.telephony.inbound_routes import InboundService
from app.telephony.simulator import QueueWire, SimulatedVoicelink
from app.telephony.voicelink_routes import VoicelinkConfig, admit, handle
from tests.test_dv_browser_voice import arun, until
from tests.test_ph_inbound import FakeStore, fake_parts

TOKEN = "voicelink-bot-address-token-for-tests-0123456789abcdef"
OWNER = "+919000000998"
LINE = "+918065590140"
TENANT = uuid.UUID(int=0x0B0E)
CALL = "vl-call-0001"
VL_LINE = {"tenant_id": str(TENANT), "inbound_on": True, "provider": "voicelink", "account_ref": None, "external_ref": None, "business": "Stack19 Owner Test", "assistant": None}


def service(*, mode: str = "sandbox", line: dict[str, Any] | None = None, numbers: frozenset[str] = frozenset({OWNER}), store: FakeStore | None = None, on: bool = True) -> InboundService:
    return InboundService(secret=b"", public_base="https://api.example.test", gate_settings=gate.Settings(mode=mode, sandbox_numbers=numbers, max_concurrent=2, outbound=False),  # type: ignore[arg-type]
                          store=cast(Any, store or FakeStore(line=line if line is not None else VL_LINE)), calls=None, cost_paise_per_minute=100, language="en", business="Stack19 Owner Test", max_call_s=20,
                          parts_for=fake_parts, voicelink=VoicelinkConfig(ws_token=TOKEN) if on else None)


async def _call(svc: InboundService, token: str, **sim: Any) -> tuple[SimulatedVoicelink, asyncio.Task[None]]:
    ours, theirs = QueueWire.pair()
    simulated = SimulatedVoicelink(theirs, **{"pace": 0, "call_id": CALL, "caller": OWNER, "to": LINE, **sim})
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), None, token, ours, open_timeout=2.0))
    await simulated.connect()
    return simulated, task


class Busy:
    def count(self) -> int:
        return 9


def test_the_token_is_a_long_secret_compared_in_constant_time() -> None:
    cfg = VoicelinkConfig(ws_token=TOKEN)
    assert cfg.accepts(TOKEN) and not cfg.accepts(TOKEN[:-1]) and not cfg.accepts("") and not cfg.accepts(TOKEN + "x")
    assert not VoicelinkConfig(ws_token="short").accepts("short"), "a token shorter than 32 characters is never accepted"


@arun
async def test_the_admission_steps_each_have_their_closed_word() -> None:
    now = datetime.now(UTC)
    start = SimpleNamespace(from_number=OWNER, to_number=LINE)

    async def run(settings: gate.Settings, line: dict[str, Any] | None, active: int = 0, st: Any = start) -> Any:
        return await admit(st, settings, find_line=FakeStore(line=line).line_find, active_calls=active, now=now)

    sandbox = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), max_concurrent=2, outbound=False)
    ok = await run(sandbox, VL_LINE)
    assert ok.tenant_id == TENANT and ok.rule == "voicelink_token"
    assert (await run(gate.Settings(mode="off", sandbox_numbers=frozenset(), max_concurrent=2, outbound=False), VL_LINE)).reason == "telephony_off"
    assert (await run(sandbox, VL_LINE, st=SimpleNamespace(from_number="+919000000001", to_number=LINE))).reason == "not_on_sandbox_list"
    assert (await run(sandbox, None)).reason == "no_such_line"
    assert (await run(sandbox, {**VL_LINE, "provider": "plivo"})).reason == "no_such_line", "another provider's line is not ours to answer on this route"
    assert (await run(sandbox, VL_LINE, st=SimpleNamespace(from_number="abc", to_number=LINE))).reason == "bad_number"
    assert (await run(sandbox, {**VL_LINE, "inbound_on": False})).reason != ""


@arun
async def test_a_whole_call_is_answered_recorded_as_voicelink_and_ends_with_the_stop_event() -> None:
    store = FakeStore(line=VL_LINE)
    svc = service(store=store)
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    for name in ("app.telephony.inbound", "app.telephony.voicelink"):
        logging.getLogger(name).addHandler(handler)
        logging.getLogger(name).setLevel(logging.INFO)
    try:
        sim, task = await _call(svc, TOKEN)
        await until(lambda: bool(sim.heard.marks), 5)       # the opening line has played (a mark came after it)
        await sim.speak_for(600)
        await sim.quiet_for(700)
        await until(lambda: len(store.progress) == 1, 5)
        await asyncio.sleep(1.0)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        for name in ("app.telephony.inbound", "app.telephony.voicelink"):
            logging.getLogger(name).removeHandler(handler)
    assert store.providers == ["voicelink"] and store.begun == [(TENANT, "en")], "the row says VoiceLink"
    assert store.progress[0][1] == CALL and len(store.finished) == 1
    first = next(t["text"] for t in store.finished[0][1].transcript if t["who"] == "assistant")
    assert "AI" in first, "the first thing said is still that it is an AI"
    assert sim.heard.problems == [], sim.heard.problems
    assert sim.heard.audio_bytes > 0 and sim.heard.marks
    text = " ".join(records)
    assert "9000000998" not in text and "8065590140" not in text and CALL not in text and TOKEN not in text, "no number, no raw call id, not the address token in the log"
    assert "voicelink_inbound admitted" in text and "exotel_inbound" not in text


@arun
async def test_a_wrong_token_or_a_switched_off_route_closes_before_anything_is_read() -> None:
    for svc, token in ((service(), "wrong-" + TOKEN), (service(on=False), TOKEN), (service(), "")):
        sim, task = await _call(svc, token)
        await asyncio.wait_for(task, 5)
        assert sim.heard.audio_bytes == 0 and not sim.heard.marks
    store = FakeStore(line=VL_LINE)
    sim, task = await _call(service(store=store), TOKEN)
    await sim.close()
    await asyncio.wait_for(task, 10)


@arun
async def test_refusals_never_start_a_call_a_call_we_placed_is_not_built_yet_and_a_busy_line_is_refused() -> None:
    cases: list[tuple[InboundService, dict[str, Any], Any]] = [
        (service(store=FakeStore(line=None)), {}, None),                                   # not one of our lines
        (service(), {"encoding": "audio/x-l16"}, None),                                   # a codec we do not read
        (service(), {"custom": {"call": "1234", "tenant": str(TENANT)}}, None),           # a call we placed: outbound is not built
        (service(), {"caller": "+919000000001"}, None),                                   # not on the sandbox list
        (service(), {}, Busy()),                                                          # over the open-line limit
    ]
    for svc, kw, live in cases:
        store = svc.store
        ours, theirs = QueueWire.pair()
        sim = SimulatedVoicelink(theirs, **{"pace": 0, "call_id": CALL, "caller": OWNER, "to": LINE, **kw})
        task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), live, TOKEN, ours, open_timeout=2.0))
        await sim.connect()
        await asyncio.wait_for(task, 10)
        assert getattr(store, "begun", []) == [], kw
        assert sim.heard.audio_bytes == 0, kw


def test_the_webhook_shape_line_holds_field_names_only() -> None:
    from app.telephony.voicelink_routes import _shape

    text = _shape({"event": "call.ended", "data": {"call_id": "1764.5", "caller": "+919876543210", "status": "ANSWER"}, "custom parameters": "x", "zz": 1})
    assert text == "custom_parameters,data{call_id,caller,status},event,zz" or text == "customparameters,data{call_id,caller,status},event,zz"
    assert "1764" not in text and "9876" not in text and "ANSWER" not in text and "call.ended" not in text


@arun
async def test_a_socket_that_closes_before_the_start_event_is_logged_with_the_events_it_sent() -> None:
    """28 Nov 2026: VoiceLink opened the bot and closed it within milliseconds (a reachability test looks like this): the line says which events came first (names and counts only)."""
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    logging.getLogger("app.telephony.voicelink").addHandler(handler)
    logging.getLogger("app.telephony.voicelink").setLevel(logging.INFO)
    try:
        ours, theirs = QueueWire.pair()
        theirs.close()
        await handle(service(), SimpleNamespace(limits=Limits()), None, TOKEN, ours, open_timeout=2.0)
    finally:
        logging.getLogger("app.telephony.voicelink").removeHandler(handler)
    text = " ".join(records)
    assert "voicelink_inbound refused=no_start end_how=socket_closed events=none" in text
