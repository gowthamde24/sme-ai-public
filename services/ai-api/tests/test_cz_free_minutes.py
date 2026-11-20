# ruff: noqa: E501
"""Customer Zero's free minutes, the call path (owner and planner decision, 19 Nov 2026; migration 20261231986200). The database says whether a business's own number of minutes is used up (pgTAP 256); this is what the
Python side does with it. Fakes only: no network, no key, nobody is dialled.

An INCOMING call to a business whose minutes are used up rings the shop's own phone (a <Dial> answer) instead of the assistant answering; every other business whose minutes are used up gets the hang-up, as before. An OUTGOING
assistant call stops with ONE plain sentence for the Owner (409 free_minutes_used_up with `minutes` and `restarts_on`, so the web can say it in the Owner's language); every other refusal keeps its own answer."""

from __future__ import annotations

import logging
import uuid
from typing import Any

import pytest

from app.telephony import plivo
from app.telephony.free_minutes import free_minutes_used_up
from app.telephony.plivo_outbound import OutboundRefused
from app.telephony.plivo_routes import BOOK, FORWARDED, RecentForwards, _forward_to
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pl_inbound import ANSWER, OWNER, PLIVO_LINE, Capture, post, ring, service
from tests.test_pl_outbound import LINE, FakeRepo, _owner_client, placer

SHOP = "919848012345"   # the shop's own phone, as the database gives it: digits with the country code
FREE = {"minutes": 500, "restarts_on": "2026-12-01"}
USED_UP = {**PLIVO_LINE, "billing_blocked": True, "free_minutes": FREE, "forward_to": SHOP}


@pytest.fixture(autouse=True)
def _no_forwards_remembered() -> None:
    FORWARDED._seen.clear()


def _client(line: dict[str, Any]) -> Any:
    client, _ = make_client(phone_inbound=service(line=line))
    return client


# ------------------------------------------------------------------------------------------------------------------------ incoming: ring the shop's own phone
def test_a_call_to_a_business_whose_free_minutes_are_used_up_rings_the_shops_own_phone_and_the_assistant_never_answers() -> None:
    BOOK._items.clear()
    r = post(_client(USED_UP), ANSWER, ring())
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/xml"), r.text
    assert r.text == f'<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="40"><Number>{SHOP}</Number></Dial></Response>' and "<Stream" not in r.text
    assert "Hangup" not in r.text and BOOK._items == {}, "the assistant did not take the call: nothing was admitted"


def test_every_other_business_that_is_used_up_is_still_hung_up_on() -> None:
    BOOK._items.clear()
    for line in (
        {**PLIVO_LINE, "billing_blocked": True},                                  # no forward number at all (the plan's own minutes: early access)
        {**PLIVO_LINE, "billing_blocked": True, "forward_to": None},
        {**PLIVO_LINE, "billing_blocked": True, "forward_to": ""},
        {**PLIVO_LINE, "billing_blocked": True, "forward_to": "not a number"},
        {**USED_UP, "inbound_on": False},                                         # the assistant is switched off for incoming calls: as before
    ):
        r = post(_client(line), ANSWER, ring())
        assert r.status_code == 200 and "<Hangup/>" in r.text and "<Dial" not in r.text, line


def test_a_business_that_is_not_used_up_gets_the_assistant_as_always() -> None:
    BOOK._items.clear()
    r = post(_client({**PLIVO_LINE, "billing_blocked": False, "free_minutes": FREE, "forward_to": None}), ANSWER, ring())
    assert "<Stream" in r.text and "<Dial" not in r.text


def test_the_shops_phone_is_never_the_businesss_own_line_and_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    assert _forward_to({"forward_to": SHOP}, "+918065590129") == "+919848012345"
    assert _forward_to({"forward_to": "918065590129"}, "+918065590129") is None, "a call must never be sent back to the line it came to"
    assert _forward_to({"forward_to": None}, "+918065590129") is None and _forward_to({}, "+918065590129") is None and _forward_to({"forward_to": 5}, "+918065590129") is None
    assert _forward_to({"forward_to": "12"}, "+918065590129") is None
    handler = Capture()
    plivo_log = logging.getLogger("app.telephony.plivo")
    plivo_log.addHandler(handler)
    plivo_log.setLevel(logging.INFO)
    try:
        BOOK._items.clear()
        post(_client(USED_UP), ANSWER, ring())
    finally:
        plivo_log.removeHandler(handler)
    text = " ".join(handler.records) + caplog.text
    assert SHOP not in text and "9848012345" not in text and OWNER not in text, "no phone number in a log"


def test_a_call_the_shops_phone_sent_back_to_us_is_not_rung_round_again() -> None:
    """The shop's mobile may forward to our number when it is not answered, so the call we send to it can come back."""
    BOOK._items.clear()
    client = _client(USED_UP)
    assert "<Dial" in post(client, ANSWER, ring()).text, "the first time: the shop's phone rings"
    again = post(client, ANSWER, ring(CallUUID="66666666-2222-3333-4444-555555555555"))
    assert "<Hangup/>" in again.text and "<Dial" not in again.text, "the same caller a moment later: it came back, so it is hung up on"
    other = post(client, ANSWER, ring(From="919876543210", CallUUID="77777777-2222-3333-4444-555555555555"))
    assert "<Dial" in other.text, "another caller is not affected"
    from_the_shop = post(client, ANSWER, ring(From=SHOP, CallUUID="88888888-2222-3333-4444-555555555555"))
    assert "<Hangup/>" in from_the_shop.text, "a call that shows the shop's own phone as the caller is the shop's forward: never rung again"


def test_the_loop_breaker_forgets_after_its_window_and_keeps_no_number() -> None:
    now = [100.0]
    forwards = RecentForwards(window_s=120, clock=lambda: now[0])
    assert forwards.came_back("a") is False and forwards.came_back("a") is True
    now[0] += 121
    assert forwards.came_back("a") is False, "after the window the same caller is sent on again"
    assert forwards.came_back("b") is False and set(forwards._seen) == {"a", "b"}
    now[0] += 500
    forwards.came_back("c")
    assert set(forwards._seen) == {"c"}, "old entries are dropped"
    assert SHOP not in repr(FORWARDED._seen) and all(len(k) < 40 for k in FORWARDED._seen), "keys are keyed fingerprints, never a number"


def test_the_dial_answer_holds_digits_only_and_nothing_a_caller_can_shape() -> None:
    xml = plivo.dial_xml("+91 98480-12345")
    assert xml == '<?xml version="1.0" encoding="UTF-8"?><Response><Dial timeout="40"><Number>919848012345</Number></Dial></Response>'
    assert "<" not in plivo.dial_xml("</Number><Hangup/>9848012345").split("<Number>")[1].split("</Number>")[0]
    assert plivo.dial_xml("919848012345", timeout=25).count('timeout="25"') == 1


# ------------------------------------------------------------------------------------------------------------------------ outgoing: one plain sentence
def test_the_words_for_a_used_up_allowance() -> None:
    assert free_minutes_used_up(FREE) == ("Your 500 free minutes this month are used up. Calls restart on 1 Dec.", 500, "2026-12-01")
    assert free_minutes_used_up({"minutes": 60, "restarts_on": "2027-01-01"}) == ("Your 60 free minutes this month are used up. Calls restart on 1 Jan.", 60, "2027-01-01")
    for odd in (None, {}, "x", {"minutes": True, "restarts_on": "2026-12-01"}, {"minutes": "500", "restarts_on": "2026-12-01"}, {"minutes": -1, "restarts_on": "2026-12-01"}, {"minutes": 500, "restarts_on": "soon"}, {"minutes": 500}):
        assert free_minutes_used_up(odd) is None, odd


def test_an_outgoing_refusal_carries_the_allowance_only_for_billing_blocked() -> None:
    line = {"line_id": str(uuid.uuid4()), "number": LINE, "provider": "plivo", "account_ref": None, "external_ref": None, "billing_blocked": True, "free_minutes": FREE}
    out, repo, api = placer(repo=FakeRepo(line=line))
    with pytest.raises(OutboundRefused) as caught:
        out.place("tok", TENANT_A.id, OWNER, approval_kind="owner_test")
    assert caught.value.reason == "billing_blocked" and caught.value.free_minutes == FREE and api.placed == []
    assert [r["refuse_reason"] for r in repo.rows.values()] == ["billing_blocked"], "the refusal is kept on a refused row as before"
    plain, _, _ = placer(repo=FakeRepo(line={**line, "free_minutes": None}))
    with pytest.raises(OutboundRefused) as other:
        plain.place("tok", TENANT_A.id, OWNER, approval_kind="owner_test")
    assert other.value.reason == "billing_blocked" and other.value.free_minutes is None, "a business with no number of its own: the old refusal"
    elsewhere, _, _ = placer(repo=FakeRepo(line={**line, "billing_blocked": False}))
    with pytest.raises(OutboundRefused) as not_sandbox:
        elsewhere.place("tok", TENANT_A.id, "+919876543210", approval_kind="owner_test")
    assert not_sandbox.value.reason == "not_on_sandbox_list" and not_sandbox.value.free_minutes is None


URL = f"/v1/tenants/{TENANT_A.id}/calls/place"


def test_the_owners_call_stops_with_one_plain_sentence_and_the_code_the_web_translates() -> None:
    line = {"line_id": str(uuid.uuid4()), "number": LINE, "provider": "plivo", "account_ref": None, "external_ref": None, "billing_blocked": True, "free_minutes": FREE}
    out, _, api = placer(repo=FakeRepo(line=line))
    r = _owner_client(out).post(URL, json={"to": OWNER}, headers=auth("a_owner"))
    assert r.status_code == 409 and api.placed == []
    error = r.json()["error"]
    assert error["code"] == "free_minutes_used_up" and error["message"] == "Your 500 free minutes this month are used up. Calls restart on 1 Dec."
    assert error["minutes"] == 500 and error["restarts_on"] == "2026-12-01" and OWNER not in r.text


def test_a_business_without_its_own_number_keeps_the_old_answer() -> None:
    line = {"line_id": str(uuid.uuid4()), "number": LINE, "provider": "plivo", "account_ref": None, "external_ref": None, "billing_blocked": True}
    out, _, _ = placer(repo=FakeRepo(line=line))
    r = _owner_client(out).post(URL, json={"to": OWNER}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "call_not_allowed" and r.json()["error"]["reason"] == "billing_blocked"
