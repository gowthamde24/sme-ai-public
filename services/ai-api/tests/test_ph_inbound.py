"""Inbound calls on the Exotel sandbox (job phone-calls part 5; owner, 4 Nov 2026: inbound ONLY, ONLY from +919502380998, into the Owner Test workspace). Fakes only: no network, no key, no audio engine.

Proven: the per-call token (signed, expires, bound to the call); the Voicebot URL answers a wss address with it, and nothing while inbound is off or for a caller not on the list; before any audio the stream needs a
good token, a caller on the sandbox list, a known line, EXOTEL'S OWN confirmation of the call, and the gate; then a whole call runs through the real call session with the simulator on the other end, the row is
begun and finished, and one log line of numbers (latency p50/p95, turns, duration, cost) is written with no number or word of the caller in it; outbound stays refused."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.browser_voice.limits import Limits
from app.browser_voice.session import Parts
from app.conversation.fakes import FakeLlm, FakeStt, FakeTts
from app.telephony import exotel, gate, inbound, persona
from app.telephony.inbound_routes import InboundService, handle
from app.telephony.outcome import CallOutcome
from app.telephony.simulator import QueueWire, SimulatedExotel
from tests.fakes import make_client
from tests.test_dv_browser_voice import arun, until

SECRET = b"s" * 48
OWNER = "+919502380998"
EXOPHONE = "+919513886363"
TENANT = uuid.UUID(int=0x0B0E)
NOW = 1_800_000_000.0


class FakeCalls:
    """Exotel's call record, as our read-only check sees it."""

    def __init__(self, status: str = "in-progress", from_number: str | None = OWNER) -> None:
        self.status, self.from_number = status, from_number
        self.asked: list[str] = []

    async def get(self, call_sid: str, *, retries_s: tuple[float, ...] = ()) -> inbound.ProviderCall | None:
        self.asked.append(call_sid)
        return inbound.ProviderCall(status=self.status, from_number=self.from_number, to_number=EXOPHONE)


class FakeStore:
    def __init__(self, line: dict[str, Any] | None = None) -> None:
        self.line = line if line is not None else {"tenant_id": str(TENANT), "inbound_on": True}
        self.begun: list[tuple[uuid.UUID, str]] = []
        self.providers: list[str] = []
        self.progress: list[tuple[uuid.UUID, str | None]] = []
        self.finished: list[tuple[uuid.UUID, CallOutcome, float]] = []
        self.asked: list[str] = []

    def line_find(self, number: str) -> dict[str, Any] | None:
        self.asked.append(number)
        return self.line or None

    def begin(self, tenant_id: uuid.UUID, language: str, provider: str = "exotel", refuse_reason: str | None = None, ai_disclosed: bool = True) -> uuid.UUID:
        call = uuid.uuid4()
        self.begun.append((tenant_id, language))
        self.providers.append(provider)
        return call

    def for_call(self, tenant_id: uuid.UUID) -> Any:
        store = self

        class Row:
            def mark_in_progress(self, call_id: uuid.UUID, sid: str | None) -> None:
                store.progress.append((call_id, sid))

            def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None:
                store.finished.append((call_id, outcome, duration_s))

        return Row()


def fake_parts(bv: Any, business: str, language: str, llm_choice: str) -> tuple[Parts, str]:
    return Parts(stt_for=lambda lang: FakeStt("what time do you open?", silence_ms=300), tts=FakeTts(chunks=3, chunk_ms=100), llm=FakeLlm(("We open at nine. ", "Come any time.")),
                 system_for=lambda lang: "system", greeting_for=lambda lang: persona.opening_line(lang, business=business, assistant=None, customer=None, inbound=True),
                 models={"fast": "fast", "strong": "fast"}), "fast"


def service(*, mode: str = "sandbox", calls: Any = None, store: FakeStore | None = None, numbers: frozenset[str] = frozenset({OWNER})) -> InboundService:
    return InboundService(secret=SECRET, public_base="https://api.example.test", gate_settings=gate.Settings(mode=mode, sandbox_numbers=numbers, max_concurrent=2, outbound=False),  # type: ignore[arg-type]
                          store=cast(Any, store or FakeStore()), calls=cast(Any, calls if calls is not None else FakeCalls()), cost_paise_per_minute=100, language="en", business="Stack19 Owner Test",
                          max_call_s=20, parts_for=fake_parts)


# ---------------------------------------------------------------------------------------------------------------------------------- the token
def test_a_token_is_good_for_its_call_until_it_expires_and_cannot_be_forged() -> None:
    t = inbound.mint(SECRET, NOW, "CA123")
    assert len(t) <= 40 and inbound.verify(SECRET, t, NOW + 1, "CA123")
    assert not inbound.verify(SECRET, t, NOW + 1, "CA999"), "bound to the call it was made for"
    assert not inbound.verify(SECRET, t, NOW + inbound.TOKEN_TTL_S + 1, "CA123"), "it expires"
    assert not inbound.verify(b"x" * 48, t, NOW + 1, "CA123"), "another secret cannot have made it"
    assert not inbound.verify(SECRET, t[:-2] + ("AA" if not t.endswith("AA") else "BB"), NOW + 1, "CA123")
    for junk in ("", "!!!", "a" * 10, "a" * 200):
        assert not inbound.verify(SECRET, junk, NOW)
    unbound = inbound.mint(SECRET, NOW)
    assert inbound.verify(SECRET, unbound, NOW + 1, "CAanything"), "Exotel gave no call id at mint time: any call, still expiring"


def test_the_stream_address_is_wss_on_our_host_inside_the_applets_limits() -> None:
    url = inbound.stream_url("https://sme-api-620338396268.asia-south1.run.app/", inbound.mint(SECRET, NOW))
    assert url.startswith("wss://sme-api-620338396268.asia-south1.run.app/v1/telephony/exotel/stream/") and url.endswith("?sample-rate=8000")
    assert len(url) < 200 and url.count("&") == 0, "the token in the path (a dropped query string cannot lose it), one parameter, a short address"


# ---------------------------------------------------------------------------------------------------------------------------------- the Voicebot URL
def _client(svc: InboundService | None) -> Any:
    client, _ = make_client(phone_inbound=svc)
    return client


def test_the_voicebot_url_answers_the_calls_stream_address_and_nothing_while_off() -> None:
    off = _client(None).get("/v1/telephony/exotel/stream-url")
    assert off.status_code == 403 and off.json()["error"]["code"] == "telephony_off"
    client = _client(service())
    ok = client.get("/v1/telephony/exotel/stream-url", params={"CallSid": "CA123", "CallFrom": "09502380998", "CallTo": "09513886363"})
    assert ok.status_code == 200, ok.text
    url = ok.json()["url"]
    assert url.startswith("wss://api.example.test/v1/telephony/exotel/stream/")
    token = url.split("/stream/", 1)[1].split("?", 1)[0]
    assert inbound.verify(SECRET, token, inbound.monotonic(), "CA123") and not inbound.verify(SECRET, token, inbound.monotonic(), "CAother")
    posted = client.post("/v1/telephony/exotel/stream-url", data={"CallSid": "CA124", "From": "+919502380998"})
    assert posted.status_code == 200 and posted.json()["url"].startswith("wss://")
    assert client.get("/v1/telephony/exotel/stream-url").status_code == 200, "Exotel may send no parameters: the stream decides"


def test_a_caller_not_on_the_sandbox_list_gets_no_stream_address() -> None:
    r = _client(service()).get("/v1/telephony/exotel/stream-url", params={"CallSid": "CA1", "CallFrom": "09876543210"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_on_sandbox_list"


# ---------------------------------------------------------------------------------------------------------------------------------- before any audio
def start(from_number: str = OWNER, to_number: str = EXOPHONE, call_sid: str = "CA123") -> exotel.Start:
    return exotel.Start(stream_sid="XP1", call_sid=call_sid, account_sid="stack191", from_number=from_number, to_number=to_number, sample_rate=16000)


@arun
async def test_admit_needs_the_list_the_line_exotels_own_confirmation_and_the_gate() -> None:
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), outbound=False)
    now = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
    store = FakeStore()
    ok = await inbound.admit(start(), gs, find_line=store.line_find, calls=FakeCalls(), active_calls=0, now=now)  # type: ignore[arg-type]
    assert isinstance(ok, inbound.Admitted) and ok.tenant_id == TENANT and ok.talk
    cases: list[tuple[Any, str]] = [
        (dict(st=start(from_number="+919876543210")), "not_on_sandbox_list"),
        (dict(st=start(from_number="garbage")), "bad_number"),
        (dict(store=FakeStore(line={})), "no_such_line"),
        (dict(calls=FakeCalls(status="completed")), "not_approved"),
        (dict(calls=FakeCalls(from_number="+919000000001")), "not_approved"),
        (dict(calls=None), "telephony_off"),
        (dict(store=FakeStore(line={"tenant_id": str(TENANT), "inbound_on": False})), "inbound_off"),
        (dict(active=2), "too_many_calls"),
        (dict(gs=gate.Settings(mode="off")), "telephony_off"),
    ]
    for over, reason in cases:
        s = over.get("store", store)
        out = await inbound.admit(over.get("st", start()), over.get("gs", gs), find_line=s.line_find, calls=over.get("calls", FakeCalls()) if "calls" in over else FakeCalls(),  # type: ignore[arg-type]
                                  active_calls=over.get("active", 0), now=now)
        assert isinstance(out, gate.Refused) and out.reason == reason, (over, out)


def test_outbound_stays_refused_in_an_inbound_only_deployment() -> None:
    from tests.test_ph_gate import facts  # the outbound facts that pass every other rule

    assert isinstance(gate.check_outbound(gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), outbound=True), facts(number=OWNER)), gate.Allowed)
    assert gate.check_outbound(gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), outbound=False), facts(number=OWNER)) == gate.Refused("telephony_off")


def test_the_deployments_switch_is_off_unless_telephony_outbound_is_set() -> None:
    from app.config import Settings
    from app.telephony.settings import gate_settings

    assert gate_settings(Settings(_env_file=None, telephony_mode="sandbox")).outbound is False  # type: ignore[call-arg]
    assert gate_settings(Settings(_env_file=None, telephony_mode="sandbox", telephony_outbound=True)).outbound is True  # type: ignore[call-arg]


# ---------------------------------------------------------------------------------------------------------------------------------- a whole call
async def _call(svc: InboundService, token: str, sim_kw: dict[str, Any] | None = None) -> tuple[SimulatedExotel, asyncio.Task[None]]:
    ours, theirs = QueueWire.pair()
    sim = SimulatedExotel(theirs, **{"pace": 0, "call_sid": "CA123", "from_number": OWNER, "to_number": EXOPHONE, **(sim_kw or {})})
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), None, token, ours, open_timeout=2.0))
    await sim.connect()
    return sim, task


@arun
async def test_a_call_from_the_owner_is_answered_by_the_ai_and_finished_with_its_numbers_logged(caplog: Any = None) -> None:
    store = FakeStore()
    svc = service(store=store)
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    logging.getLogger("app.telephony.inbound").addHandler(handler)
    logging.getLogger("app.telephony.inbound").setLevel(logging.INFO)
    try:
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))
        await until(lambda: bool(sim.heard.marks), 5)   # the opening line has played
        await sim.speak_for(600)
        await sim.quiet_for(700)
        await until(lambda: len(store.progress) == 1, 5)
        await asyncio.sleep(1.5)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        logging.getLogger("app.telephony.inbound").removeHandler(handler)
    assert store.begun == [(TENANT, "en")] and store.progress[0][1] == "CA123"
    assert store.providers == ["exotel"], "an Exotel call is recorded as an Exotel call"
    assert len(store.finished) == 1
    outcome = store.finished[0][1]
    assert any(t["who"] == "assistant" for t in outcome.transcript)
    first = next(t["text"] for t in outcome.transcript if t["who"] == "assistant")
    assert "AI" in first or "ai" in first.lower(), "the first thing said is that it is an AI"
    numbers = svc.last_numbers
    assert numbers is not None and set(numbers) == {"call", "turns", "first_sound_p50_ms", "first_sound_p95_ms", "duration_s", "cost_paise_estimate", "outcome", "end",
                                                 "end_how", "stop_reason", "close_code", "close_reason", "stream_s", "events", "bytes_in", "bytes_out", "first_out_ms",
                                                 # owner, 6 Nov 2026: both target times logged for every call
                                                 "pickup_to_first_sound_ms", "admitted_ms", "greeting_ready", "reply_ms_p50", "reply_ms_p95", "reply_ms_max",
                                                 "first_sound_within_target", "replies_within_target",
                                                 "line_rate", "out_chunk_bytes", "chunks_out",
                                                 # owner, 6 Nov 2026: the characters spoken per call, to know the real cost per minute
                                                 "voice_chars", "voice_chars_total", "voice_chars_per_min", "voice_primary_off", "voice_budget", "languages", "interruptions", "fade_ms", "clear_ack_ms", "bookish_total", "bookish_words", "bookish_flag", "honorifics_stripped", "child_terms_total", "child_terms", "child_terms_flag", "particles_total", "sentences_total", "particles_per_sentence"}
    assert numbers["voice_chars_total"] > 0 and numbers["voice_chars_total"] == sum(numbers["voice_chars"].values()) and numbers["voice_primary_off"] == ""
    assert numbers["admitted_ms"] is not None and numbers["greeting_ready"] is False, "the fake voice is 16 kHz, so its greeting is never kept (the line expects 24 kHz) and is streamed instead"
    assert numbers["line_rate"] == 16000 and numbers["out_chunk_bytes"] == 3200 and numbers["chunks_out"] >= 1
    assert numbers["bytes_out"] > 0 and numbers["first_out_ms"] is not None and numbers["events"].get("start") == 1, "our audio went out, and when"
    assert numbers["cost_paise_estimate"] == 100, "one started minute at the estimate"
    line = next(r for r in records if r.startswith("phone_call_numbers "))
    assert OWNER not in line and "9502380998" not in line and "open" not in line, "no number and no word of the caller in the log"


@arun
async def test_a_forged_start_from_another_number_or_a_call_exotel_does_not_know_never_hears_a_word() -> None:
    for sim_kw, calls in (({"from_number": "+919876543210"}, FakeCalls()), ({}, FakeCalls(status="completed"))):
        store = FakeStore()
        svc = service(store=store, calls=calls)
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"), sim_kw)
        await asyncio.wait_for(task, 5)
        assert store.begun == [] and not sim.heard.audio_bytes, sim_kw


@arun
async def test_a_bad_or_expired_token_closes_the_stream_before_anything() -> None:
    for token in ("", "nonsense", inbound.mint(b"z" * 48, inbound.monotonic()), inbound.mint(SECRET, inbound.monotonic() - inbound.TOKEN_TTL_S - 5)):
        store = FakeStore()
        sim, task = await _call(service(store=store), token)
        await asyncio.wait_for(task, 5)
        assert store.asked == [] and store.begun == [], token


@pytest.mark.parametrize("value", [50.0, 900.0, 1200.0])
def test_percentiles(value: float) -> None:
    assert inbound.percentile([value], 0.95) == value
    assert inbound.percentile([], 0.5) is None
    assert inbound.percentile([100.0, 200.0, 300.0, 400.0], 0.5) == 200.0 and inbound.percentile([100.0, 200.0, 300.0, 400.0], 0.95) == 400.0


@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta", "ml"])
def test_an_inbound_call_is_answered_not_called_and_says_it_is_an_ai(language: str) -> None:
    line = persona.opening_line(language, business="Stack19", assistant=None, customer=None, inbound=True)
    assert "AI" in line and "Stack19" in line
    assert gate.has_ai_disclosure(line)
    assert "enquiry" not in line and "ఎంక్వైరీ" not in line and "కాల్ చేశాను" not in line, "the caller rang us"



def test_the_voicebot_url_can_answer_the_bare_address_as_text_and_logs_only_names() -> None:
    """4 Nov 2026, the first real call: Exotel fetched the URL and never opened the stream. The query part is 55 characters (Exotel's limit is 256 and 3 parameters), so the next suspect is the
    answer's form: EXOTEL_STREAM_URL_FORMAT=text answers the bare wss address. Every request's shape is logged by NAMES only."""
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    logger = logging.getLogger("app.telephony.inbound")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    try:
        svc = service()
        svc.url_format = "text"
        r = _client(svc).get("/v1/telephony/exotel/stream-url", params={"CallSid": "CA9", "CallFrom": "09502380998"})
    finally:
        logger.removeHandler(handler)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    assert r.text.startswith("wss://api.example.test/v1/telephony/exotel/stream/")
    query = r.text.split("?", 1)[1]
    assert len(query) <= 200 and query.count("&") + 1 <= 3, "inside Exotel's 3 parameters and 256 characters, with room to spare"
    shape = next(m for m in records if m.startswith("exotel_stream_url request"))
    assert "params=CallFrom,CallSid" in shape and "9502380998" not in " ".join(records) and "CA9" not in " ".join(records), "names only, never a value"


@arun
async def test_the_greeting_a_call_speaks_is_kept_and_the_next_call_plays_it_from_memory_with_no_voice_request() -> None:
    """Owner, 6 Nov 2026: Cartesia credits only for real calls, so nothing is rendered ahead. The first call streams its greeting (and keeps that audio); the second plays it from memory."""
    from app.conversation import fakes
    from app.telephony import inbound_routes as R

    cache = vars(R)["GREETINGS"]   # the cache the call path uses
    cache._cache.clear()
    saved = fakes.FakeTts.sample_rate, getattr(fakes.FakeTts, "served_engine", None)
    fakes.FakeTts.sample_rate = 24000   # the real voices' rate (only that is kept)
    fakes.FakeTts.served_engine = "cartesia"  # type: ignore[attr-defined]
    try:
        seen = []
        for _ in range(2):
            store = FakeStore()
            svc = service(store=store)
            sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))
            heard = sim.heard
            await until(lambda: bool(heard.marks), 5)  # noqa: B023 - awaited inside this iteration
            await sim.hang_up()
            await asyncio.wait_for(task, 10)
            assert svc.last_numbers is not None
            seen.append((svc.last_numbers["greeting_ready"], svc.last_numbers["voice_chars_total"]))
    finally:
        fakes.FakeTts.sample_rate = saved[0]
        if saved[1] is None:
            del fakes.FakeTts.served_engine  # type: ignore[attr-defined]
        cache._cache.clear()
    assert seen[0][0] is False and seen[1][0] is True, "the first call streamed its greeting, the second played it from memory"
    assert seen[1][1] < seen[0][1], "the second call's greeting cost no voice characters"


@arun
async def test_the_opening_is_kept_across_restarts_in_storage_and_read_while_the_call_is_admitted() -> None:
    """Owner, 6 Nov 2026: a call after a restart (nothing in memory) plays the stored opening at once; a call that had to stream it stores exactly what it spoke (no extra voice request)."""
    from app.conversation import fakes
    from app.telephony import inbound_routes as R

    cache = vars(R)["GREETINGS"]

    class Store:
        def __init__(self) -> None:
            self.files: dict[str, bytes] = {}
            self.reads: list[str] = []

        def get(self, path: str) -> bytes | None:
            self.reads.append(path)
            return self.files.get(path)

        def put(self, path: str, pcm: bytes) -> bool:
            self.files[path] = pcm
            return True

    store = Store()
    saved = fakes.FakeTts.sample_rate, getattr(fakes.FakeTts, "served_engine", None)
    fakes.FakeTts.sample_rate = 24000
    fakes.FakeTts.served_engine = "cartesia"  # type: ignore[attr-defined]
    seen = []
    try:
        for _ in range(2):
            cache._cache.clear()   # a fresh instance: nothing in memory
            svc = service(store=FakeStore())
            svc.opening_store = store  # type: ignore[assignment]
            sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))
            heard = sim.heard
            await until(lambda: bool(heard.marks), 5)  # noqa: B023 - awaited inside this iteration
            await sim.hang_up()
            await asyncio.wait_for(task, 10)
            await asyncio.sleep(0.05)   # (the store's write runs in the background)
            assert svc.last_numbers is not None
            seen.append(svc.last_numbers["greeting_ready"])
    finally:
        fakes.FakeTts.sample_rate = saved[0]
        if saved[1] is None:
            del fakes.FakeTts.served_engine  # type: ignore[attr-defined]
        cache._cache.clear()
    assert seen == [False, True], "the first call streamed and stored it; after a 'restart' the next call read it during admission and played it at once"
    assert len(store.files) == 1 and len(store.reads) == 2 and all(p.startswith(f"{TENANT}/") and p.endswith(".pcm") for p in store.files)
