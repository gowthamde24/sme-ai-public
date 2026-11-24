"""VoiceLink end to end, the outbound half (26 Nov 2026; owner decision 24 Nov: VoiceLink is the only provider): the REST client against a fake VoiceLink, the caller that turns the placer's request into `add_lead`, a call WE placed arriving at
our WebSocket bot (admitted only against a waiting row of ours), the webhook that closes an unanswered call, the dynamic inbound-call answer, the wallet reader and which provider the phone service is built for. No network, no real VoiceLink."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.browser_voice.limits import Limits
from app.config import Settings
from app.errors import ApiError
from app.ops.plivo_balance import Account, Limit, alert_detail, voicelink_in_use, whatsapp_text
from app.telephony import gate
from app.telephony.inbound_routes import InboundService
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_outbound import (
    PENDING,
    OutboundRefused,
    PlivoOutbound,
    PostgrestOutboundRepo,
)
from app.telephony.simulator import QueueWire, SimulatedVoicelink
from app.telephony.voicelink_api import (
    VoicelinkApi,
    VoicelinkBalanceReader,
    VoicelinkCaller,
    VoicelinkError,
    digits_with_country,
    indian_mobile_10,
)
from app.telephony.voicelink_routes import VoicelinkConfig, handle, router
from tests.test_dv_browser_voice import arun, until
from tests.test_ph_inbound import FakeStore, fake_parts

TOKEN = "voicelink-bot-address-token-for-tests-0123456789abcdef"
OWNER = "+919000000998"
LINE = "+918065590140"
TENANT = uuid.UUID(int=0x0B0E)
ROW = uuid.UUID(int=0xA11CE)
VL_LINE = {"tenant_id": str(TENANT), "inbound_on": True, "provider": "voicelink", "account_ref": None, "external_ref": None, "business": "Stack19 Owner Test", "assistant": None}
BASE = "https://api.example.test"


# ------------------------------------------------------------------------------------------------------------------ the REST client against a fake VoiceLink
class FakeVoicelink:
    def __init__(self, *, wallet: dict[str, Any] | None = None, expire_once: bool = False, login_status: int = 200, add_status: int = 200) -> None:
        self.seen: list[tuple[str, str, Any, str | None]] = []
        self.wallet = wallet or {"balance": 812.5, "currency": "INR"}
        self.expire_once, self.login_status, self.add_status = expire_once, login_status, add_status
        self.logins = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.seen.append((request.method, request.url.path, body, request.headers.get("authorization")))
        path = request.url.path
        if path.endswith("/auth/login"):
            self.logins += 1
            if self.login_status != 200:
                return httpx.Response(self.login_status, json={"status": False, "message": "no"})
            return httpx.Response(200, json={"data": {"access_token": f"tok-{self.logins}"}, "status": True})
        if self.expire_once and request.headers.get("authorization") == "Bearer tok-1":
            return httpx.Response(401, json={"message": "Unauthenticated."})
        if path.endswith("/reseller/profile"):
            return httpx.Response(200, json={"data": {"wallet": self.wallet, "currency": self.wallet.get("currency")}, "status": True})
        if path.endswith("/reseller/did/purchased"):
            return httpx.Response(200, json={"data": {"data": [{"did_number": "918065590140", "type_label": "Landline", "is_expired": False}]}, "status": True})
        if path.endswith("/add_lead"):
            if self.add_status != 200:
                return httpx.Response(self.add_status, json={"status": False})
            return httpx.Response(200, json={"data": {"outbound_queue_id": 4711}, "status": True, "message": "Lead queued"})
        return httpx.Response(404)


def api(fake: FakeVoicelink) -> VoicelinkApi:
    return VoicelinkApi("reseller-user", "s3cret-password", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(fake.handler)))


def test_it_logs_in_once_keeps_the_token_and_reads_the_wallet_and_the_numbers() -> None:
    fake = FakeVoicelink()
    vl = api(fake)
    wallet = vl.wallet()
    assert (wallet.balance, wallet.currency) == (812.5, "INR")
    assert vl.purchased_dids()[0]["did_number"] == "918065590140"
    assert fake.logins == 1 and all(h == "Bearer tok-1" for _, p, _, h in fake.seen if not p.endswith("/login"))


def test_an_expired_token_is_renewed_once_and_the_call_goes_through() -> None:
    fake = FakeVoicelink(expire_once=True)
    assert api(fake).wallet().balance == 812.5
    assert fake.logins == 2


def test_add_lead_sends_ten_digits_the_country_code_apart_and_our_ids_as_a_json_string() -> None:
    fake = FakeVoicelink()
    queued = api(fake).add_lead(did_number=LINE, customer_number=OWNER, custom_parameters={"call": str(ROW), "tenant": str(TENANT)}, websocket_url="wss://x.test/ws", webhook_url="https://x.test/hook")
    assert queued == "4711"
    sent = next(b for m, p, b, _ in fake.seen if p.endswith("/add_lead"))
    assert sent["did_number"] == "918065590140" and sent["customer_number"] == "9000000998" and sent["country_code"] == "91" and sent["call_limit"] == 1
    assert json.loads(sent["custom_parameters"]) == {"call": str(ROW), "tenant": str(TENANT)} and sent["websocket_url"] == "wss://x.test/ws" and sent["webhook_url"] == "https://x.test/hook"
    assert indian_mobile_10("+919000000998") == "9000000998" and indian_mobile_10("+14155550100") is None and indian_mobile_10("9000000998") == "9000000998"
    assert digits_with_country("+918065590140") == "918065590140"


def test_every_failure_is_a_closed_word_and_the_password_is_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG):
        for fake, word in ((FakeVoicelink(login_status=401), "auth"), (FakeVoicelink(add_status=422), "refused"), (FakeVoicelink(add_status=503), "server")):
            with pytest.raises(VoicelinkError) as err:
                api(fake).add_lead(did_number=LINE, customer_number=OWNER, custom_parameters={}, websocket_url="wss://x.test/ws", webhook_url="https://x.test/h")
            assert err.value.reason == word and isinstance(err.value, PlivoError)
        with pytest.raises(VoicelinkError) as err:
            api(FakeVoicelink()).add_lead(did_number=LINE, customer_number="+14155550100", custom_parameters={}, websocket_url="w", webhook_url="h")
        assert err.value.reason == "bad_number"

        def down(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("no route")

        with pytest.raises(VoicelinkError) as err:
            VoicelinkApi("u", "s3cret-password", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(down))).wallet()
        assert err.value.reason == "unreachable"
    assert "s3cret-password" not in caplog.text


# ------------------------------------------------------------------------------------------------------------------ the caller the placer uses
def test_the_caller_reads_the_answer_address_and_points_voicelink_at_our_bot_and_webhook() -> None:
    fake = FakeVoicelink()
    caller = VoicelinkCaller(api(fake), public_base=BASE, ws_token=lambda: TOKEN)
    queued = caller.place_call(from_number=LINE, to_number=OWNER, answer_url=f"{BASE}/v1/telephony/voicelink/outbound-answer?call={ROW}&tenant={TENANT}&lang=te&p=visit_reminder&k=task", hangup_url="ignored", time_limit=180)
    sent = next(b for m, p, b, _ in fake.seen if p.endswith("/add_lead"))
    assert queued == "4711" and sent["websocket_url"] == f"wss://api.example.test/v1/telephony/voicelink/ws/{TOKEN}" and sent["webhook_url"] == f"{BASE}/v1/telephony/voicelink/webhook/{TOKEN}"
    assert json.loads(sent["custom_parameters"]) == {"call": str(ROW), "tenant": str(TENANT), "lang": "te", "p": "visit_reminder", "k": "task"}
    assert caller.cancel_request("4711") is False and caller.hang_up("x") is False, "VoiceLink documents no cancel: said honestly, the row is closed on our side"
    with pytest.raises(VoicelinkError):
        caller.place_call(from_number=LINE, to_number=OWNER, answer_url=f"{BASE}/x?lang=te", hangup_url="")


class OutRepo:
    """The database side of the placer, in memory: the call's row and what was done to it."""

    def __init__(self, state: str = "queued", provider: str = "voicelink", line: dict[str, Any] | None = None) -> None:
        self.row_state = {"direction": "outbound", "provider": provider, "state": state}
        self.line = {"number": LINE, "tenant_id": str(TENANT), "billing_blocked": False} if line is None else line
        self.calls: list[tuple[str, Any]] = []

    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        return self.line

    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID:
        self.calls.append(("begin", refuse_reason))
        return ROW

    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None:
        self.calls.append(("ringing", provider_call_id))
        self.row_state["state"] = "ringing"

    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None:
        self.calls.append(("finish", (state, end_reason)))
        self.row_state["state"] = state

    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None:
        return dict(self.row_state)

    def proof(self, *a: Any) -> None:
        return None

    def set_proof(self, *a: Any) -> None:
        return None

    def prospect(self, *a: Any) -> bool:
        return False

    def approved(self, *a: Any) -> bool:
        return True

    def facts(self, *a: Any) -> dict[str, Any]:
        return {}


def test_the_placer_places_a_voicelink_test_call_to_the_owner_through_the_same_gate_and_marks_the_row_ringing() -> None:
    fake, repo = FakeVoicelink(), OutRepo()
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), max_concurrent=2, outbound=True)
    placer = PlivoOutbound(api=VoicelinkCaller(api(fake), public_base=BASE, ws_token=lambda: TOKEN), repo=cast(Any, repo), gate_settings=gs, public_base=BASE, provider="voicelink",
                           clock=lambda: __import__("datetime").datetime(2026, 11, 26, 6, 30, tzinfo=__import__("datetime").timezone.utc))   # 12:00 India time
    placed = placer.place("tok", TENANT, OWNER, approval_kind="owner_test")
    assert placed.provider_call_id == "4711" and ("ringing", "4711") in repo.calls
    sent = next(b for m, p, b, _ in fake.seen if p.endswith("/add_lead"))
    assert sent["customer_number"] == "9000000998" and json.loads(sent["custom_parameters"])["call"] == str(ROW)
    # a number that is not on the sandbox list is refused by the gate BEFORE VoiceLink is asked
    before = len(fake.seen)
    with pytest.raises(OutboundRefused):
        placer.place("tok", TENANT, "+919000000001", approval_kind="owner_test")
    assert len(fake.seen) == before
    assert placer.provider == "voicelink"
    PENDING.drop(ROW)


def test_a_failed_add_lead_closes_the_row_as_failed_and_says_so() -> None:
    fake, repo = FakeVoicelink(add_status=503), OutRepo()
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), max_concurrent=2, outbound=True)
    placer = PlivoOutbound(api=VoicelinkCaller(api(fake), public_base=BASE, ws_token=lambda: TOKEN), repo=cast(Any, repo), gate_settings=gs, public_base=BASE, provider="voicelink",
                           clock=lambda: __import__("datetime").datetime(2026, 11, 26, 6, 30, tzinfo=__import__("datetime").timezone.utc))
    with pytest.raises(VoicelinkError):
        placer.place("tok", TENANT, OWNER, approval_kind="owner_test")
    assert ("finish", ("failed", "error")) in repo.calls


# ------------------------------------------------------------------------------------------------------------------ a call WE placed arriving at our bot
class LineStore(FakeStore):
    """Only OUR number is a line (the real database answers for no other): the route must find which of the call's two numbers that is."""

    def line_find(self, number: str) -> dict[str, Any] | None:
        self.asked.append(number)
        return self.line if number == LINE and self.line else None


def out_service(repo: OutRepo | None = None, *, mode: str = "sandbox", store: FakeStore | None = None) -> InboundService:
    st = store or LineStore(line=VL_LINE)
    st.scheduler_token = lambda: "sched-token"   # type: ignore[attr-defined]
    return InboundService(secret=b"", public_base=BASE, gate_settings=gate.Settings(mode=mode, sandbox_numbers=frozenset({OWNER}), max_concurrent=2, outbound=True),  # type: ignore[arg-type]
                          store=cast(Any, st), calls=None, cost_paise_per_minute=100, language="en", business="Stack19 Owner Test", max_call_s=20, parts_for=fake_parts,
                          voicelink=VoicelinkConfig(ws_token=TOKEN, public_base=BASE), outbound_repo=repo or OutRepo())


def placed_custom(**over: str) -> dict[str, str]:
    return {"call": str(ROW), "tenant": str(TENANT), "lang": "en", "p": "visit_reminder", "k": "test", **over}


async def outbound_call(svc: InboundService, custom: dict[str, str], *, caller: str = LINE, to: str = OWNER, live: Any = None) -> tuple[SimulatedVoicelink, asyncio.Task[None]]:
    ours, theirs = QueueWire.pair()
    sim = SimulatedVoicelink(theirs, pace=0, call_id="vl-out-1", caller=caller, to=to, custom=custom)   # from = our DID, to = the person (UNVERIFIED which way VoiceLink says it: the route accepts either)
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), live, TOKEN, ours, open_timeout=2.0))
    await sim.connect()
    return sim, task


@arun
async def test_a_call_we_placed_is_admitted_against_its_waiting_row_runs_the_pipeline_on_it_and_is_recorded_as_voicelink() -> None:
    store = LineStore(line=VL_LINE)
    sim, task = await outbound_call(out_service(store=store), placed_custom())
    await until(lambda: bool(sim.heard.marks), 5)
    await sim.speak_for(600)          # the person says hello (an outbound call waits for it)
    await sim.quiet_for(700)
    await until(lambda: len(store.progress) == 1, 5)
    await asyncio.sleep(1.0)
    await sim.hang_up()
    await asyncio.wait_for(task, 10)
    assert store.begun == [], "the row already existed (begun when the call was placed): nothing new is begun"
    assert store.progress[0][0] == ROW, "the EXISTING row moves to in progress"
    assert len(store.finished) == 1 and store.finished[0][0] == ROW
    assert sim.heard.problems == [] and sim.heard.audio_bytes > 0


@arun
async def test_the_other_way_round_is_admitted_too_because_which_number_is_ours_is_not_documented() -> None:
    store = LineStore(line=VL_LINE)
    sim, task = await outbound_call(out_service(store=store), placed_custom(), caller=OWNER, to=LINE)
    await until(lambda: bool(sim.heard.marks), 5)
    await sim.speak_for(600)
    await sim.quiet_for(700)
    await until(lambda: len(store.progress) == 1, 5)
    await sim.hang_up()
    await asyncio.wait_for(task, 10)
    assert store.progress[0][0] == ROW


@arun
async def test_a_stranger_a_replay_or_a_wrong_workspace_gets_no_audio() -> None:
    cases = [
        (out_service(OutRepo(state="in_progress")), placed_custom()),                    # the row is not waiting any more (a replay)
        (out_service(OutRepo(state="completed")), placed_custom()),
        (out_service(OutRepo(provider="plivo")), placed_custom()),                        # a row of another provider
        (out_service(), placed_custom(call="not-a-uuid")),
        (out_service(), placed_custom(lang="xx")),
        (out_service(), placed_custom(p="marketing_blast")),
        (out_service(), placed_custom(k="anything")),
        (out_service(), placed_custom(tenant=str(uuid.UUID(int=0xBAD)))),                # the line is another workspace's
        (out_service(store=LineStore(line={**VL_LINE, "provider": "plivo"})), placed_custom()),
        (out_service(mode="off"), placed_custom()),
    ]
    for svc, custom in cases:
        sim, task = await outbound_call(svc, custom)
        await asyncio.wait_for(task, 10)
        assert sim.heard.audio_bytes == 0, custom
    # not on the sandbox list (the callee): refused again at the socket, although the gate said yes when it was placed
    sim, task = await outbound_call(out_service(), placed_custom(), to="+919000000001")
    await asyncio.wait_for(task, 10)
    assert sim.heard.audio_bytes == 0


@arun
async def test_a_busy_line_refuses_an_outbound_call_and_a_missing_repo_admits_nothing() -> None:
    class Busy:
        def count(self) -> int:
            return 9

    sim, task = await outbound_call(out_service(), placed_custom(), live=Busy())
    await asyncio.wait_for(task, 10)
    assert sim.heard.audio_bytes == 0
    svc = out_service()
    svc.outbound_repo = None
    sim, task = await outbound_call(svc, placed_custom())
    await asyncio.wait_for(task, 10)
    assert sim.heard.audio_bytes == 0


# ------------------------------------------------------------------------------------------------------------------ the webhook
def hook_client(repo: OutRepo | None = None, *, on: bool = True) -> tuple[TestClient, OutRepo]:
    repo = repo or OutRepo()
    app = FastAPI()
    app.include_router(router)
    app.add_exception_handler(ApiError, lambda request, exc: JSONResponse({"error": exc.code}, status_code=exc.status_code))
    svc = out_service(repo)
    if not on:
        svc.voicelink = None
    app.state.runtime = SimpleNamespace(phone_inbound=svc)
    return TestClient(app), repo


def event(name: str, status: str = "", **over: Any) -> dict[str, Any]:
    return {"event": name, "callId": "1764828073.53871", "fromNumber": "918065590140", "toNumber": "9000000998", "direction": "outbound", "callStatus": status, "duration": 0,
            "customParameters": json.dumps({"call": str(ROW), "tenant": str(TENANT)}), **over}


def test_initiated_records_voicelinks_call_id_on_our_row_and_ended_unanswered_closes_it() -> None:
    client, repo = hook_client()
    assert client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.initiated")).json() == {"ok": True}
    assert ("ringing", "1764828073.53871") in repo.calls
    assert client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.ended", "NO ANSWER")).status_code == 200
    assert ("finish", ("no_answer", "no_answer")) in repo.calls
    client2, repo2 = hook_client()
    client2.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.ended", "BUSY"))
    assert ("finish", ("busy", "busy")) in repo2.calls


def test_an_answered_call_is_left_to_its_own_session_and_a_stranger_changes_nothing() -> None:
    client, repo = hook_client(OutRepo(state="in_progress"))
    client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.ended", "ANSWER", duration=42))
    client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.completed", "ANSWER", recordingUrl="https://x/y.wav"))
    assert [c for c in repo.calls if c[0] in ("finish", "ringing")] == []
    inbound_only = {"event": "call.ended", "callId": "1.2", "direction": "inbound", "callStatus": "ANSWER", "duration": 9}   # an inbound call: no row of ours is named
    client3, repo3 = hook_client()
    assert client3.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=inbound_only).status_code == 200 and repo3.calls == []


def test_the_webhook_answers_only_with_the_token_and_only_for_small_json() -> None:
    client, _ = hook_client()
    assert client.post("/v1/telephony/voicelink/webhook/" + TOKEN[:-1] + "x", json=event("call.ended")).status_code == 404
    assert hook_client(on=False)[0].post(f"/v1/telephony/voicelink/webhook/{TOKEN}", json=event("call.ended")).status_code == 404
    assert client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", content=b"not json").status_code == 400
    assert client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", content=b"[1,2]").status_code == 400
    assert client.post(f"/v1/telephony/voicelink/webhook/{TOKEN}", content=b"x" * 70_000).status_code == 413


def test_the_dynamic_inbound_call_answer_names_our_bot_and_webhook_with_the_token() -> None:
    client, _ = hook_client()
    r = client.post(f"/v1/telephony/voicelink/inbound_call/{TOKEN}", json={"callerId": "918065590140", "customerNumber": "9000000998", "callId": "eca4d07b-3afb-4e9d-b666-597adf5ea584", "sid": "stream_x"})
    assert r.status_code == 200 and r.json() == {"ws_url": f"wss://api.example.test/v1/telephony/voicelink/ws/{TOKEN}?call_id=eca4d07b-3afb-4e9d-b666-597adf5ea584", "webhook_url": f"{BASE}/v1/telephony/voicelink/webhook/{TOKEN}"}
    assert client.post("/v1/telephony/voicelink/inbound_call/wrong", json={}).status_code == 404


# ------------------------------------------------------------------------------------------------------------------ the wallet check and the provider choice
def test_the_wallet_reader_gives_the_two_facts_of_the_balance_check_and_a_foreign_currency_is_a_failed_read() -> None:
    assert VoicelinkBalanceReader(api(FakeVoicelink()), currency="INR").account_details() == {"cash_credits": 812.5, "auto_recharge": None, "recording_numbers": 0}
    with pytest.raises(VoicelinkError):
        VoicelinkBalanceReader(api(FakeVoicelink(wallet={"balance": 10, "currency": "USD"})), currency="INR").account_details()


def test_the_alert_names_the_provider_and_the_portal_to_top_up_in() -> None:
    account, limit = Account(Decimal("120.50"), None), Limit.build(500, "INR", 0.0)
    assert "VoiceLink reports 120.5 INR" in alert_detail(account, limit, "VoiceLink") and "Top up in the VoiceLink portal" in alert_detail(account, limit, "VoiceLink")
    assert whatsapp_text(Decimal("120.5"), Decimal(500), None, "VoiceLink").startswith("VoiceLink balance is low")
    assert "Plivo" in alert_detail(account, limit)   # the default is unchanged


def settings(**kw: Any) -> Settings:
    return Settings(**{"api_env": "development", **kw})


def test_voicelink_is_the_provider_whose_login_is_given_unless_the_setting_says_otherwise() -> None:
    assert voicelink_in_use(settings(voicelink_username="u", voicelink_password="p")) is True
    assert voicelink_in_use(settings()) is False
    assert voicelink_in_use(settings(voicelink_username="u", voicelink_password="p", plivo_auth_id="id", plivo_auth_token="t" * 20)) is False  # both given: Plivo's wins until the setting names VoiceLink
    assert voicelink_in_use(settings(telephony_provider="voicelink", plivo_auth_id="id", plivo_auth_token="t" * 20)) is True
    assert voicelink_in_use(settings(telephony_provider="plivo", voicelink_username="u", voicelink_password="p")) is False


def test_the_repository_carries_the_providers_word_on_its_calls_and_line_lookup() -> None:
    sent: list[tuple[str, dict[str, Any]]] = []

    class Rpc:
        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            sent.append((function, args))
            return {"id": str(ROW)}

        def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
            sent.append((function, args))
            return {"id": str(ROW)}

    repo = PostgrestOutboundRepo(cast(Any, Rpc()), provider="voicelink")
    repo.line_for_tenant("t", TENANT)
    repo.begin("t", TENANT, "visit_reminder", "en")
    assert [a["p_provider"] for f, a in sent] == ["voicelink", "voicelink"]
    assert PostgrestOutboundRepo(cast(Any, Rpc())).line_for_tenant("t", TENANT) is None or True
    assert sent[-1][1]["p_provider"] == "plivo", "the default is unchanged"


def test_a_username_with_spaces_and_capitals_goes_to_the_login_as_one_json_value() -> None:
    """The reseller login can be a full name with spaces (owner, 26 Nov 2026): it travels as one JSON string, never split, trimmed or put into a URL (a made-up name here)."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"status": True, "data": {"access_token": "tok"}})
        return httpx.Response(200, json={"data": {"wallet": {"balance": "100", "currency": "INR"}, "currency": "INR"}, "status": True})

    client = httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))
    VoicelinkApi("Ada Test Lovelace-Example", "  pa ss word  ", client=client).wallet()
    login = seen[0]
    assert json.loads(login.content) == {"username": "Ada Test Lovelace-Example", "password": "  pa ss word  "}
    assert "Ada" not in str(login.url) and "Lovelace" not in str(login.url), "never in the address"


def test_the_picker_reads_list_the_types_and_the_numbers_for_sale_and_never_buy() -> None:
    """did-types and purchase/dids are READS (28 Nov 2026): the filter is sent as `number`, the rate stays inside our object, nothing is locked or confirmed."""
    seen: list[tuple[str, str, dict[str, str]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "tok"}, "status": True})
        seen.append((request.method, request.url.path, dict(request.url.params)))
        if request.url.path.endswith("/reseller/did-types"):
            return httpx.Response(200, json={"data": [{"id": 2, "name": "Mobile", "requires_request": 0}, {"id": 4, "name": "140 Series", "requires_request": 1}], "status": True})
        return httpx.Response(200, json={"data": {"data": [{"id": 7, "did_type": 2, "did_number": "+919876543210", "type_label": "Mobile", "monthly_rate": 299, "total_price": 299}, {"id": 8, "did_number": "bad"}, "junk"]}, "status": True})

    client = httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))
    vl = VoicelinkApi("u", "p", client=client)
    assert [t["name"] for t in vl.did_types()] == ["Mobile", "140 Series"]
    found = vl.available_dids(did_type=2, prefix="9876", per_page=500)
    assert [(d.did_id, d.number, d.type_label, d.monthly_rate) for d in found] == [(7, "+919876543210", "Mobile", 299.0)]
    method, path, params = seen[1]
    assert method == "GET" and path.endswith("/reseller/purchase/dids") and params == {"country_code": "+91", "type": "2", "months": "1", "per_page": "100", "page": "1", "number": "9876"}
    assert all(m == "GET" for m, _, _ in seen), "a read never posts"


def test_the_probe_prints_counts_and_closed_words_only(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    """scripts/voicelink_probe.py: four reads, no password, no token, no full number in its output; a refusal prints the closed word."""
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("voicelink_probe", Path(__file__).resolve().parents[3] / "scripts" / "voicelink_probe.py")
    assert spec is not None and spec.loader is not None
    probe = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(probe)

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "secret-token-xyz"}, "status": True})
        if path.endswith("/reseller/profile"):
            return httpx.Response(200, json={"data": {"wallet": {"balance": 5000, "currency": "INR"}}, "status": True})
        if path.endswith("/reseller/did-types"):
            return httpx.Response(200, json={"data": [{"id": 2, "name": "Mobile", "requires_request": 0}, {"id": 3, "name": "Landline", "requires_request": 0}], "status": True})
        if request.url.params.get("type") == "3":
            return httpx.Response(403, json={"status": False, "message": "plan"})
        return httpx.Response(200, json={"data": {"data": [{"id": 7, "did_number": "+919876543210", "type_label": "Mobile", "monthly_rate": 299}]}, "status": True})

    real = probe.VoicelinkApi
    monkeypatch.setattr(probe, "VoicelinkApi", lambda u, p: real(u, p, client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("VOICELINK_USERNAME", "Ada Test Lovelace-Example")
    monkeypatch.setenv("VOICELINK_PASSWORD", "never-printed-password")
    assert probe.main(["--prefix", "98"]) == 0
    out = capsys.readouterr().out
    assert "did-types: ok 2=Mobile, 3=Landline" in out and "mobile: ok 1 rows, first ends ...3210" in out and "mobile filter '98': ok 1 rows" in out
    assert "landline: auth (status 403)" in out
    assert "never-printed-password" not in out and "secret-token-xyz" not in out and "9876543210" not in out and "299" not in out


def test_the_diagnosis_script_reads_numbers_routing_and_bots_and_never_prints_a_token_or_password(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    import hashlib
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("voicelink_diagnose", Path(__file__).resolve().parents[3] / "scripts" / "voicelink_diagnose.py")
    assert spec is not None and spec.loader is not None
    diag = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diag)
    token = "t" * 64

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "secret-bearer-xyz"}, "status": True})
        if path.endswith("/reseller/profile"):
            return httpx.Response(200, json={"data": {"wallet": {"balance": 4900, "currency": "INR"}}, "status": True})
        if path.endswith("/reseller/did/purchased"):
            return httpx.Response(200, json={"data": {"data": [{"did_number": "919429492464", "type_label": "Mobile", "status": 2, "user_status": 2, "is_expired": False, "expiry_date": "2026-12-31", "auto_renew": True, "client_id": 5, "call_routing": {"for_inbound_call": 3, "for_outbound_call": 3, "status": 1}}]}, "status": True})
        if path.endswith("/call-routing/list"):
            return httpx.Response(200, json={"data": [{"did_number": "9429492464", "for_inbound_call": 3, "for_outbound_call": 3, "status": 1, "status_label": "Active"}], "status": True})
        if path.endswith("/websocket-bot/list"):
            return httpx.Response(200, json={"data": {"data": [{"bot_name": "Stack19", "status": 1, "status_label": "Active", "client_id": 5, "websocket_url": f"wss://api.example.test/v1/telephony/voicelink/ws/{token}", "webhook_url": f"https://api.example.test/v1/telephony/voicelink/webhook/{token}"}]}, "status": True})
        return httpx.Response(404)

    real = diag.VoicelinkApi
    monkeypatch.setattr(diag, "VoicelinkApi", lambda u, p: real(u, p, client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("VOICELINK_USERNAME", "Ada Test Lovelace-Example")
    monkeypatch.setenv("VOICELINK_PASSWORD", "never-printed-password")
    assert diag.main() == 0
    out = capsys.readouterr().out
    assert "...2464 Mobile status=2" in out and "routing: inbound=3 outbound=3 status=1" in out and "Stack19: status=1 (Active)" in out
    assert f"<token len=64 sha8={hashlib.sha256(token.encode()).hexdigest()[:8]}>" in out and "wss://api.example.test/v1/telephony/voicelink/ws/<token" in out
    assert token not in out and "never-printed-password" not in out and "secret-bearer-xyz" not in out and "9429492464" not in out


def test_recording_on_reads_the_flag_the_cautious_way_and_the_wallet_reader_counts_numbers_that_record() -> None:
    from app.telephony.voicelink_api import VoicelinkBalanceReader, recording_on

    assert [recording_on({"call_recording": v}) for v in (1, "1", True, "Yes", "enabled", 0, "0", False, "No", "off", None)] == [True, True, True, True, True, False, False, False, False, False, False]
    assert recording_on({"call_recording_label": "Yes"}) is True and recording_on({}) is False, "no field: nothing to count (the daily check cannot see it, the diagnose line shows off)"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "t"}, "status": True})
        if request.url.path.endswith("/reseller/profile"):
            return httpx.Response(200, json={"data": {"wallet": {"balance": 100, "currency": "INR"}}, "status": True})
        return httpx.Response(200, json={"data": {"data": [{"did_number": "919429492464", "call_recording": 1}, {"did_number": "919400000001", "call_recording": 0}]}, "status": True})

    reader = VoicelinkBalanceReader(VoicelinkApi("u", "p", client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))), currency="INR")
    assert reader.account_details() == {"cash_credits": 100.0, "auto_recharge": None, "recording_numbers": 1}


def test_the_call_detail_script_prints_field_names_and_only_non_personal_values(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    import importlib.util
    from pathlib import Path

    spec = importlib.util.spec_from_file_location("voicelink_call_detail", Path(__file__).resolve().parents[3] / "scripts" / "voicelink_call_detail.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    record = {"call_id": "1764.5", "unique_id": "u-1", "did_number": "919429492464", "customer_number": "919573989785", "call_status": "Answered", "duration": 67, "total_cost": "0.5000", "bot_type": 3,
              "recording": "https://files.example.test/client_1/secret.mp3", "created_at": "2026-11-24 18:48:33", "meta": {"caller": "919573989785", "hangup_by": "bot"}, "events": [{"type": "x", "number": "9195"}]}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/auth/login"):
            return httpx.Response(200, json={"data": {"access_token": "bearer-xyz"}, "status": True})
        return httpx.Response(200, json={"data": record, "status": True})

    real = mod.VoicelinkApi
    monkeypatch.setattr(mod, "VoicelinkApi", lambda u, p: real(u, p, client=httpx.Client(base_url="https://vl.test/api/v1", transport=httpx.MockTransport(handler))))
    monkeypatch.setenv("VOICELINK_USERNAME", "u")
    monkeypatch.setenv("VOICELINK_PASSWORD", "never-printed")
    assert mod.main(["x", "61872340-19d3-400a-a0fb-1d5de68502bf"]) == 0
    out = capsys.readouterr().out
    assert "call_status: str = 'Answered'" in out and "duration: int = 67" in out and "total_cost: str = '0.5000'" in out and "did_number: str (length 12)" in out and "hangup_by: str = 'bot'" in out
    for secret in ("919429492464", "919573989785", "secret.mp3", "bearer-xyz", "never-printed", "files.example.test"):
        assert secret not in out, secret
