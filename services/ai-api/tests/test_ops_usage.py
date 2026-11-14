"""The per-provider usage ledger's writer and its hooks (admin console, 13 Nov 2026): what each provider cost us, recorded when it happened, from MEASURED units.
The database side is pgTAP 196. Here: the recorder (batching, idempotent references, the breaker, never raising), and every hook with fakes: a phone call's end, a WhatsApp send, a Lead Finder search, an assistant turn, the model client's token counts.
Every hook is best effort: a recorder that fails changes nothing about the call, the message, the search or the answer."""

# ruff: noqa: E501
from __future__ import annotations

import json
import logging
import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.agents.llm.interface import LlmResponse, Usage
from app.assistant.runner import AssistantRunner
from app.assistant.tools import State
from app.conversation.fakes import FakeStt
from app.conversation.providers import AnthropicStream
from app.lead_finder import packdata
from app.lead_finder.service import LeadFinderService
from app.lead_finder.sources import MockPlacesSource, SearchRequest, SourceResult
from app.ops.usage import (
    FakeUsageRecorder,
    PostgrestUsageRecorder,
    UsageLine,
    clean,
    record_best_effort,
    units_text,
)
from app.outbox.adapter import OutgoingMessage, SendContext, SendResult, TemplateRef
from app.outbox.service import dispatch_due
from app.rpc_base import RpcClient
from app.telephony import call_usage
from app.telephony.call_session import CallPlan
from app.tenancy.repository import TokenRejected
from app.whatsapp.metered import MeteredAdapter, category_of_template, message_unit, metered
from tests.lf_fakes import NOW as LF_NOW
from tests.lf_fakes import FakeLeadFinderRepo
from tests.test_assistant_router import NOW, FakeDb, Model
from tests.test_dv_browser_voice import arun
from tests.test_ph_call import CALL, TENANT, Call, parts_for

TENANT_ID = uuid.UUID(int=0xA1)


# ------------------------------------------------------------------------------------------------------------------------ the recorder
def test_units_are_plain_decimals_with_three_places_and_nothing_to_record_is_none() -> None:
    assert units_text(90) == "90" and units_text(65.25) == "65.25" and units_text(Decimal("0.5")) == "0.5" and units_text(1e-05) is None
    assert units_text(0) is None and units_text(-3) is None and units_text("abc") is None  # type: ignore[arg-type]
    assert units_text(60.12345) == "60.123", "three places, as the database keeps them"


def test_a_line_with_nothing_measured_or_a_reference_the_database_would_refuse_is_dropped_before_sending() -> None:
    good = UsageLine("plivo", "second", 30, "call", "abc-123")
    kept = clean([good, UsageLine("plivo", "second", 0, "call", "abc-123"), UsageLine("plivo", "second", 30, "call", "a b"), UsageLine("twilio", "second", 30, "call", "abc-123"), UsageLine("plivo", "second", 30, "call", "x" * 101)])
    assert kept == [good]


def test_record_best_effort_never_raises_and_logs_only_the_class(caplog: pytest.LogCaptureFixture) -> None:
    secret_ref = "call-for-9876543210"
    boom = FakeUsageRecorder(fail=RuntimeError("the database said 9876543210 is not allowed"))
    with caplog.at_level(logging.WARNING):
        assert record_best_effort(boom, TENANT_ID, [UsageLine("plivo", "second", 30, "call", secret_ref)]) is False
    assert "RuntimeError" in caplog.text and "9876543210" not in caplog.text and secret_ref not in caplog.text
    assert record_best_effort(None, TENANT_ID, [UsageLine("plivo", "second", 30, "call", "abc-123")]) is False, "no recorder configured: nothing happens"
    ok = FakeUsageRecorder()
    assert record_best_effort(ok, TENANT_ID, [UsageLine("plivo", "second", 0, "call", "abc-123")]) is False and not ok.calls, "nothing measured: no call"
    assert record_best_effort(ok, TENANT_ID, [UsageLine("plivo", "second", 30, "call", "abc-123")]) is True and ok.lines[0].units == 30


class Principal:
    def __init__(self) -> None:
        self.invalidated = 0

    def token(self) -> str:
        return "system-token"

    def invalidate(self) -> None:
        self.invalidated += 1


def recorder_over(handler: Any, clock: Any = None) -> tuple[PostgrestUsageRecorder, Principal]:
    principal = Principal()
    rpc = RpcClient("https://db.example.test/rest/v1", "anon", client=httpx.Client(base_url="https://db.example.test/rest/v1", transport=httpx.MockTransport(handler)))
    return PostgrestUsageRecorder(rpc, principal, **({"clock": clock} if clock else {})), principal


def test_the_postgrest_recorder_sends_one_batch_as_the_system_account_with_strings_for_units() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"items": [], "count": 2})

    rec, _ = recorder_over(handler)
    rec.record(TENANT_ID, [UsageLine("plivo", "second", 90, "call", "call-1"), UsageLine("sarvam", "second", 12.5, "call", "call-1")])
    (req,) = seen
    assert req.url.path.endswith("/rpc/ops_record_usage_batch") and req.headers["authorization"] == "Bearer system-token"
    items = json.loads(req.content)["p_items"]
    assert items == [
        {"tenant_id": str(TENANT_ID), "provider": "plivo", "unit": "second", "units": "90", "ref_kind": "call", "ref_id": "call-1"},
        {"tenant_id": str(TENANT_ID), "provider": "sarvam", "unit": "second", "units": "12.5", "ref_kind": "call", "ref_id": "call-1"},
    ]


def test_more_than_fifty_lines_go_in_batches_of_fifty() -> None:
    sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sizes.append(len(json.loads(request.content)["p_items"]))
        return httpx.Response(200, json={})

    rec, _ = recorder_over(handler)
    rec.record(TENANT_ID, [UsageLine("plivo", "second", 1, "call", f"call-{n:04d}") for n in range(120)])
    assert sizes == [50, 50, 20]


def test_a_failed_write_raises_for_the_wrapper_then_the_recorder_stays_quiet_for_a_while() -> None:
    calls = 0
    now = [100.0]

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500, json={"code": "XX000", "message": "boom"})

    rec, _ = recorder_over(handler, clock=lambda: now[0])
    line = [UsageLine("plivo", "second", 30, "call", "call-1")]
    assert record_best_effort(rec, TENANT_ID, line) is False and calls == 1
    assert record_best_effort(rec, TENANT_ID, line) is True and calls == 1, "inside the cool-down nothing is sent (the breaker), and nothing is thrown"
    now[0] += 31
    record_best_effort(rec, TENANT_ID, line)
    assert calls == 2, "after the cool-down it tries again"


def test_a_refused_token_is_forgotten_so_the_next_write_signs_in_again() -> None:
    rec, principal = recorder_over(lambda request: httpx.Response(401, json={"code": "PGRST301", "message": "JWT expired"}))
    with pytest.raises(TokenRejected):
        rec.record(TENANT_ID, [UsageLine("plivo", "second", 30, "call", "call-1")])
    assert principal.invalidated == 1


# ------------------------------------------------------------------------------------------------------------------------ a phone call's end
def test_plivo_bills_whole_30_second_pulses_rounded_up() -> None:
    assert [call_usage.plivo_billed_seconds(s) for s in (0, -1, 1, 30, 30.1, 31, 60, 89.9)] == [0, 0, 30, 30, 60, 60, 60, 90]


def test_the_lines_of_a_call_are_what_was_measured_and_nothing_else() -> None:
    lines = call_usage.call_lines(CALL, carrier="plivo", duration_s=61.0, tts_chars={"cartesia": 440, "sarvam_v4": 120, "unknown": 9}, stt_seconds=47.25, stt_is_sarvam_engine=True, tokens_in=2100, tokens_out=64)
    got = {(ln.provider, ln.unit): ln.units for ln in lines}
    assert got == {("plivo", "second"): 90, ("cartesia", "character"): 440, ("sarvam", "character"): 120, ("sarvam", "second"): 47.25, ("anthropic", "token_in"): 2100, ("anthropic", "token_out"): 64}
    assert all(ln.ref_kind == "call" and ln.ref_id == str(CALL) for ln in lines)
    bare = call_usage.call_lines(CALL, carrier="exotel", duration_s=61.0, tts_chars={}, stt_seconds=30.0, stt_is_sarvam_engine=False, tokens_in=0, tokens_out=0)
    assert bare == [], "another carrier, no voice characters, an unknown recogniser, a model that reported nothing: nothing is guessed"


def test_tokens_are_summed_only_from_clients_that_report_whole_numbers() -> None:
    a, b = SimpleNamespace(input_tokens=100, output_tokens=7), SimpleNamespace(input_tokens=50, output_tokens=3)
    assert call_usage.token_totals(a, b, None, object(), SimpleNamespace(input_tokens="12", output_tokens=True)) == (150, 10)


class SarvamRealtimeStt(FakeStt):
    """Named like the real recogniser: the call's audio seconds are Sarvam's only then."""


def usage_call(*, engine: str | None, stt: bool, llm_tokens: tuple[int, int] | None, recorder: Any, carrier: str = "plivo", store: Any = None) -> Call:
    parts = parts_for()
    if engine:
        parts.tts.served_engine = engine  # type: ignore[attr-defined]
    if stt:
        parts.stt_for = lambda lang: SarvamRealtimeStt("what time do you open?", silence_ms=300)
    if llm_tokens:
        parts.llm.input_tokens, parts.llm.output_tokens = llm_tokens  # type: ignore[attr-defined]
    plan = CallPlan(call_id=CALL, tenant_id=TENANT, direction="outbound", language="en", business="Sri Textiles", max_call_s=60, carrier=carrier)
    return Call(parts, plan=plan, store=store, usage_recorder=recorder)


async def talk_and_hang_up(call: Call) -> Any:
    await call.start()
    await call.after_opening()
    await call.say()
    await call.sim.hang_up()
    return await call.result()


@arun
async def test_a_plivo_call_records_its_seconds_its_voice_characters_its_listening_seconds_and_the_models_tokens() -> None:
    rec = FakeUsageRecorder()
    call = usage_call(engine="cartesia", stt=True, llm_tokens=(1800, 90), recorder=rec)
    out = await talk_and_hang_up(call)
    assert out.state == "completed" and len(call.store.finished) == 1
    ((tenant, lines, _),) = rec.calls
    assert tenant == TENANT and all(ln.ref_kind == "call" and ln.ref_id == str(CALL) for ln in lines)
    got = {(ln.provider, ln.unit): ln.units for ln in lines}
    duration = call.store.finished[0][2]
    assert got[("plivo", "second")] == call_usage.plivo_billed_seconds(duration) and got[("plivo", "second")] % 30 == 0
    assert got[("cartesia", "character")] == call.parts.tts.characters, "the characters the voice was really given"  # type: ignore[attr-defined]
    assert got[("sarvam", "second")] > 0, "the caller's audio the recogniser listened to"
    assert got[("anthropic", "token_in")] == 1800 and got[("anthropic", "token_out")] == 90
    assert ("sarvam", "character") not in got, "no fallback voice was used"


@arun
async def test_a_call_on_another_carrier_with_no_measured_models_records_only_what_it_measured() -> None:
    rec = FakeUsageRecorder()
    call = usage_call(engine="cartesia", stt=False, llm_tokens=None, recorder=rec, carrier="exotel")
    await talk_and_hang_up(call)
    got = {(ln.provider, ln.unit) for ln in rec.lines}
    assert got == {("cartesia", "character")}, "Exotel's minutes are not Plivo's, the recogniser is not known to be Sarvam, the model reported no tokens"


@arun
async def test_the_fallback_voice_characters_are_sarvams() -> None:
    rec = FakeUsageRecorder()
    await talk_and_hang_up(usage_call(engine="sarvam_v4", stt=False, llm_tokens=None, recorder=rec))
    assert rec.find("sarvam", "character") is not None and rec.find("cartesia", "character") is None


@arun
async def test_a_recorder_that_fails_does_not_break_the_call_or_its_record() -> None:
    rec = FakeUsageRecorder(fail=RuntimeError("down"))
    call = usage_call(engine="cartesia", stt=True, llm_tokens=(10, 1), recorder=rec)
    out = await talk_and_hang_up(call)
    assert out.state == "completed" and len(call.store.finished) == 1, "the call row was finished all the same"


@arun
async def test_a_call_with_no_recorder_configured_records_nothing_and_runs_as_before() -> None:
    call = usage_call(engine="cartesia", stt=True, llm_tokens=(10, 1), recorder=None)
    out = await talk_and_hang_up(call)
    assert out.state == "completed" and len(call.store.finished) == 1


@arun
async def test_a_call_whose_row_could_not_be_finished_is_still_recorded_by_the_calls_own_id() -> None:
    from tests.test_ph_call import FakeCallStore

    rec = FakeUsageRecorder()
    await talk_and_hang_up(usage_call(engine="cartesia", stt=False, llm_tokens=None, recorder=rec, store=FakeCallStore(boom=True)))
    assert rec.find("plivo", "second") is not None, "the carrier billed the call whether or not our row could be written"


# ------------------------------------------------------------------------------------------------------------------------ the model client reports its tokens
def stream_events(inp: int, out_start: int, out_end: int) -> str:
    lines = [
        {"type": "message_start", "message": {"usage": {"input_tokens": inp, "output_tokens": out_start}}},
        {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "We open at nine."}},
        {"type": "message_delta", "usage": {"output_tokens": out_end}},
        {"type": "message_stop"},
    ]
    return "".join(f"event: x\ndata: {json.dumps(e)}\n\n" for e in lines)


@arun
async def test_the_anthropic_stream_counts_the_tokens_the_provider_reports_across_requests() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=stream_events(1500, 1, 40))))
    llm = AnthropicStream("k", client=client)
    assert llm.input_tokens == 0 and llm.output_tokens == 0
    for _ in range(2):
        text = "".join([p async for p in llm.stream("system", [{"role": "user", "content": "hi"}], "claude-test")])
        assert text == "We open at nine."
    assert (llm.input_tokens, llm.output_tokens) == (3000, 80)


@arun
async def test_an_interrupted_reply_is_still_counted_for_what_the_provider_had_reported() -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=stream_events(900, 1, 40))))
    llm = AnthropicStream("k", client=client)
    gen = llm.stream("system", [{"role": "user", "content": "hi"}], "claude-test")
    assert await gen.__anext__() == "We open at nine."
    await gen.aclose()  # type: ignore[attr-defined]   # the caller spoke over it
    assert llm.input_tokens == 900 and llm.output_tokens == 1


# ------------------------------------------------------------------------------------------------------------------------ a WhatsApp send
PNI = "123456789"


class Inner:
    name = "whatsapp"

    def __init__(self, result: SendResult) -> None:
        self.result = result
        self.sent: list[OutgoingMessage] = []

    def send(self, message: OutgoingMessage) -> SendResult:
        self.sent.append(message)
        return self.result


def msg(*, window: bool, template: TemplateRef | None = None, tenant: uuid.UUID | None = TENANT_ID) -> OutgoingMessage:
    return OutgoingMessage(uuid.UUID(int=77), "+919876543210", "Hello", "en", (), 1, SendContext(PNI, "ref", window, template), tenant_id=tenant)


def test_a_reply_inside_the_window_is_a_service_message_with_the_wamid_as_its_reference() -> None:
    rec = FakeUsageRecorder()
    adapter = MeteredAdapter(Inner(SendResult(True, "wamid.HBgMTEST123")), rec)
    assert adapter.send(msg(window=True)).ok
    ((tenant, (line,), _),) = rec.calls
    assert tenant == TENANT_ID and line == UsageLine("meta", "message_service", 1, "message", "wamid.HBgMTEST123")


@pytest.mark.parametrize(("category", "unit"), [("marketing", "message_marketing"), ("utility", "message_utility")])
def test_a_template_message_is_priced_by_the_templates_category(category: str, unit: str) -> None:
    rec = FakeUsageRecorder()
    MeteredAdapter(Inner(SendResult(True, "wamid.A1")), rec).send(msg(window=False, template=TemplateRef("my_custom", "en", "body {{1}}", category)))
    assert rec.lines[0].unit == unit


def test_the_first_templates_are_priced_by_their_own_category_when_the_database_does_not_say() -> None:
    assert category_of_template("followup_nudge") == "marketing" and category_of_template("visit_reminder") == "utility" and category_of_template("nope") is None
    ctx = SendContext(PNI, "ref", False, TemplateRef("catalogue_share", "te", "b"))
    assert message_unit(ctx) == "message_marketing"


def test_a_template_of_unknown_or_authentication_category_records_nothing_and_says_so(caplog: pytest.LogCaptureFixture) -> None:
    rec = FakeUsageRecorder()
    adapter = MeteredAdapter(Inner(SendResult(True, "wamid.A2")), rec)
    with caplog.at_level(logging.WARNING):
        adapter.send(msg(window=False, template=TemplateRef("their_own", "en", "b")))
        adapter.send(msg(window=False, template=TemplateRef("otp", "en", "b", "authentication")))
        adapter.send(msg(window=False, template=None))
    assert not rec.calls and "category" in caplog.text


def test_a_refused_message_a_message_without_a_workspace_and_a_failing_recorder_change_nothing() -> None:
    rec = FakeUsageRecorder()
    assert not MeteredAdapter(Inner(SendResult(False, None, "window_closed")), rec).send(msg(window=True)).ok and not rec.calls, "Meta refused: nothing was sent, nothing is recorded"
    MeteredAdapter(Inner(SendResult(True, "wamid.A3")), rec).send(msg(window=True, tenant=None))
    assert not rec.calls
    sent = MeteredAdapter(Inner(SendResult(True, "wamid.A4")), FakeUsageRecorder(fail=RuntimeError("down"))).send(msg(window=True))
    assert sent.ok and sent.adapter_message_id == "wamid.A4", "the message went; its bookkeeping failing is not the sender's problem"


def test_a_wamid_the_database_would_not_accept_falls_back_to_the_outbox_message_id() -> None:
    rec = FakeUsageRecorder()
    MeteredAdapter(Inner(SendResult(True, "wamid.has spaces & symbols")), rec).send(msg(window=True))
    assert rec.lines[0].ref_id == str(uuid.UUID(int=77))


def test_only_the_real_whatsapp_adapter_is_wrapped() -> None:
    rec = FakeUsageRecorder()
    real, fake = Inner(SendResult(True, "x")), Inner(SendResult(True, "x"))
    fake.name = "fake"
    assert isinstance(metered(real, rec), MeteredAdapter) and metered(fake, rec) is fake and metered(real, None) is real
    assert metered(real, rec).name == "whatsapp"


class OneMessageRepo:
    def __init__(self, wa: dict[str, Any]) -> None:
        self.wa = wa
        self.marked: list[dict[str, Any]] = []

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [{"id": str(uuid.UUID(int=5)), "phone": "+919876543210", "body": "Hello", "language": "en", "media": [], "attempts": 1, "wa": self.wa}]

    def mark(self, token: str, args: dict[str, Any]) -> None:
        self.marked.append(args)


def test_the_outbox_dispatch_hands_the_adapter_the_workspace_and_the_category_so_the_send_is_recorded() -> None:
    rec = FakeUsageRecorder()
    wa = {"phone_number_id": PNI, "token_ref": "ref", "window_open": False, "template": {"name": "followup_nudge", "language": "en", "body": "b", "category": "marketing"}}
    repo = OneMessageRepo(wa)
    result = dispatch_due(repo, MeteredAdapter(Inner(SendResult(True, "wamid.DISPATCH1")), rec), "t", TENANT_ID)  # type: ignore[arg-type]
    assert result.sent == 1 and repo.marked[0]["p_outcome"] == "sent"
    assert rec.calls[0][0] == TENANT_ID and rec.lines == [UsageLine("meta", "message_marketing", 1, "message", "wamid.DISPATCH1")]


# ------------------------------------------------------------------------------------------------------------------------ a Lead Finder search
class PaidPlaces:
    """Google's source as far as the service can tell: provider `places`, one billed request."""

    provider = "places"
    billed = True

    def __init__(self, requests: int = 1, cost: int = 300) -> None:
        self._mock, self._requests, self._cost = MockPlacesSource(packdata.for_pack("textiles")), requests, cost  # type: ignore[arg-type]

    def sku(self) -> str:
        return "places_text_search_enterprise"

    def estimate_paise(self, request: SearchRequest) -> int:
        return self._cost

    def search(self, request: SearchRequest) -> SourceResult:
        got = self._mock.search(request)
        return SourceResult(places=got.places, sku=got.sku, requests=self._requests, cost_paise=self._cost)


def finder(source: Any, recorder: Any, *, mock: bool = False) -> tuple[LeadFinderService, FakeLeadFinderRepo]:
    repo = FakeLeadFinderRepo("textiles", real_data_open=True)
    service = LeadFinderService(repo, mode="places", places_key=None if mock else "key", places_mock=mock, places_factory=lambda key, cost: source, clock=lambda: LF_NOW, usage=recorder)
    return service, repo


def run_search(service: LeadFinderService) -> Any:
    from app.lead_finder.models import PlanIn

    plan = service.plan("t", TENANT_ID, PlanIn(text="find saree shops in Jayanagar"))
    return service.approve("t", TENANT_ID, uuid.UUID(str(plan.id)))


def test_a_finished_google_search_records_the_provider_requests_under_the_search_id() -> None:
    rec = FakeUsageRecorder()
    service, _ = finder(PaidPlaces(requests=2), rec)
    done = run_search(service)
    assert done.state == "done"
    ((tenant, (line,), _),) = rec.calls
    assert tenant == TENANT_ID and line == UsageLine("google", "search_enterprise", 2, "search", str(done.id))


def test_a_search_is_stopped_before_google_when_the_monthly_free_cap_is_used_up() -> None:
    rec = FakeUsageRecorder()
    rec.google_left = {"search_enterprise": 0}
    source = PaidPlaces()
    service, _ = finder(source, rec)
    done = run_search(service)
    assert done.state == "failed" and not rec.lines and rec.budget_asked == [("search_enterprise", 1)]


def test_the_cap_check_fails_closed_when_the_database_cannot_answer() -> None:
    rec = FakeUsageRecorder()
    rec.budget_fail = RuntimeError("down")
    service, _ = finder(PaidPlaces(), rec)
    assert run_search(service).state == "failed"
    service2, _ = finder(PaidPlaces(), None)   # no ledger configured at all: a billed request is not made either
    assert run_search(service2).state == "failed"


def test_details_are_counted_one_request_per_place_and_stopped_at_the_cap() -> None:
    from app.lead_finder.sources import GooglePlaceDetails

    class Billed(GooglePlaceDetails):
        def __init__(self) -> None:
            self.asked: list[list[str]] = []

        def fetch(self, place_ids: list[str]) -> dict[str, Any]:
            self.asked.append(place_ids)
            return {}

    rec = FakeUsageRecorder()
    repo = FakeLeadFinderRepo("textiles", real_data_open=True)
    source = Billed()
    service = LeadFinderService(repo, mode="places", places_key="key", details_factory=lambda key: source, clock=lambda: LF_NOW, usage=rec)
    rows = [{"source": "google_maps", "place_id": "pid-aaa"}, {"source": "google_maps", "place_id": "pid-bbb"}]
    out = service.live("t", TENANT_ID, rows)
    assert source.asked == [["pid-aaa", "pid-bbb"]] and all(r["details_available"] is False for r in out)
    assert rec.find("google", "details_enterprise") is not None and rec.find("google", "details_enterprise").units == 2  # type: ignore[union-attr]
    rec2 = FakeUsageRecorder()
    rec2.google_left = {"details_enterprise": 1}   # only one request left this month: two places do not fit, so none is fetched
    service2 = LeadFinderService(repo, mode="places", places_key="key", details_factory=lambda key: source, clock=lambda: LF_NOW, usage=rec2)
    source.asked.clear()
    service2.live("t", TENANT_ID, rows)
    assert not source.asked and not rec2.lines


def test_the_mock_and_the_fixture_make_no_request_so_they_record_nothing() -> None:
    rec = FakeUsageRecorder()
    service, _ = finder(None, rec, mock=True)   # the mock source: provider places, requests 0, cost 0
    assert run_search(service).state == "done" and not rec.calls
    fixture_service = LeadFinderService(FakeLeadFinderRepo("textiles", real_data_open=False), mode="fixture", clock=lambda: LF_NOW, usage=rec)
    assert run_search(fixture_service).state == "done" and not rec.calls
    free, _ = finder(PaidPlaces(requests=0, cost=0), rec)
    assert run_search(free).state == "done" and not rec.calls, "no request, no cost: nothing"


def test_a_search_still_finishes_when_the_recorder_fails() -> None:
    service, repo = finder(PaidPlaces(), FakeUsageRecorder(fail=RuntimeError("down")))
    done = run_search(service)
    assert done.state == "done" and repo.rows, "the prospects were saved all the same"


# ------------------------------------------------------------------------------------------------------------------------ an assistant turn
class ClaudeModel(Model):
    model_id = "claude-haiku-5-5"

    def complete(self, request: Any) -> LlmResponse:
        reply = super().complete(request)
        return LlmResponse(tool_calls=reply.tool_calls, structured=reply.structured, usage=Usage(1200 + len(self.requests), 40, 0))


def assistant_run(model: Any, recorder: Any) -> tuple[Any, Any]:
    db = FakeDb()
    run_id = uuid.uuid4()
    ctx = SimpleNamespace(db=db, runtime=SimpleNamespace(usage=recorder), token="t", tenant=TENANT_ID, run_id=run_id, state=State())   # noqa: S106
    runner = AssistantRunner(db=db, llm=model, ctx=ctx, now=lambda: NOW)  # type: ignore[arg-type]
    out = runner.run(question="What needs me today?", language="en", history=[], emit=lambda *_: None, message_id=uuid.uuid4())
    assert out.status == "succeeded", out
    return run_id, db


def test_each_model_call_of_an_assistant_run_records_the_tokens_it_reported_under_the_run() -> None:
    rec = FakeUsageRecorder()
    run_id, _ = assistant_run(ClaudeModel(()), rec)
    ((tenant, lines, _),) = rec.calls
    assert tenant == TENANT_ID, "one write for the run, after the answer"
    assert {ln.ref_id for ln in lines} == {f"{run_id}:usage-1", f"{run_id}:usage-2"} and all(ln.ref_kind == "assistant_turn" and ln.provider == "anthropic" for ln in lines)
    assert [(ln.unit, ln.units, ln.ref_id.rsplit(":", 1)[1]) for ln in lines] == [("token_in", 1201, "usage-1"), ("token_out", 40, "usage-1"), ("token_in", 1202, "usage-2"), ("token_out", 40, "usage-2")]


def test_a_model_that_is_not_claude_records_nothing() -> None:
    rec = FakeUsageRecorder()
    assistant_run(Model(()), rec)   # model_id "fake-selftest"
    assert not rec.calls


def test_an_assistant_answer_is_the_same_when_the_recorder_fails_or_is_missing() -> None:
    assistant_run(ClaudeModel(()), FakeUsageRecorder(fail=RuntimeError("down")))
    assistant_run(ClaudeModel(()), None)
    assistant_run(ClaudeModel(()), "not a recorder")


def test_the_wiring_hands_the_scheduler_account_a_recorder_only_when_it_is_configured() -> None:
    from app.ops.usage import build_usage_recorder

    config = SimpleNamespace(supabase_url="https://db.example.test", anon_key="anon", rest_url="https://db.example.test/rest/v1")
    assert build_usage_recorder(SimpleNamespace(scheduler_email=None, scheduler_password=None), config) is None
    secret = SimpleNamespace(get_secret_value=lambda: "pw")
    assert build_usage_recorder(SimpleNamespace(scheduler_email="s@example.test", scheduler_password=None), config) is None
    assert isinstance(build_usage_recorder(SimpleNamespace(scheduler_email="s@example.test", scheduler_password=secret), config), PostgrestUsageRecorder)
