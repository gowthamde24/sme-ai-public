"""T010 part 2, commit 2: the HTTP side of follow-ups against an in-memory fake: authorization order and the role matrix on every endpoint, WHAT is sent to the database (the engine request built
from the lead's recorded state, the engine's result, the person's inputs, the caller's own token), that no body can carry wording, a contact, a status or an approver, the fixed error mapping of
SM220-SM229 (with every closed reason), the question drafts (random ids), the due list and the boundary (nothing here can send). The database rules are pgTAP 62-64; the real stack is
tests/integration/test_followup_*.py."""

from __future__ import annotations

import dataclasses
import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.followups import cadence_port, errors, service
from app.followups.builder import build_request
from app.followups.messages import FOLLOWUP_REFUSALS
from app.tenancy.repository import MfaRequired, UpstreamError
from tests.enquiries_fakes import FakeEnquiries
from tests.fakes import TENANT_A, FakeCrmRepository, auth, make_client
from tests.followups_fakes import (
    DRAFT,
    LEAD,
    NOW,
    POLICY,
    QUESTION,
    REQUIREMENT,
    FakeFollowups,
    draft_row,
    question_row,
    snapshot,
)

ID1 = "11111111-1111-4111-8111-111111111111"
ID2 = "22222222-2222-4222-8222-222222222222"
STATE_HASH = "c" * 64


class _Clock:
    """datetime for the service: now() is fixed, everything else is the real thing."""

    @staticmethod
    def now(tz: Any = None) -> datetime:
        return NOW


class World:
    def __init__(self) -> None:
        self.f = FakeFollowups()
        self.crm = FakeCrmRepository()
        self.crm.seed("leads", TENANT_A.id, LEAD)
        self.enq = FakeEnquiries()
        self.client, _ = make_client(followups=self.f, crm=self.crm, enquiries=self.enq)
        enquiry = self.f.requirements[REQUIREMENT]
        self.enq.requirement[enquiry] = (
            {
                "id": str(REQUIREMENT),
                "status": "draft",
                "created_via": "agent",
                "agent_run_id": None,
                "confirmed_by": None,
                "confirmed_at": None,
                "created_at": NOW.isoformat(),
            },
            [],
        )

    def url(self, path: str, tenant: uuid.UUID = TENANT_A.id) -> str:
        return f"/v1/tenants/{tenant}{path}"

    def call(
        self,
        method: str,
        path: str,
        body: Any,
        user: str | None,
        tenant: uuid.UUID = TENANT_A.id,
        **claims: Any,
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, self.url(path, tenant), json=body, headers=headers)


@pytest.fixture
def w(monkeypatch: pytest.MonkeyPatch) -> World:
    monkeypatch.setattr(service, "datetime", _Clock)
    return World()


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


POLICY_BODY = {
    "id": ID1,
    "effective_from": "2026-10-07",
    "gap_days": [1, 2],
    "max_touches": 3,
    "quiet_start": "21:00",
    "quiet_end": "09:00",
    "allowed_weekdays": [0, 1, 2, 3, 4],
    "holidays": ["2026-12-25"],
    "min_gap_hours": 24,
    "recipient_utc_offset_minutes": 330,
}
TOUCH_BODY = {"id": ID1, "direction": "out", "channel": "email"}
DRAFT_BODY = {"id": ID1, "channel": "email"}
APPROVE_BODY = {"state_hash": STATE_HASH}
SENT_BODY = {"touch_id": ID2}
ALL_ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/followup-policy-versions", None),
    ("POST", "/followup-policy-versions", POLICY_BODY),
    ("GET", f"/leads/{LEAD}/followup", None),
    ("POST", f"/leads/{LEAD}/touches", TOUCH_BODY),
    ("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY),
    ("GET", "/followups/due", None),
    ("GET", "/followup-drafts", None),
    ("GET", f"/followup-drafts/{DRAFT}", None),
    ("POST", f"/followup-drafts/{DRAFT}/approve", APPROVE_BODY),
    ("POST", f"/followup-drafts/{DRAFT}/discard", None),
    ("POST", f"/followup-drafts/{DRAFT}/sent", SENT_BODY),
    ("GET", f"/requirements/{REQUIREMENT}/question-drafts", None),
    ("POST", f"/requirements/{REQUIREMENT}/question-drafts/sync", None),
    ("POST", f"/question-drafts/{QUESTION}/approve", None),
    ("POST", f"/question-drafts/{QUESTION}/discard", None),
]


# ----------------------------------------------------------------------------- authorization
@pytest.mark.parametrize(("method", "path", "body"), ALL_ENDPOINTS)
def test_nobody_without_a_token_no_viewer_and_no_outsider_gets_anything_and_nothing_is_read(
    w: World, method: str, path: str, body: Any
) -> None:
    assert w.call(method, path, body, None).status_code == 401
    viewer = w.call(method, path, body, "a_viewer")
    assert viewer.status_code == 403 and code(viewer) == "forbidden"
    outsider = w.call(method, path, body, "outsider")
    assert outsider.status_code == 404 and code(outsider) == "not_found"
    assert (
        w.call(method, path, body, "b_owner", TENANT_A.id).status_code == 404
    )  # a member of ANOTHER tenant on this path
    assert w.f.tokens == [] and w.f.calls == []  # a refused caller never reaches the data layer


def test_publishing_a_policy_is_the_owners_with_a_second_factor_and_approving_a_draft_the_owners_or_admins(
    w: World,
) -> None:
    for user in ("a_admin", "a_sales"):
        assert w.call("POST", "/followup-policy-versions", POLICY_BODY, user).status_code == 403, (
            user
        )
    for claim in ({"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}):
        r = w.call("POST", "/followup-policy-versions", POLICY_BODY, "a_owner", **claim)
        assert r.status_code == 403 and code(r) == "mfa_required", claim
    assert (
        w.call("POST", f"/followup-drafts/{DRAFT}/approve", APPROVE_BODY, "a_sales").status_code
        == 403
    )
    for user in ("a_owner", "a_admin"):
        for claim in ({"aal": "aal1"}, {"aal": None}):
            r = w.call("POST", f"/followup-drafts/{DRAFT}/approve", APPROVE_BODY, user, **claim)
            assert r.status_code == 403 and code(r) == "mfa_required", (user, claim)
    assert w.f.calls == []
    assert w.call("POST", "/followup-policy-versions", POLICY_BODY, "a_owner").status_code == 201
    for user in ("a_owner", "a_admin"):
        assert (
            w.call("POST", f"/followup-drafts/{DRAFT}/approve", APPROVE_BODY, user).status_code
            == 200
        )


def test_sales_reads_records_touches_makes_and_discards_drafts_and_records_sent(w: World) -> None:
    for method, path, body in ALL_ENDPOINTS:
        if (
            "approve" in path
            and "question" not in path
            or path == "/followup-policy-versions"
            and method == "POST"
        ):
            continue  # the Owner's and Admin's (above)
        assert w.call(method, path, body, "a_sales").status_code in (200, 201), (method, path)


# ----------------------------------------------------------------------------- what is sent to the database
def test_a_policy_is_sent_as_the_engines_policy_with_the_caller_token_and_no_other_field(
    w: World,
) -> None:
    r = w.call("POST", "/followup-policy-versions", POLICY_BODY, "a_owner")
    assert r.status_code == 201
    [sent] = w.f.sent("create_policy")
    assert sent == {
        "p_version_id": ID1,
        "p_tenant_id": str(TENANT_A.id),
        "p_effective_from": "2026-10-07",
        "p_policy": {
            "gap_days": [1, 2],
            "max_touches": 3,
            "quiet_hours": {"start": "21:00", "end": "09:00"},
            "allowed_weekdays": [0, 1, 2, 3, 4],
            "holidays": ["2026-12-25"],
            "min_gap_hours": 24,
            "recipient_utc_offset_minutes": 330,
        },
    }
    assert set(r.json()) == {"version_id", "version_no", "effective_from", "replayed"}


def test_a_touch_is_the_persons_record_and_null_is_now(w: World) -> None:
    assert w.call("POST", f"/leads/{LEAD}/touches", TOUCH_BODY, "a_sales").status_code == 201
    assert w.f.sent("record_touch") == [
        {
            "p_touch_id": ID1,
            "p_lead_id": str(LEAD),
            "p_direction": "out",
            "p_channel": "email",
            "p_occurred_at": None,
        }
    ]
    stated = {**TOUCH_BODY, "id": ID2, "occurred_at": "2026-10-05T10:00:00+05:30"}
    assert w.call("POST", f"/leads/{LEAD}/touches", stated, "a_sales").status_code == 201
    assert w.f.sent("record_touch")[1]["p_occurred_at"] == "2026-10-05T10:00:00+05:30"
    for bad in (
        {"occurred_at": "2026-10-05T10:00:00"},
        {"occurred_at": "yesterday"},
        {"direction": "sideways"},
        {"channel": "sms"},
    ):
        assert (
            w.call(
                "POST",
                f"/leads/{LEAD}/touches",
                {**TOUCH_BODY, "id": str(uuid.uuid4()), **bad},
                "a_sales",
            ).status_code
            == 422
        ), bad
    assert len(w.f.sent("record_touch")) == 2


def test_a_draft_is_asked_for_with_the_engine_request_and_result_and_no_wording(w: World) -> None:
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    assert r.status_code == 201 and r.json() == {
        "draft_id": ID1,
        "lead_id": str(LEAD),
        "touch_number": 2,
        "status": "draft",
        "replayed": False,
    }
    [sent] = w.f.sent("create_draft")
    request = build_request(snapshot(), as_of=NOW)
    result = cadence_port.run_decide(request)
    assert result["action"] == "draft_followup"
    assert sent == {
        "p_draft_id": ID1,
        "p_lead_id": str(LEAD),
        "p_channel": "email",
        "p_engine_version": "1.0.0",
        "p_request_text": cadence_port.canonical_json(request),
        "p_result_text": cadence_port.canonical_json(result),
    }
    assert set(sent) == {
        "p_draft_id",
        "p_lead_id",
        "p_channel",
        "p_engine_version",
        "p_request_text",
        "p_result_text",
    }  # no wording, no contact, no status
    assert (
        w.f.tokens[-1] == w.f.tokens[0]
    )  # every call of one request carries the same caller token
    assert (
        cadence_port.expected_hash(request) == json.loads(sent["p_result_text"])["canonical_hash"]
    )


@pytest.mark.parametrize(
    "extra",
    [
        {"body": "Hello"},
        {"wording": "x"},
        {"contact_id": ID2},
        {"status": "approved"},
        {"touch_number": 2},
        {"tenant_id": ID2},
        {"request_text": "{}"},
        {"template_code": "x"},
    ],
)
def test_no_request_can_carry_wording_a_contact_a_status_or_a_tenant(
    w: World, extra: dict[str, Any]
) -> None:
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", {**DRAFT_BODY, **extra}, "a_sales")
    assert r.status_code == 422 and code(r) == "validation_error"
    assert w.f.calls == []


def test_a_draft_cannot_be_for_a_phone_call_and_a_bad_id_is_a_422(w: World) -> None:
    assert (
        w.call(
            "POST", f"/leads/{LEAD}/followup-drafts", {**DRAFT_BODY, "channel": "phone"}, "a_sales"
        ).status_code
        == 422
    )
    assert (
        w.call(
            "POST", f"/leads/{LEAD}/followup-drafts", {**DRAFT_BODY, "id": "not-a-uuid"}, "a_sales"
        ).status_code
        == 422
    )
    assert w.f.calls == []


def test_the_engine_still_runs_when_it_says_wait_and_the_database_decides(w: World) -> None:
    """The API never decides whether a follow-up is due: it hands the database what the engine said, whatever it said."""
    w.f.snapshots[LEAD] = snapshot(
        outbound_days_ago=(0,)
    )  # a touch just now: the engine answers wait
    assert (
        w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales").status_code == 201
    )
    [sent] = w.f.sent("create_draft")
    assert json.loads(sent["p_result_text"])["action"] == "wait"


def test_with_no_policy_in_force_the_database_is_asked_in_its_own_order(w: World) -> None:
    w.f.snapshots[LEAD] = snapshot(policy=None)
    assert (
        w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales").status_code == 201
    )
    [sent] = w.f.sent("create_draft")
    assert (sent["p_request_text"], sent["p_result_text"]) == ("{}", "{}")


def test_an_unknown_or_malformed_lead_is_a_404_and_never_asked_for(w: World) -> None:
    assert (
        w.call("POST", f"/leads/{uuid.uuid4()}/followup-drafts", DRAFT_BODY, "a_sales").status_code
        == 404
    )
    assert (
        w.call("POST", f"/leads/{uuid.uuid4()}/touches", TOUCH_BODY, "a_sales").status_code == 404
    )
    assert w.call("POST", "/leads/not-a-uuid/touches", TOUCH_BODY, "a_sales").status_code == 404
    assert w.call("GET", f"/leads/{uuid.uuid4()}/followup", None, "a_sales").status_code == 404
    assert w.f.sent("create_draft") == [] and w.f.sent("record_touch") == []


def test_an_unknown_draft_is_a_404_and_a_malformed_one_never_reaches_the_data_layer(
    w: World,
) -> None:
    for path in ("approve", "discard", "sent"):
        body = {"approve": APPROVE_BODY, "discard": None, "sent": SENT_BODY}[path]
        assert (
            w.call("POST", f"/followup-drafts/{uuid.uuid4()}/{path}", body, "a_owner").status_code
            == 404
        )
        assert (
            w.call("POST", f"/followup-drafts/not-a-uuid/{path}", body, "a_owner").status_code
            == 404
        )
    assert w.call("GET", f"/followup-drafts/{uuid.uuid4()}", None, "a_sales").status_code == 404
    assert [c for c in w.f.calls if c[0] in ("approve_draft", "discard_draft", "record_sent")] == []
    assert all(isinstance(a, uuid.UUID) for a in w.f.asked)


def test_approve_discard_and_sent_pass_exactly_what_the_person_gave(w: World) -> None:
    assert (
        w.call("POST", f"/followup-drafts/{DRAFT}/approve", APPROVE_BODY, "a_owner").status_code
        == 200
    )
    assert w.f.sent("approve_draft") == [{"p_draft_id": str(DRAFT), "p_state_hash": STATE_HASH}]
    assert (
        w.call(
            "POST", f"/followup-drafts/{DRAFT}/approve", {"state_hash": "nothex"}, "a_owner"
        ).status_code
        == 422
    )
    assert (
        w.call(
            "POST",
            f"/followup-drafts/{DRAFT}/approve",
            {**APPROVE_BODY, "approved_by": ID2},
            "a_owner",
        ).status_code
        == 422
    )
    assert w.call("POST", f"/followup-drafts/{DRAFT}/discard", None, "a_sales").json() == {
        "draft_id": str(DRAFT),
        "status": "discarded",
        "replayed": False,
    }
    assert (
        w.call(
            "POST",
            f"/followup-drafts/{DRAFT}/sent",
            {"touch_id": ID2, "occurred_at": "2026-10-07T11:00:00+05:30"},
            "a_sales",
        ).status_code
        == 201
    )
    assert w.f.sent("record_sent") == [
        {"p_draft_id": str(DRAFT), "p_touch_id": ID2, "p_occurred_at": "2026-10-07T11:00:00+05:30"}
    ]
    assert (
        w.call(
            "POST",
            f"/followup-drafts/{DRAFT}/sent",
            {**SENT_BODY, "status": "recorded_sent"},
            "a_sales",
        ).status_code
        == 422
    )


def test_a_replay_is_a_200_and_a_new_record_is_a_201(w: World) -> None:
    for method, path, body in (
        ("POST", "/followup-policy-versions", POLICY_BODY),
        ("POST", f"/leads/{LEAD}/touches", TOUCH_BODY),
        ("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY),
        ("POST", f"/followup-drafts/{DRAFT}/sent", SENT_BODY),
    ):
        w.f.replayed = False
        assert w.call(method, path, body, "a_owner").status_code == 201, path
        w.f.replayed = True
        r = w.call(method, path, body, "a_owner")
        assert r.status_code == 200 and r.json()["replayed"] is True, path


# ----------------------------------------------------------------------------- reading
def test_the_responses_never_carry_the_engine_texts_a_hash_of_the_request_or_a_key(
    w: World,
) -> None:
    w.f.drafts[DRAFT] = draft_row()
    r = w.call("GET", f"/followup-drafts/{DRAFT}", None, "a_sales")
    assert r.status_code == 200
    assert (
        "request_text" not in r.json()
        and "result_text" not in r.json()
        and "canonical_hash" not in r.json()
    )
    assert r.json()["state_hash"] == "a" * 64  # the fingerprint the person echoes back on approval


def test_a_row_with_a_column_the_model_does_not_know_is_refused_not_leaked(w: World) -> None:
    from pydantic import ValidationError

    w.f.drafts[DRAFT] = draft_row(request_text="{}")
    with pytest.raises(
        ValidationError
    ):  # the response model forbids extra columns: it never reaches a client
        w.call("GET", f"/followup-drafts/{DRAFT}", None, "a_sales")


def test_the_gate_is_passed_through_in_closed_words_including_key(w: World) -> None:
    for blocked in (None, "contact", "key", "erased", "consent", "unkeyed"):
        w.f.gate_result = {
            "blocked": blocked,
            "stopped": "order_accepted" if blocked == "key" else None,
            "policy_in_force": True,
        }
        r = w.call("GET", f"/leads/{LEAD}/followup?channel=whatsapp", None, "a_sales")
        assert r.status_code == 200 and r.json()["gate"]["blocked"] == blocked
        assert r.json()["channel"] == "whatsapp"
    assert w.f.sent("gate")[-1] == {"p_lead_id": str(LEAD), "p_channel": "whatsapp"}
    assert (
        w.call("GET", f"/leads/{LEAD}/followup?channel=phone", None, "a_sales").status_code == 422
    )


def test_the_lead_page_runs_the_engine_now_and_says_so_without_approving_anything(w: World) -> None:
    r = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()
    assert r["decision"] == {
        "action": "draft_followup",
        "reason_code": "eligible_now",
        "terminal": False,
        "touch_number": 2,
        "next_eligible_at": "2026-10-07T06:30:00Z",
        "engine_version": "1.0.0",
    }
    assert r["policy_version_id"] == str(POLICY)
    w.f.snapshots[LEAD] = snapshot(outbound_days_ago=(), policy=None)
    assert w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()["decision"] is None
    w.f.snapshots[LEAD] = snapshot(outbound_days_ago=(5,), has_won_opportunity=True)
    stop = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()["decision"]
    assert (stop["action"], stop["reason_code"], stop["terminal"], stop["next_eligible_at"]) == (
        "stop",
        "won",
        True,
        None,
    )
    w.f.snapshots[LEAD] = snapshot(
        touches=snapshot().touches
        + (
            snapshot(outbound_days_ago=(0,))
            .touches[0]
            .__class__(
                id=ID2,
                direction="out",
                channel="email",
                occurred_at=datetime(2026, 10, 8, 6, 30, tzinfo=NOW.tzinfo),
            ),
        )
    )
    rejected = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()["decision"]
    assert rejected["action"] is None and rejected["reason_code"] == "FUTURE_HISTORY"


def test_the_due_list_puts_each_candidate_to_the_engine_and_names_an_open_draft(w: World) -> None:
    w.f.drafts[DRAFT] = draft_row(status="approved")
    items = w.call("GET", "/followups/due", None, "a_sales").json()
    assert items == [
        {
            "lead_id": str(LEAD),
            "action": "draft_followup",
            "reason_code": "eligible_now",
            "touch_number": 2,
            "next_eligible_at": "2026-10-07T06:30:00Z",
            "open_draft_id": str(DRAFT),
        }
    ]
    w.f.snapshots[LEAD] = snapshot(policy=None)
    assert (
        w.call("GET", "/followups/due", None, "a_sales").json() == []
    )  # no policy: nothing is due, nothing is invented


STOP_REASONS = (
    "order_accepted",
    "order_declined",
    "order_cancelled",
    "quote_withdrawn",
    "lead_archived",
)


@pytest.mark.parametrize("reason", STOP_REASONS)
def test_a_lead_the_database_has_stopped_is_never_due_and_the_engine_is_not_asked(
    w: World, monkeypatch: pytest.MonkeyPatch, reason: str
) -> None:
    """Lead 5 of the rehearsal: an accepted order stops follow-ups in the DATABASE; the engine (pinned, unchanged) does not know orders and would say 'draft_followup'. The stop reason overrides it."""
    w.f.stopped_leads[LEAD] = reason

    def not_asked(request: Any) -> Any:
        raise AssertionError("the engine must not be asked about a stopped lead")

    monkeypatch.setattr(cadence_port, "run_decide", not_asked)
    page = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()
    assert page["gate"]["stopped"] == reason
    assert page["decision"] == {
        "action": "stop",
        "reason_code": reason,
        "terminal": True,
        "touch_number": None,
        "next_eligible_at": None,
        "engine_version": "none",
    }
    assert w.call("GET", "/followups/due", None, "a_sales").json() == []


def test_the_due_list_leaves_out_only_the_stopped_leads(w: World) -> None:
    other = uuid.UUID(int=0x2EAD)
    w.f.snapshots[other] = dataclasses.replace(snapshot(), lead_id=str(other))
    w.f.outbound_leads = [LEAD, other]
    w.f.stopped_leads[LEAD] = "order_accepted"
    items = w.call("GET", "/followups/due", None, "a_sales").json()
    assert [i["lead_id"] for i in items] == [str(other)]
    assert items[0]["action"] == "draft_followup"
    w.f.stopped_leads.clear()
    assert [i["lead_id"] for i in w.call("GET", "/followups/due", None, "a_sales").json()] == [
        str(LEAD),
        str(other),
    ]


def test_a_lead_that_is_not_stopped_still_gets_the_engines_answer(w: World) -> None:
    page = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales").json()
    assert page["gate"]["stopped"] is None
    assert (page["decision"]["action"], page["decision"]["engine_version"]) == (
        "draft_followup",
        "1.0.0",
    )


def test_a_draft_list_can_be_filtered_by_a_closed_status_only(w: World) -> None:
    assert w.call("GET", "/followup-drafts?status=active", None, "a_sales").status_code == 200
    assert w.call("GET", "/followup-drafts?status=bogus", None, "a_sales").status_code == 422
    assert w.call("GET", "/followup-drafts?limit=101", None, "a_sales").status_code == 422
    assert w.call("GET", "/followup-drafts?lead_id=not-a-uuid", None, "a_sales").status_code == 422


# ----------------------------------------------------------------------------- the engine cannot run
def test_when_the_engine_is_unavailable_nothing_is_recorded_and_the_answer_is_a_503(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(request: Any) -> Any:
        raise cadence_port.CadenceUnavailable

    monkeypatch.setattr(cadence_port, "run_decide", refuse)
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    assert r.status_code == 503 and code(r) == "followup_cadence_unavailable"
    assert w.f.sent("create_draft") == []


def test_when_the_engine_answers_something_unknown_nothing_is_recorded_and_the_answer_is_a_502(
    w: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    def odd(request: Any) -> Any:
        raise cadence_port.CadenceError

    monkeypatch.setattr(cadence_port, "run_decide", odd)
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    assert r.status_code == 502 and code(r) == "followup_cadence_failed"
    assert "followup" not in r.text.lower().replace("followup_cadence_failed", "").replace(
        "follow-up rules", ""
    )
    assert w.f.sent("create_draft") == []


# ----------------------------------------------------------------------------- the fixed error mapping
CASES: list[tuple[str, str | None]] = [
    (c, r) for c, rs in errors.REASONS.items() for r in (*rs, "other")
] + [(c, None) for c in ("SM221", "SM222", "SM224", "SM226", "SM228", "SM229")]


@pytest.mark.parametrize(("sqlstate", "reason"), CASES)
def test_every_refusal_and_every_closed_reason_has_its_own_fixed_sentence(
    w: World, sqlstate: str, reason: str | None
) -> None:
    w.f.raise_next = errors.refusal(sqlstate, reason)
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    status, name, texts = FOLLOWUP_REFUSALS[sqlstate]
    assert r.status_code == status
    body = r.json()["error"]
    assert body["code"] == name and body["message"] == texts[reason if reason is not None else "-"]
    assert body.get("reason") == reason
    assert sqlstate not in r.text  # the SQLSTATE itself is not shown


def test_a_detail_outside_the_closed_list_becomes_other_and_is_never_repeated() -> None:
    for sqlstate in errors.REASONS:
        e = errors.refusal(sqlstate, "CANARY-9f3b2c some private value")
        assert e.reason == "other" and "CANARY" not in str(e)
    assert (
        errors.refusal("SM221", "contact").reason is None
    )  # a code that carries no reason ignores a detail
    assert errors.refusal("SM220", None).reason == "other"


def test_every_sqlstate_of_the_family_is_mapped_and_nothing_outside_the_range() -> None:
    assert sorted(errors.SM_ERRORS) == [f"SM22{i}" for i in range(10)]
    assert sorted(FOLLOWUP_REFUSALS) == sorted(errors.SM_ERRORS)
    for sqlstate, (_, _, texts) in FOLLOWUP_REFUSALS.items():
        assert set(texts) == (
            set(errors.REASONS[sqlstate]) | {"other"} if sqlstate in errors.REASONS else {"-"}
        ), sqlstate


def test_the_generic_failures_keep_their_own_mapping(w: World) -> None:
    w.f.raise_next = MfaRequired("SM306")
    assert (
        code(w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales"))
        == "mfa_required"
    )
    w.f.raise_next = UpstreamError("CANARY-9f3b2c")
    r = w.call("POST", f"/leads/{LEAD}/touches", TOUCH_BODY, "a_sales")
    assert r.status_code == 502 and "CANARY" not in r.text


# ----------------------------------------------------------------------------- question drafts
def test_syncing_the_questions_sends_the_closed_templates_with_random_ids(w: World) -> None:
    first = w.call("POST", f"/requirements/{REQUIREMENT}/question-drafts/sync", None, "a_sales")
    assert first.status_code == 200, first.text
    second = w.call("POST", f"/requirements/{REQUIREMENT}/question-drafts/sync", None, "a_sales")
    one, two = (w.f.sent("persist_questions")[i]["p_items"] for i in (0, 1))
    assert one and len(one) == len(two)
    assert [(i["code"], i["line"], i["text"]) for i in one] == [
        (i["code"], i["line"], i["text"]) for i in two
    ]
    ids = [i["id"] for i in one + two]
    assert len(set(ids)) == len(ids), (
        "ids are random per call, never derived from the requirement, the code or the text"
    )
    assert all(str(uuid.UUID(i, version=4)) == i for i in ids)
    for item in one:
        assert set(item) == {"id", "code", "line", "text"}
        assert (
            re.fullmatch(r"(missing|conflicting|confirm)_[a-z_]+", item["code"])
            and 8 <= len(item["text"]) <= 300
        )
    assert first.json()["requirement_id"] == str(REQUIREMENT) and second.status_code == 200


def test_syncing_needs_a_requirement_the_caller_can_see(w: World) -> None:
    url = f"/requirements/{uuid.uuid4()}/question-drafts/sync"
    assert w.call("POST", url, None, "a_sales").status_code == 404
    w.enq.requirement.clear()  # no requirement row for the enquiry
    assert (
        w.call(
            "POST", f"/requirements/{REQUIREMENT}/question-drafts/sync", None, "a_sales"
        ).status_code
        == 404
    )
    assert w.f.sent("persist_questions") == []


def test_a_question_is_approved_or_discarded_by_its_own_endpoint_only(w: World) -> None:
    assert w.call("POST", f"/question-drafts/{QUESTION}/approve", None, "a_sales").json() == {
        "draft_id": str(QUESTION),
        "status": "approved",
        "replayed": False,
    }
    assert (
        w.call("POST", f"/question-drafts/{QUESTION}/discard", None, "a_sales").json()["status"]
        == "discarded"
    )
    assert [c["p_decision"] for c in w.f.sent("decide_question")] == ["approve", "discard"]
    assert (
        w.call("POST", f"/question-drafts/{uuid.uuid4()}/approve", None, "a_sales").status_code
        == 404
    )
    w.f.questions[QUESTION] = question_row(status="approved")
    listed = w.call("GET", f"/requirements/{REQUIREMENT}/question-drafts", None, "a_sales").json()
    assert [q["status"] for q in listed] == ["approved"]


# ----------------------------------------------------------------------------- the boundary: nothing here can send
def test_no_follow_up_module_imports_a_mail_or_messaging_client_and_only_the_repository_talks_http() -> (
    None
):
    package = Path(cadence_port.__file__).resolve().parent
    forbidden = re.compile(
        r"^\s*(import|from)\s+(smtplib|email|aiosmtplib|twilio|sendgrid|mailgun|boto3|botocore|slack_sdk|requests|urllib3|socket|ssl)\b",
        re.M,
    )
    http = re.compile(r"^\s*(import|from)\s+(httpx|aiohttp|urllib)\b", re.M)
    for path in package.glob("*.py"):
        text = path.read_text()
        assert not forbidden.search(text), path.name
        if path.name != "repository.py":
            assert not http.search(text), path.name
    assert not (package.parent / "followups" / "__init__.py").read_text().strip()


# ----------------------------------------------------------------------------- privacy: a client never learns that another person was erased by right
def test_an_erased_key_is_shown_to_a_client_as_a_plain_key_and_the_server_still_knows(
    w: World,
) -> None:
    w.f.raise_next = errors.refusal("SM220", "erased_key")
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    plain = FOLLOWUP_REFUSALS["SM220"][2]["key"]
    assert r.status_code == 409 and r.json()["error"] == {
        "code": "contact_blocked",
        "message": plain,
        "reason": "key",
    }
    assert (
        not re.search(r"erased[\s_-]*key", r.text, re.I) and "erased by right" not in r.text.lower()
    )
    # the same answer as a plain suppressed key: indistinguishable to the client
    w.f.raise_next = errors.refusal("SM220", "key")
    assert (
        w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales").json() == r.json()
    )
    assert (
        errors.refusal("SM220", "erased_key").internal_reason == "erased_key"
    )  # the typed exception keeps it for the server
    assert (
        errors.refusal("SM220", "erased").reason == "erased"
    )  # the contact ITSELF being erased is not hidden: it is about this lead's own contact


def test_no_sentence_a_client_can_see_mentions_an_erasure_by_right_or_an_erased_key() -> None:
    for sqlstate, (_, _, texts) in FOLLOWUP_REFUSALS.items():
        assert "erased_key" not in texts, sqlstate
        for reason, text in texts.items():
            assert "by right" not in text.lower() and not re.search(
                r"erased[\s_-]*key", text, re.I
            ), (sqlstate, reason)
    assert (
        "erased_key" not in errors.REASONS["SM220"] and "erased_key" in errors.DB_REASONS["SM220"]
    )


# ----------------------------------------------------------------------------- the lead page survives an engine that cannot run; creating a draft does not
@pytest.mark.parametrize(
    "failure",
    [cadence_port.CadenceUnavailable, cadence_port.CadenceError, cadence_port.CadenceInputError],
)
def test_the_lead_page_shows_everything_but_a_decision_when_the_engine_cannot_run(
    w: World, monkeypatch: pytest.MonkeyPatch, failure: type[Exception]
) -> None:
    w.f.drafts[DRAFT] = draft_row()
    w.f.gate_result = {"blocked": "key", "stopped": None, "policy_in_force": True}

    def refuse(request: Any) -> Any:
        raise failure

    monkeypatch.setattr(cadence_port, "run_decide", refuse)
    r = w.call("GET", f"/leads/{LEAD}/followup", None, "a_sales")
    assert r.status_code == 200, r.text
    page = r.json()
    assert page["decision"] is None
    assert (
        page["gate"]["blocked"] == "key"
        and [d["id"] for d in page["drafts"]] == [str(DRAFT)]
        and page["policy_version_id"] == str(POLICY)
    )
    assert "touches" in page


@pytest.mark.parametrize(
    ("failure", "status", "name"),
    [
        (cadence_port.CadenceUnavailable, 503, "followup_cadence_unavailable"),
        (cadence_port.CadenceError, 502, "followup_cadence_failed"),
        (cadence_port.CadenceInputError, 502, "followup_cadence_failed"),
    ],
)
def test_creating_a_draft_stays_fail_closed_when_the_engine_cannot_run(
    w: World, monkeypatch: pytest.MonkeyPatch, failure: type[Exception], status: int, name: str
) -> None:
    def refuse(request: Any) -> Any:
        raise failure

    monkeypatch.setattr(cadence_port, "run_decide", refuse)
    r = w.call("POST", f"/leads/{LEAD}/followup-drafts", DRAFT_BODY, "a_sales")
    assert r.status_code == status and code(r) == name
    assert w.f.sent("create_draft") == []
    assert (
        w.call("GET", "/followups/due", None, "a_sales").status_code == status
    )  # the due list is fail-closed too
