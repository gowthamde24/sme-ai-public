"""Outbound calls on Plivo (job 3 phase B, 10 Nov 2026). Fakes only: no network, no key, nobody is dialled.

Proven: the gate decides before anything is dialled (sandbox list, hours 09:00 to 21:00 IST, mode, consent, the line) and every refusal is kept as a refused call row with its closed word; a placed call is a queued row,
then a Plivo request whose answer and hangup addresses carry ids and closed words only (no number), then ringing; the answer for it is signed and checked again against the sandbox list; the media socket runs the SAME
pipeline on the EXISTING row (nothing new is begun) and the assistant says it is an AI in a test call; a call nobody answers ends its row from Plivo's hangup callback; the dialer maps the row's end onto the outreach
worker's answers; the Owner's endpoint is Owner-only. No log carries a phone number."""

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
from app.telephony import gate, inbound, persona
from app.telephony.inbound_routes import InboundService
from app.telephony.plivo_api import FakePlivoApi, PlivoError
from app.telephony.plivo_outbound import (
    TEST_OPENING,
    OutboundRefused,
    PlivoDialer,
    PlivoOutbound,
    finish_after_hangup,
)
from app.telephony.plivo_routes import BOOK, Admission, PlivoConfig, handle
from app.telephony.simulator import QueueWire, SimulatedPlivo
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dv_browser_voice import arun, until
from tests.test_ph_inbound import FakeStore, fake_parts
from tests.test_pl_inbound import BASE, OWNER, PLIVO_LINE, TOKEN, Capture, post, ring, signed

LINE = "+918065590129"
INDIA_10AM = datetime(2026, 11, 10, 4, 30, tzinfo=UTC)    # 10:00 in India
INDIA_3AM = datetime(2026, 11, 9, 21, 30, tzinfo=UTC)     # 03:00 in India
TENANT = TENANT_A.id


class FakeRepo:
    """The database side of placing a call, with the state machine of phone_call_* in miniature."""

    def __init__(self, line: dict[str, Any] | None = None) -> None:
        self.line = {"line_id": str(uuid.uuid4()), "number": LINE, "provider": "plivo", "account_ref": None, "external_ref": None} if line is None else line
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}
        self.tokens: list[str] = []

    def line_for_tenant(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        self.tokens.append(token)
        return self.line or None

    def begin(self, token: str, tenant_id: uuid.UUID, purpose: str, language: str, refuse_reason: str | None = None) -> uuid.UUID:
        row = uuid.uuid4()
        self.rows[row] = {"state": "refused" if refuse_reason else "queued", "refuse_reason": refuse_reason, "purpose": purpose, "language": language, "end_reason": None, "provider_call_sid": None}
        return row

    def ringing(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, provider_call_id: str) -> None:
        self.rows[call_id].update(state="ringing", provider_call_sid=provider_call_id)

    def finish_unanswered(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID, state: str, end_reason: str) -> None:
        assert self.rows[call_id]["state"] in ("queued", "ringing", "in_progress"), "a finished call is not finished again"
        self.rows[call_id].update(state=state, end_reason=end_reason)

    def state(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any] | None:
        return self.rows.get(call_id)


def placer(*, mode: str = "sandbox", numbers: frozenset[str] = frozenset({OWNER}), now: datetime = INDIA_10AM, repo: FakeRepo | None = None, api: FakePlivoApi | None = None,
           confirmed: bool = False, active: int = 0) -> tuple[PlivoOutbound, FakeRepo, FakePlivoApi]:
    repo, api = repo or FakeRepo(), api or FakePlivoApi()
    settings = gate.Settings(mode=mode, live_confirmed=confirmed, sandbox_numbers=numbers, max_concurrent=2, outbound=True)   # type: ignore[arg-type]
    return PlivoOutbound(api=api, repo=repo, gate_settings=settings, public_base=BASE, active_calls=lambda: active, clock=lambda: now), repo, api


# ---------------------------------------------------------------------------------------------------------------------------------- the gate decides first
def test_a_test_call_to_the_owners_own_phone_is_placed_from_the_businesss_line_with_ids_only_in_the_addresses() -> None:
    out, repo, api = placer()
    placed = out.place("tok", TENANT, OWNER, business="Padma Silks")
    assert repo.rows[placed.call_id]["state"] == "ringing" and repo.rows[placed.call_id]["provider_call_sid"] == placed.provider_call_id
    call = api.placed[0]
    assert call["from"] == LINE and call["to"] == OWNER
    for url in (call["answer_url"], call["hangup_url"]):
        assert url.startswith(f"{BASE}/v1/telephony/plivo/") and f"call={placed.call_id}" in url and f"tenant={TENANT}" in url and "lang=en" in url and "p=visit_reminder" in url and "k=test" in url
        assert "9502380998" not in url and OWNER not in url, "no number in an address Plivo (and our logs) will see"
    assert call["answer_url"].split("?")[0].endswith("/outbound-answer") and call["hangup_url"].split("?")[0].endswith("/hangup")
    assert repo.tokens == ["tok"]


@pytest.mark.parametrize(("kw", "number", "reason"), [
    (dict(), "+919876543210", "not_on_sandbox_list"),                      # a phone that is not the owner's
    (dict(now=INDIA_3AM), OWNER, "outside_window"),                        # 03:00 in India
    (dict(mode="off"), OWNER, "telephony_off"),
    (dict(mode="live"), OWNER, "live_not_confirmed"),
    (dict(mode="live", confirmed=True), OWNER, "no_consent"),               # live has no consent path yet: only an owner's own sandbox phone counts as consenting
    (dict(), "garbage", "bad_number"),
    (dict(active=2), OWNER, "too_many_calls"),
])
def test_every_refusal_is_a_closed_word_kept_on_a_refused_row_and_nothing_is_dialled(kw: dict[str, Any], number: str, reason: str) -> None:
    out, repo, api = placer(**kw)
    with pytest.raises(OutboundRefused) as caught:
        out.place("tok", TENANT, number)
    assert caught.value.reason == reason and api.placed == []
    assert [r["refuse_reason"] for r in repo.rows.values()] == [reason] and [r["state"] for r in repo.rows.values()] == ["refused"]


def test_a_business_with_no_plivo_line_places_nothing() -> None:
    out, repo, api = placer(repo=FakeRepo(line={}))
    with pytest.raises(OutboundRefused) as caught:
        out.place("tok", TENANT, OWNER)
    assert caught.value.reason == "no_such_line" and api.placed == []


def test_plivo_failing_ends_the_row_as_failed_and_says_so() -> None:
    api = FakePlivoApi()
    api.fail_with = "unavailable"
    out, repo, _ = placer(api=api)
    with pytest.raises(PlivoError):
        out.place("tok", TENANT, OWNER)
    assert [(r["state"], r["end_reason"]) for r in repo.rows.values()] == [("failed", "error")], "never left ringing"


def test_the_test_opening_says_it_is_an_ai_and_that_it_is_a_test() -> None:
    line = persona.opening_line("en", business="Padma Silks", assistant=None, customer=None, owner_line=TEST_OPENING["en"], inbound=False)
    assert gate.has_ai_disclosure(line) and "test call" in line and "Padma Silks" in line


# ---------------------------------------------------------------------------------------------------------------------------------- the answer for a call we placed
ROW = uuid.UUID(int=0xABC)
OUT = "/v1/telephony/plivo/outbound-answer"
QUERY = f"call={ROW}&tenant={TENANT}&lang=en&p=visit_reminder&k=test"


def outbound_service(store: FakeStore | None = None, *, numbers: frozenset[str] = frozenset({OWNER}), repo: FakeRepo | None = None) -> InboundService:
    svc = InboundService(secret=b"", public_base=BASE, gate_settings=gate.Settings(mode="sandbox", sandbox_numbers=numbers, max_concurrent=2, outbound=True),
                         store=cast(Any, store or FakeStore(line={**PLIVO_LINE, "tenant_id": str(TENANT)})), calls=None, cost_paise_per_minute=100, language="en", business="Stack19 Owner Test",
                         max_call_s=20, parts_for=fake_parts, plivo=PlivoConfig(auth_token=TOKEN, public_base=BASE))
    svc.outbound_repo = repo or FakeRepo()
    return svc


def ring_out(**over: str) -> dict[str, str]:
    """What Plivo asks when the callee of a call we placed picks up: From is OUR line, To is the callee."""
    return {"CallUUID": "55555555-2222-3333-4444-555555555555", "From": "918065590129", "To": "919502380998", "Direction": "outbound", "CallStatus": "in-progress", "Event": "StartApp", **over}


def _client(svc: InboundService) -> Any:
    client, _ = make_client(phone_inbound=svc)
    return client


def signed_query(path_with_query: str, params: dict[str, str], token: str = TOKEN) -> dict[str, str]:
    from urllib.parse import parse_qsl, urlsplit

    from app.telephony import plivo_signature

    query = dict(parse_qsl(urlsplit(path_with_query).query, keep_blank_values=True))
    # as REAL Plivo signs a call placed through the REST API (11 Nov 2026): the fields include the query keys
    return {"x-plivo-signature-v3": plivo_signature.sign(token, "POST", BASE + path_with_query, "n-9", {**params, **query}), "x-plivo-signature-v3-nonce": "n-9"}


def test_the_answer_to_a_call_we_placed_is_signed_checked_against_the_list_again_and_opens_the_stream_on_the_existing_row() -> None:
    BOOK._items.clear()
    params = ring_out()
    r = _client(outbound_service()).post(f"{OUT}?{QUERY}", data=params, headers=signed_query(f"{OUT}?{QUERY}", params))
    assert r.status_code == 200 and "<Stream" in r.text and "/v1/telephony/plivo/stream/" in r.text and "9502380998" not in r.text
    admitted = BOOK._items[params["CallUUID"]]
    assert admitted.outbound is not None and admitted.outbound.row_id == ROW and admitted.outbound.purpose == "visit_reminder" and admitted.caller == OWNER and admitted.line_no == LINE
    assert admitted.outbound.opening_line == TEST_OPENING["en"] and admitted.outbound.goal and "TEST" in admitted.outbound.goal


def test_a_forged_or_changed_answer_is_refused_or_hung_up_and_admits_nothing() -> None:
    cases: list[tuple[str, dict[str, str], dict[str, Any], int, str]] = [
        (QUERY, ring_out(), dict(numbers=frozenset({"+919000000001"})), 200, "Hangup"),                       # the callee is not on the list any more
        (f"call={ROW}&tenant={uuid.uuid4()}&lang=en&p=visit_reminder&k=test", ring_out(), {}, 200, "Hangup"),  # another workspace's id: not this line's workspace
        (f"call={ROW}&tenant={TENANT}&lang=xx&p=visit_reminder&k=test", ring_out(), {}, 200, "Hangup"),
        (f"call={ROW}&tenant={TENANT}&lang=en&p=cold_call&k=test", ring_out(), {}, 200, "Hangup"),
        (f"call=notauuid&tenant={TENANT}&lang=en&p=visit_reminder&k=test", ring_out(), {}, 200, "Hangup"),
    ]
    for query, params, kw, status, word in cases:
        BOOK._items.clear()
        path = f"{OUT}?{query}"
        r = _client(outbound_service(**kw)).post(path, data=params, headers=signed_query(path, params))
        assert r.status_code == status and word in r.text and BOOK._items == {}, query
    client = _client(outbound_service())
    assert client.post(f"{OUT}?{QUERY}", data=ring_out()).status_code == 403, "no signature"
    other = f"{OUT}?{QUERY}&x=1"
    assert client.post(other, data=ring_out(), headers=signed_query(f"{OUT}?{QUERY}", ring_out())).status_code == 403, "the signature is for the address Plivo called"


# ---------------------------------------------------------------------------------------------------------------------------------- the call itself, on the existing row
@arun
async def test_a_call_we_placed_runs_the_same_pipeline_on_the_existing_row_and_is_recorded_as_outbound() -> None:
    store = FakeStore(line={**PLIVO_LINE, "tenant_id": str(TENANT)})
    svc = outbound_service(store)
    BOOK._items.clear()
    call = "66666666-2222-3333-4444-555555555555"
    from app.telephony.inbound_routes import OutboundCall

    BOOK.put(call, Admission(LINE, OWNER, TENANT, outbound=OutboundCall(row_id=ROW, language="en", purpose="visit_reminder", goal="g", opening_line=TEST_OPENING["en"])))
    records = Capture()
    for name in ("app.telephony.inbound", "app.telephony.plivo"):
        logging.getLogger(name).addHandler(records)
        logging.getLogger(name).setLevel(logging.INFO)
    ours, theirs = QueueWire.pair()
    sim = SimulatedPlivo(theirs, pace=0, call_id=call)
    token = inbound.mint(svc.plivo.ws_secret(), inbound.monotonic(), call, "") if svc.plivo else ""
    task = asyncio.ensure_future(handle(svc, SimpleNamespace(limits=Limits()), None, token, ours, open_timeout=2.0))
    try:
        await sim.connect()
        await until(lambda: bool(sim.heard.marks), 5)
        await sim.speak_for(600)
        await sim.quiet_for(700)
        await until(lambda: len(store.progress) == 1, 5)
        await asyncio.sleep(1.0)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        for name in ("app.telephony.inbound", "app.telephony.plivo"):
            logging.getLogger(name).removeHandler(records)
    assert store.begun == [], "the row already existed: nothing new is begun"
    assert store.progress and store.progress[0][0] == ROW, "the EXISTING row moves to in progress"
    assert len(store.finished) == 1 and store.finished[0][0] == ROW
    assert sim.heard.problems == [] and sim.heard.audio_bytes > 0
    text = " ".join(records.records)
    assert "9502380998" not in text and "8065590129" not in text and call not in text, "no number, no raw call id in the log"
    assert any("plivo_outbound admitted" in m for m in records.records)


# ---------------------------------------------------------------------------------------------------------------------------------- a call nobody answers
@pytest.mark.parametrize(("status", "state", "reason"), [("busy", "busy", "busy"), ("no-answer", "no_answer", "no_answer"), ("timeout", "no_answer", "no_answer"), ("failed", "failed", "error"),
                                                         ("cancel", "cancelled", "stopped"), ("completed", "failed", "error"), ("something-new", "failed", "error")])
def test_plivos_hangup_ends_a_row_nobody_answered_with_the_matching_state(status: str, state: str, reason: str) -> None:
    repo = FakeRepo()
    row = repo.begin("t", TENANT, "visit_reminder", "en")
    repo.ringing("t", TENANT, row, "sid-1")
    assert finish_after_hangup(repo, "t", TENANT, row, status) == state
    assert repo.rows[row]["state"] == state and repo.rows[row]["end_reason"] == reason


def test_a_row_that_is_in_progress_finished_or_unknown_is_left_alone() -> None:
    repo = FakeRepo()
    row = repo.begin("t", TENANT, "visit_reminder", "en")
    repo.rows[row]["state"] = "in_progress"
    assert finish_after_hangup(repo, "t", TENANT, row, "completed") is None and repo.rows[row]["state"] == "in_progress", "the call session finishes a call that ran"
    repo.rows[row]["state"] = "completed"
    assert finish_after_hangup(repo, "t", TENANT, row, "busy") is None
    assert finish_after_hangup(repo, "t", TENANT, uuid.uuid4(), "busy") is None


def test_the_hangup_callback_of_a_placed_call_nobody_answered_ends_its_row_over_http() -> None:
    repo = FakeRepo()
    row = repo.begin("t", TENANT, "visit_reminder", "en")
    repo.ringing("t", TENANT, row, "sid-1")
    store = FakeStore(line={**PLIVO_LINE, "tenant_id": str(TENANT)})
    store.scheduler_token = lambda: "scheduler-token"   # type: ignore[attr-defined]
    svc = outbound_service(store, repo=repo)
    params = {"CallUUID": "77777777-2222-3333-4444-555555555555", "CallStatus": "busy", "Event": "Hangup", "Direction": "outbound", "From": "918065590129", "To": "919502380998", "HangupCauseName": "User Busy"}
    path = f"/v1/telephony/plivo/hangup?call={row}&tenant={TENANT}"
    client = _client(svc)
    assert client.post(path, data=params, headers=signed_query(path, params)).status_code == 200
    assert repo.rows[row]["state"] == "busy"
    assert client.post(path, data=params).status_code == 403, "unsigned"


# ---------------------------------------------------------------------------------------------------------------------------------- the dialer
class FakeOutbound:
    def __init__(self, repo: FakeRepo, refuse: str | None = None, fail: bool = False) -> None:
        self.repo, self.refuse, self.fail = repo, refuse, fail

    def place(self, token: str, tenant_id: uuid.UUID, to_number: str, *, language: str = "en", purpose: str = "x", kind: str = "task", business: str = "b") -> Any:
        if self.refuse:
            raise OutboundRefused(self.refuse)
        if self.fail:
            raise PlivoError("unavailable")
        row = self.repo.begin(token, tenant_id, purpose, language)
        self.repo.ringing(token, tenant_id, row, "sid")
        return SimpleNamespace(call_id=row, provider_call_id="sid", state="ringing")


def dialer(repo: FakeRepo, ends: dict[str, Any] | None = None, **kw: Any) -> PlivoDialer:
    """A dialer on a fake clock; `ends` is what the call row becomes while the dialer waits (the call finishing)."""
    now = [0.0]

    def clock() -> float:
        return now[0]

    def sleep(seconds: float) -> None:
        now[0] += seconds
        if ends is not None:
            (row,) = repo.rows
            repo.rows[row].update(ends)

    return PlivoDialer(cast(Any, FakeOutbound(repo, **kw)), repo, lambda: "tok", max_wait_s=20.0, poll_s=2.0, sleep=sleep, clock=clock)


def call_dict() -> dict[str, Any]:
    return {"tenant_id": str(TENANT), "item_id": str(uuid.uuid4()), "phone": OWNER, "language": "en"}


def test_the_dialer_maps_how_a_call_ended_onto_the_outreach_workers_answers() -> None:
    for state, expected in (("busy", "busy"), ("no_answer", "no_answer"), ("failed", "failed"), ("voicemail", "voicemail")):
        assert dialer(FakeRepo(), {"state": state}).dial(call_dict()).result == expected, state
    done = dialer(FakeRepo(), {"state": "completed", "duration_s": 95, "outcome": "positive", "category": "interested", "captured": {"budget": "50 lakh"}}).dial(call_dict())
    assert done.result == "connected" and done.minutes == 1.6 and done.outcome is not None and done.outcome["category"] == "interested" and not done.stop
    assert dialer(FakeRepo(), {"state": "completed", "duration_s": 20, "outcome": "negative", "category": "do_not_call"}).dial(call_dict()).stop is True, "do not call again stops the item"


def test_the_dialer_reports_a_refusal_a_provider_failure_and_a_call_that_never_ends_as_failed() -> None:
    assert dialer(FakeRepo(), refuse="outside_window").dial(call_dict()).result == "failed"
    assert dialer(FakeRepo(), fail=True).dial(call_dict()).result == "failed"
    assert dialer(FakeRepo()).dial(call_dict()).result == "failed", "still ringing after the wait: the worker is not held"


# ---------------------------------------------------------------------------------------------------------------------------------- the Owner's endpoint
def _owner_client(out: PlivoOutbound | None) -> Any:
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc)
    return client


URL = f"/v1/tenants/{TENANT_A.id}/calls/place"


def test_only_the_owner_places_a_test_call_and_the_gate_refusal_is_a_409_with_its_reason() -> None:
    out, repo, api = placer()
    client = _owner_client(out)
    ok = client.post(URL, json={"to": OWNER}, headers=auth("a_owner"))
    assert ok.status_code == 202 and ok.json()["state"] == "ringing" and api.placed and uuid.UUID(ok.json()["call_id"]) in repo.rows
    for role in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(URL, json={"to": OWNER}, headers=auth(role)).status_code == 403, role
    refused = client.post(URL, json={"to": "+919876543210"}, headers=auth("a_owner"))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "call_not_allowed" and refused.json()["error"]["reason"] == "not_on_sandbox_list"
    assert len(api.placed) == 1, "the refused one was not dialled"
    assert client.post(URL, json={"to": OWNER, "language": "xx"}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={"to": OWNER, "extra": 1}, headers=auth("a_owner")).status_code == 422


def test_a_provider_failure_is_a_502_and_a_deployment_that_places_nothing_is_a_503() -> None:
    api = FakePlivoApi()
    api.fail_with = "rejected"
    out, _, _ = placer(api=api)
    failed = _owner_client(out).post(URL, json={"to": OWNER}, headers=auth("a_owner"))
    assert failed.status_code == 502 and failed.json()["error"]["code"] == "call_provider_failed"
    off = _owner_client(None).post(URL, json={"to": OWNER}, headers=auth("a_owner"))
    assert off.status_code == 503 and off.json()["error"]["code"] == "calls_unavailable"


def test_the_signed_helper_used_here_is_the_one_of_the_inbound_tests() -> None:
    assert callable(signed) and callable(post) and callable(ring)   # (re-used, so both files sign the way Plivo does)


# ---- 11 Nov 2026: the answer URL and the hangup URL of a call we placed both carry a query; both pass signed, both are refused when anything is changed, and the hangup's cause is logged either way
def test_the_answer_and_hangup_urls_with_a_query_pass_when_signed_and_are_refused_when_changed(caplog: Any) -> None:
    import logging

    from app.telephony import plivo_signature

    BOOK._items.clear()
    answer_path = f"{OUT}?{QUERY}"
    hangup_path = f"/v1/telephony/plivo/hangup?call={ROW}&tenant={TENANT}&lang=en&p=visit_reminder&k=test"
    answer_form = ring_out()
    hangup_form = {"CallUUID": "88888888-2222-3333-4444-555555555555", "CallStatus": "completed", "Event": "Hangup", "Direction": "outbound", "From": "918065590129", "To": "919502380998",
                   "HangupCauseName": "Normal Hangup", "HangupSource": "Callee", "Duration": "7", "BillDuration": "7"}
    client = _client(outbound_service())
    for path, form in ((answer_path, answer_form), (hangup_path, hangup_form)):
        good = signed_query(path, form)
        assert client.post(path, data=form, headers=good).status_code == 200, path
        assert client.post(path + "&x=1", data=form, headers=good).status_code == 403, "a changed address"
        assert client.post(path, data={**form, "To": "919000000099"}, headers=good).status_code == 403, "a changed field"
        assert client.post(path, data=form, headers={**good, "x-plivo-signature-v3-nonce": "n-10"}).status_code == 403, "the nonce is part of the signature"
        assert client.post(path, data=form, headers={**good, "x-plivo-signature-v3": plivo_signature.sign("X" * 24, "POST", BASE + path, "n-9", form)}).status_code == 403, "another token"
        assert client.post(path, data=form, headers={k: v for k, v in good.items() if k != "x-plivo-signature-v3-nonce"}).status_code == 403, "no nonce"
        body_only = {"x-plivo-signature-v3": plivo_signature.sign(TOKEN, "POST", BASE + path, "n-9", form), "x-plivo-signature-v3-nonce": "n-9"}
        assert client.post(path, data=form, headers=body_only).status_code == 403, "the reading real Plivo uses has the query keys among the fields; the body alone no longer passes"
        ma = {"x-plivo-signature-v3": "bad", "x-plivo-signature-ma-v3": good["x-plivo-signature-v3"], "x-plivo-signature-v3-nonce": "n-9"}
        assert client.post(path, data=form, headers=ma).status_code == 200, "the Ma-V3 header (the main account's token) is read too"
    with caplog.at_level(logging.INFO, logger="app.telephony.plivo"):
        caplog.clear()
        assert client.post(hangup_path, data=hangup_form).status_code == 403
        text = caplog.text
    assert "signed=NO" in text and "Normal Hangup" in text and "Callee" in text, "the cause and the source are logged even when the signature fails"
    assert "919502380998" not in text and "918065590129" not in text and "plivo_signature_failed" in text and "query_keys=call,tenant,lang,p,k" in text
