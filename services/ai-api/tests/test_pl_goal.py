"""An outbound call with a goal the owner typed (job 3 phase B+, 10 Nov 2026). Fakes only: nobody is dialled.

Proven: the goal is accepted only as plain words (no number, address or link); it reaches the assistant inside the platform's own frame and never travels in an address or a log; the call opens in its language with a plain
line that says it is an AI (not the line-check); a call meant to carry a goal never runs without it, and a goal is used once; the gate still decides first; the line-check stays English."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any

import pytest

from app.telephony import gate, persona
from app.telephony.plivo_api import FakePlivoApi, PlivoError
from app.telephony.plivo_outbound import (
    PENDING,
    TEST_GOAL,
    OutboundRefused,
    PendingGoals,
    frame_goal,
    opening_for,
)
from app.telephony.plivo_routes import BOOK
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pl_inbound import OWNER, Capture
from tests.test_pl_outbound import (
    OUT,
    TENANT,
    outbound_service,
    placer,
    ring_out,
    signed_query,
)

GOAL = "Ask Lakshmi what colour and occasion she wants for a Kanchipuram saree, offer to send photos on WhatsApp, and book a shop visit"
URL = f"/v1/tenants/{TENANT_A.id}/calls/place"


def goal_query(row: uuid.UUID, kind: str = "goal", lang: str = "en") -> str:
    return f"call={row}&tenant={TENANT}&lang={lang}&p=visit_reminder&k={kind}"


def answer(svc: Any, row: uuid.UUID, kind: str = "goal", lang: str = "en") -> Any:
    BOOK._items.clear()
    params = ring_out()
    path = f"{OUT}?{goal_query(row, kind, lang)}"
    client, _ = make_client(phone_inbound=svc)
    return client.post(path, data=params, headers=signed_query(path, params))


# ---------------------------------------------------------------------------------------------------------------------------------- what the owner may type
def test_a_goal_is_plain_words_a_number_an_address_or_a_link_is_refused() -> None:
    out, repo, api = placer()
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc)
    ok = client.post(URL, json={"to": OWNER, "goal": GOAL}, headers=auth("a_owner"))
    assert ok.status_code == 202 and len(api.placed) == 1
    for bad in ("short", "x" * 401, "Call him back on 9502380998 about the saree", "Ask for 95 02 38 09 98 please call", "Write to ravi@example.com about the saree", "Send the link https://x.example/a to him",
                "Open www.example.com and read it", "line one\nline two is a control character here"):
        r = client.post(URL, json={"to": OWNER, "goal": bad}, headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error" and r.json()["error"]["fields"] == ["goal"], bad
    assert len(api.placed) == 1, "a refused goal dialled nobody"
    assert client.post(URL, json={"to": OWNER, "goal": GOAL}, headers=auth("a_admin")).status_code == 403, "still the Owner only"


def test_spacing_in_the_goal_is_tidied_and_the_goal_is_optional() -> None:
    out, _, api = placer()
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc)
    assert client.post(URL, json={"to": OWNER, "goal": "  Ask   about   the   colour   she   wants.  "}, headers=auth("a_owner")).status_code == 202
    assert client.post(URL, json={"to": OWNER}, headers=auth("a_owner")).status_code == 202 and len(api.placed) == 2


# ---------------------------------------------------------------------------------------------------------------------------------- the goal is kept in memory, never in an address or a log
def test_the_goal_goes_nowhere_but_memory_and_the_gate_still_decides_first() -> None:
    PENDING._items.clear()
    out, repo, api = placer()
    records = Capture()
    for name in ("app.telephony.plivo_outbound", "app.telephony.plivo"):
        logging.getLogger(name).addHandler(records)
        logging.getLogger(name).setLevel(logging.INFO)
    try:
        placed = out.place("tok", TENANT, OWNER, goal=GOAL, business="Padma Silks")
    finally:
        for name in ("app.telephony.plivo_outbound", "app.telephony.plivo"):
            logging.getLogger(name).removeHandler(records)
    call = api.placed[0]
    assert "k=goal" in call["answer_url"] and "Lakshmi" not in call["answer_url"] + call["hangup_url"] and "Kanchipuram" not in call["answer_url"], "ids and closed words only"
    assert "Lakshmi" not in " ".join(records.records) and repo.rows[placed.call_id]["state"] == "ringing"
    assert PENDING.take(placed.call_id) == GOAL
    refusing, repo2, api2 = placer(now=__import__("datetime").datetime(2026, 11, 9, 21, 30, tzinfo=__import__("datetime").timezone.utc))   # 03:00 in India
    with pytest.raises(OutboundRefused) as caught:
        refusing.place("tok", TENANT, OWNER, goal=GOAL)
    assert caught.value.reason == "outside_window" and api2.placed == [] and [r["refuse_reason"] for r in repo2.rows.values()] == ["outside_window"]
    assert not any(v for v in PENDING._items.values() if v[1] == GOAL and False), "a refused call keeps no goal"


def test_a_provider_failure_drops_the_goal() -> None:
    PENDING._items.clear()
    api = FakePlivoApi()
    api.fail_with = "unavailable"
    out, repo, _ = placer(api=api)
    with pytest.raises(PlivoError):
        out.place("tok", TENANT, OWNER, goal=GOAL)
    assert PENDING._items == {}


def test_a_refused_call_leaves_no_goal_behind() -> None:
    PENDING._items.clear()
    out, _, _ = placer(numbers=frozenset({"+919000000001"}))
    with pytest.raises(OutboundRefused):
        out.place("tok", TENANT, OWNER, goal=GOAL)
    assert PENDING._items == {}


def test_a_goal_is_remembered_for_ten_minutes_and_used_once() -> None:
    now = [0.0]
    pending = PendingGoals(ttl_s=600.0, clock=lambda: now[0])
    row = uuid.uuid4()
    pending.put(row, "g")
    assert pending.take(row) == "g" and pending.take(row) is None
    pending.put(row, "g")
    now[0] = 601.0
    assert pending.take(row) is None


# ---------------------------------------------------------------------------------------------------------------------------------- the answer: the goal reaches the assistant, in the platform's frame
def test_the_answer_gives_the_assistant_the_owners_goal_inside_the_platforms_frame_once() -> None:
    row = uuid.uuid4()
    PENDING.put(row, GOAL)
    r = answer(outbound_service(), row)
    assert r.status_code == 200 and "<Stream" in r.text and "Lakshmi" not in r.text
    admitted = next(iter(BOOK._items.values())).outbound
    assert admitted is not None and admitted.row_id == row
    assert admitted.goal is not None and GOAL in admitted.goal and "You cannot send anything or book anything yourself" in admitted.goal and "Never state a price" in admitted.goal
    assert admitted.opening_line is not None and "test call" not in admitted.opening_line and gate.has_ai_disclosure(admitted.opening_line)
    again = answer(outbound_service(), row)
    assert "Hangup" in again.text and BOOK._items == {}, "the goal was used: the same call cannot open a second socket"


def test_a_call_that_is_meant_to_carry_a_goal_never_runs_without_it() -> None:
    PENDING._items.clear()
    r = answer(outbound_service(), uuid.uuid4())
    assert "Hangup" in r.text and BOOK._items == {}


def test_a_task_call_uses_its_goal_when_it_has_one_and_the_purposes_own_when_not() -> None:
    row = uuid.uuid4()
    PENDING.put(row, "Ask whether the order arrived and whether they need more of the same.")
    answer(outbound_service(), row, kind="task")
    with_goal = next(iter(BOOK._items.values())).outbound
    assert with_goal is not None and with_goal.goal is not None and "whether the order arrived" in with_goal.goal
    answer(outbound_service(), uuid.uuid4(), kind="task")
    without = next(iter(BOOK._items.values())).outbound
    assert without is not None and without.goal is None


def test_an_unknown_kind_is_hung_up_on_and_the_line_check_keeps_its_own_goal() -> None:
    assert "Hangup" in answer(outbound_service(), uuid.uuid4(), kind="evil").text
    assert BOOK._items == {}
    answer(outbound_service(), uuid.uuid4(), kind="test")
    test = next(iter(BOOK._items.values())).outbound
    assert test is not None and test.goal == TEST_GOAL and test.opening_line is not None and "test call" in test.opening_line


# ---------------------------------------------------------------------------------------------------------------------------------- the opening
@pytest.mark.parametrize("language", ["en", "te", "hi", "kn", "ta", "ml", "mr"])
def test_a_goal_call_opens_in_its_language_with_a_plain_line_that_says_it_is_an_ai(language: str) -> None:
    template = opening_for("goal", language)
    assert template is not None and "{business}" in template
    line = persona.opening_line(language, business="Padma Silks", assistant=None, customer=None, owner_line=template, inbound=False)
    assert gate.has_ai_disclosure(line) and "Padma Silks" in line and "enquiry" not in line.lower() and "test call" not in line


def test_the_line_check_stays_english_even_when_another_language_is_asked_for() -> None:
    out, repo, api = placer()
    placed = out.place("tok", TENANT, OWNER, language="te")
    assert repo.rows[placed.call_id]["language"] == "en" and "lang=en" in api.placed[0]["answer_url"] and opening_for("test", "te") == opening_for("test", "en")


def test_the_frame_cuts_a_very_long_goal_and_keeps_the_owners_words() -> None:
    framed = frame_goal("  Ask   about the colour.  ")
    assert "Ask about the colour." in framed and len(frame_goal("x " * 500)) < 1000
