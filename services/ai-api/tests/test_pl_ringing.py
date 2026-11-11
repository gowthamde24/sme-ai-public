"""A call that is still RINGING (11 Nov 2026): its clock starts at the answer, a test call is named for what it is, and "End call" on a ringing call cancels it through Plivo and closes the row."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from app.telephony.plivo_outbound import OutboundRefused
from app.telephony.service import shape
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pl_inbound import OWNER
from tests.test_pl_outbound import outbound_service, placer

NOW = datetime(2026, 11, 11, 10, 0, tzinfo=UTC)
URL = f"/v1/tenants/{TENANT_A.id}/calls"


def row(**over: object) -> dict[str, object]:
    return {"id": uuid.uuid4(), "direction": "outbound", "state": "ringing", "created_at": (NOW - timedelta(seconds=43)).isoformat(), "answered_at": None, "live": True, "purpose": "visit_reminder", "provider": "plivo", **over}


def test_a_ringing_call_has_no_seconds_and_the_clock_starts_at_the_answer() -> None:
    assert shape(row(), NOW)["elapsed_s"] == 0, "43 seconds of ringing are not 43 seconds of call"
    answered = row(state="in_progress", answered_at=(NOW - timedelta(seconds=12)).isoformat())
    assert shape(answered, NOW)["elapsed_s"] == 12
    done = row(state="completed", live=False, answered_at=(NOW - timedelta(seconds=90)).isoformat(), duration_s=75)
    assert shape(done, NOW)["elapsed_s"] == 75, "a finished call shows its length"


def test_a_call_with_nobody_behind_it_is_a_test_call_and_the_others_keep_their_names() -> None:
    assert shape(row(), NOW)["who"] == "Test call"
    assert shape(row(contact_name="Ravi"), NOW)["who"] == "Ravi"
    assert shape(row(lead_id=str(uuid.uuid4())), NOW)["who"] != "Test call", "a call for a lead is not a test call"
    assert shape(row(task_id=str(uuid.uuid4())), NOW)["who"] != "Test call"
    assert shape(row(direction="inbound"), NOW)["who"] != "Test call", "a caller we do not know is not a test call"


def test_cancel_asks_plivo_by_the_request_id_and_closes_the_row_as_cancelled() -> None:
    out, repo, api = placer()
    placed = out.place("t", TENANT_A.id, OWNER)
    assert repo.rows[placed.call_id]["state"] == "ringing"
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "cancelled"
    assert api.cancelled == [placed.provider_call_id] and api.hung_up == []
    assert repo.rows[placed.call_id]["state"] == "cancelled" and repo.rows[placed.call_id]["end_reason"] == "stopped"
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "not_ringing", "a second End call finds nothing to do"


def test_when_plivo_no_longer_knows_the_request_it_is_ended_as_a_call_and_the_row_still_closes() -> None:
    out, repo, api = placer()
    placed = out.place("t", TENANT_A.id, OWNER)
    api.cancel_result = False
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "cancelled"
    assert api.hung_up == [placed.provider_call_id] and repo.rows[placed.call_id]["state"] == "cancelled"


def test_an_answered_or_finished_or_foreign_row_is_left_alone() -> None:
    out, repo, api = placer()
    placed = out.place("t", TENANT_A.id, OWNER)
    repo.rows[placed.call_id]["state"] = "in_progress"
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "not_ringing"
    repo.rows[placed.call_id]["state"] = "completed"
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "not_ringing"
    repo.rows[placed.call_id].update(state="ringing", provider="exotel")
    assert out.cancel("t", TENANT_A.id, placed.call_id) == "not_ringing", "another provider's call is not ours to cancel"
    assert out.cancel("t", TENANT_A.id, uuid.uuid4()) == "not_ringing"
    assert api.cancelled == [] and api.hung_up == []


def test_end_call_on_a_ringing_call_cancels_it_over_http_and_says_so_when_there_is_nothing_to_end() -> None:
    from app.telephony.live import LiveCalls
    from app.telephony.service import CallsService
    from tests.test_ph_calls_api import LIVE_ID, FakeCallsRepo

    out, repo, api = placer()
    svc = outbound_service()
    svc.outbound = out
    placed = out.place("t", TENANT_A.id, OWNER)
    calls = FakeCallsRepo()
    calls.rows[placed.call_id] = {**calls.rows[LIVE_ID], "id": placed.call_id, "state": "ringing", "answered_at": None}
    client, _ = make_client(phone_inbound=svc, calls=CallsService(calls, clock=lambda: NOW), live_calls=LiveCalls())
    assert client.post(f"{URL}/{placed.call_id}/hang-up", headers=auth("a_sales")).status_code == 403
    r = client.post(f"{URL}/{placed.call_id}/hang-up", headers=auth("a_owner"))
    assert r.status_code == 202, r.text
    assert repo.rows[placed.call_id]["state"] == "cancelled" and api.cancelled == [placed.provider_call_id]
    again = client.post(f"{URL}/{placed.call_id}/hang-up", headers=auth("a_owner"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "call_not_here", "a second End call finds nothing to end"
    api.fail_with = None
    other = out.place("t", TENANT_A.id, OWNER)
    calls.rows[other.call_id] = {**calls.rows[LIVE_ID], "id": other.call_id, "state": "ringing", "answered_at": None}
    from app.telephony.plivo_api import PlivoError

    def boom(_: str) -> bool:
        raise PlivoError("unavailable")

    api.cancel_request = boom   # type: ignore[method-assign,assignment]
    assert client.post(f"{URL}/{other.call_id}/hang-up", headers=auth("a_owner")).status_code == 502, "Plivo cannot be reached: said plainly, the row stays as it was"
    assert repo.rows[other.call_id]["state"] == "ringing"


def test_a_refused_placing_is_unchanged() -> None:
    out, _, _ = placer(numbers=frozenset({"+919000000001"}))
    try:
        out.place("t", TENANT_A.id, OWNER)
    except OutboundRefused as refused:
        assert refused.reason == "not_on_sandbox_list"
    else:
        raise AssertionError("the gate must refuse")
