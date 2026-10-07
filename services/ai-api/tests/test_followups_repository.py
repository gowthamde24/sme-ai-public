"""T010 part 2, commit 2: the PostgREST adapter for follow-ups (app/followups/repository.py) against a mock transport: what it sends (the caller's own token, the anon key, a tenant filter on
EVERY read, the definer functions for every write) and how it classifies what comes back (SQLSTATE only; a refusal's DETAIL is read only to pick a reason from a closed list; nothing from the
data layer ever reaches an exception)."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.followups import errors
from app.followups.repository import PostgrestFollowupsRepository
from app.tenancy.repository import Forbidden, MfaRequired, TokenRejected, UpstreamError

TENANT = uuid.UUID(int=0xA)
LEAD = uuid.UUID(int=0x1EAD)
ID = uuid.UUID(int=0x1)
CANARY = "CANARY-8e3a90 secret row data"


def repo(handler: Callable[[httpx.Request], httpx.Response]) -> PostgrestFollowupsRepository:
    return PostgrestFollowupsRepository(
        "http://rest.test",
        "anon-key",
        client=httpx.Client(transport=httpx.MockTransport(handler), base_url="http://rest.test"),
    )


def refusing(
    status: int, code: str, details: str = CANARY
) -> Callable[[httpx.Request], httpx.Response]:
    return lambda request: httpx.Response(
        status, json={"code": code, "message": CANARY, "details": details, "hint": CANARY}
    )


@pytest.mark.parametrize(
    ("code", "detail", "klass", "reason"),
    [
        ("SM220", "contact", errors.ContactBlockedError, "contact"),
        (
            "SM220",
            "erased_key",
            errors.ContactBlockedError,
            "key",
        ),  # hidden from a client: shown as key
        ("SM220", CANARY, errors.ContactBlockedError, "other"),
        ("SM221", CANARY, errors.NoSuppressionKeyError, None),
        ("SM222", None, errors.NoFollowupPolicyError, None),
        ("SM223", "exists", errors.DraftStateError, "exists"),
        ("SM224", CANARY, errors.FollowupStaleError, None),
        ("SM225", "not_yet", errors.NotDueError, "not_yet"),
        ("SM225", "invalid", errors.NotDueError, "invalid"),
        ("SM226", CANARY, errors.FollowupMismatchError, None),
        ("SM227", "order_accepted", errors.FollowupStoppedError, "order_accepted"),
        ("SM227", "bogus", errors.FollowupStoppedError, "other"),
        ("SM228", CANARY, errors.DraftNotYoursError, None),
        ("SM229", CANARY, errors.FollowupLimitError, None),
    ],
)
def test_the_family_is_classified_by_sqlstate_and_a_closed_detail_only(
    code: str, detail: str | None, klass: type, reason: str | None
) -> None:
    with pytest.raises(klass) as caught:
        repo(refusing(400, code, detail or "")).record_touch("tok", {})
    assert caught.value.reason == reason  # type: ignore[attr-defined]
    assert CANARY not in str(caught.value) and CANARY not in repr(caught.value)
    assert (caught.value.internal_reason == "erased_key") == (detail == "erased_key")  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("status", "code", "klass"),
    [
        (403, "SM306", MfaRequired),
        (403, "42501", Forbidden),
        (409, "23505", ConflictError),
        (409, "23503", InvalidReferenceError),
        (400, "23514", InvalidValueError),
        (400, "22023", InvalidValueError),
        (401, "PGRST301", TokenRejected),
    ],
)
def test_the_generic_failures_are_the_shared_classes(status: int, code: str, klass: type) -> None:
    with pytest.raises(klass) as caught:
        repo(refusing(status, code)).create_draft("tok", {})
    assert CANARY not in str(caught.value)


def test_an_unreachable_or_odd_data_layer_is_an_upstream_error_without_text() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(CANARY)

    with pytest.raises(UpstreamError) as caught:
        repo(boom).gate("tok", LEAD, "email")
    assert CANARY not in str(caught.value)
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, text="not json")).gate("tok", LEAD, "email")
    with pytest.raises(UpstreamError):
        repo(lambda r: httpx.Response(200, json=[1, 2])).gate("tok", LEAD, "email")


def _capture() -> tuple[list[httpx.Request], Callable[[httpx.Request], httpx.Response]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True} if request.method == "POST" else [])

    return seen, handler


def test_every_write_is_a_definer_function_with_the_callers_token_and_the_anon_key() -> None:
    seen, handler = _capture()
    r = repo(handler)
    r.create_policy("tok", {"p_version_id": "x"})
    r.record_touch("tok", {"p_touch_id": "x"})
    r.create_draft("tok", {"p_draft_id": "x"})
    r.approve_draft("tok", ID, "a" * 64)
    r.discard_draft("tok", ID)
    r.record_sent("tok", ID, LEAD, None)
    r.persist_questions("tok", ID, [{"id": "x"}])
    r.decide_question("tok", ID, "approve")
    r.gate("tok", LEAD, "email")
    assert [(q.method, q.url.path) for q in seen] == [
        ("POST", f"/rpc/{f}")
        for f in (
            "create_followup_policy_version",
            "record_touch",
            "create_followup_draft",
            "approve_followup_draft",
            "discard_followup_draft",
            "record_draft_sent",
            "persist_question_drafts",
            "decide_question_draft",
            "followup_gate",
        )
    ]
    for request in seen:
        assert (
            request.headers["authorization"] == "Bearer tok"
            and request.headers["apikey"] == "anon-key"
        )
    assert json.loads(seen[3].content) == {"p_draft_id": str(ID), "p_state_hash": "a" * 64}
    assert json.loads(seen[5].content) == {
        "p_draft_id": str(ID),
        "p_touch_id": str(LEAD),
        "p_occurred_at": None,
    }


def test_every_read_carries_the_tenant_filter() -> None:
    seen, handler = _capture()
    r = repo(handler)
    r.list_policies("tok", TENANT, limit=5)
    r.list_touches("tok", TENANT, LEAD, limit=5)
    r.get_draft("tok", TENANT, ID)
    r.list_drafts("tok", TENANT, lead_id=LEAD, status="active", limit=5)
    r.recent_outbound("tok", TENANT, limit=5)
    r.requirement_enquiry("tok", TENANT, ID)
    r.list_question_drafts("tok", TENANT, ID, active_only=True)
    r.get_question_draft("tok", TENANT, ID)
    assert len(seen) == 8
    for request in seen:
        assert request.method == "GET" and request.url.params["tenant_id"] == f"eq.{TENANT}", (
            request.url
        )
    drafts = seen[3].url.params
    assert drafts["status"] == "in.(draft,approved)" and drafts["lead_id"] == f"eq.{LEAD}"


def test_a_lead_snapshot_reads_the_lead_contact_opportunities_touches_and_the_policy_in_force() -> (
    None
):
    answers: dict[str, Any] = {
        "/leads": [{"id": str(LEAD), "status": "disqualified", "contact_id": str(ID)}],
        "/contacts": [{"suppression_reason": "opted_out"}],
        "/opportunities": [{"id": str(ID)}],
        "/lead_touches": [
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "direction": "in",
                "channel": "whatsapp",
                "occurred_at": "2026-10-03T07:00:00.5+00:00",
            },
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "direction": "out",
                "channel": "email",
                "occurred_at": "2026-10-02T06:30:00+00:00",
            },
        ],
        "/followup_policy_versions": [
            {
                "id": str(ID),
                "gap_days": [1, 2],
                "max_touches": 3,
                "quiet_start": "21:00",
                "quiet_end": "09:00",
                "allowed_weekdays": [0, 1],
                "holidays": ["2026-12-25"],
                "min_gap_hours": 4,
                "recipient_utc_offset_minutes": 330,
            }
        ],
    }
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=answers[request.url.path])

    snap = repo(handler).lead_snapshot("tok", TENANT, LEAD)
    assert snap is not None
    assert (snap.status, snap.contact_suppression_reason, snap.has_won_opportunity) == (
        "disqualified",
        "opted_out",
        True,
    )
    assert [t.direction for t in snap.touches] == ["in", "out"] and snap.touches[
        0
    ].occurred_at == datetime(2026, 10, 3, 7, 0, 0, 500000, tzinfo=UTC)
    assert (
        snap.policy is not None
        and snap.policy.holidays == ("2026-12-25",)
        and snap.policy.allowed_weekdays == (0, 1)
    )
    for request in seen:
        assert request.url.params["tenant_id"] == f"eq.{TENANT}"
    policy_query = next(r for r in seen if r.url.path == "/followup_policy_versions").url.params
    assert (
        policy_query["effective_from"].startswith("lte.")
        and policy_query["order"] == "effective_from.desc,version_no.desc"
        and policy_query["limit"] == "1"
    )
    won = next(r for r in seen if r.url.path == "/opportunities").url.params
    assert (won["status"], won["archived_at"]) == ("eq.won", "is.null")


def test_a_lead_the_caller_cannot_see_is_none_and_a_lead_without_a_contact_has_no_flags() -> None:
    assert repo(lambda r: httpx.Response(200, json=[])).lead_snapshot("tok", TENANT, LEAD) is None

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/leads":
            return httpx.Response(
                200, json=[{"id": str(LEAD), "status": "new", "contact_id": None}]
            )
        assert request.url.path != "/contacts", "no contact: nothing to read"
        return httpx.Response(200, json=[])

    snap = repo(handler).lead_snapshot("tok", TENANT, LEAD)
    assert (
        snap is not None
        and snap.contact_suppression_reason is None
        and snap.policy is None
        and snap.touches == ()
    )


def test_the_recent_outbound_leads_are_distinct_newest_first_and_capped() -> None:
    a, b = uuid.UUID(int=0xA1), uuid.UUID(int=0xB1)
    rows = [
        {"lead_id": str(a), "channel": "email"},
        {"lead_id": str(a), "channel": "whatsapp"},
        {"lead_id": str(b), "channel": "whatsapp"},
        {"lead_id": str(a), "channel": "email"},
    ]
    got = repo(lambda r: httpx.Response(200, json=rows)).recent_outbound("tok", TENANT, limit=5)
    assert [x.lead_id for x in got] == [a, b]
    got = repo(lambda r: httpx.Response(200, json=rows)).recent_outbound("tok", TENANT, limit=1)
    assert [x.lead_id for x in got] == [a]


def test_a_candidates_channel_is_that_of_its_latest_email_or_whatsapp_touch_and_a_call_has_none() -> (
    None
):
    a, b, c = uuid.UUID(int=0xA1), uuid.UUID(int=0xB1), uuid.UUID(int=0xC1)
    rows = [  # newest first
        {
            "lead_id": str(a),
            "channel": "phone",
        },  # a call is newer than a's WhatsApp touch but is not a draft channel
        {"lead_id": str(b), "channel": "phone"},
        {"lead_id": str(a), "channel": "whatsapp"},
        {"lead_id": str(c), "channel": "email"},
        {"lead_id": str(a), "channel": "email"},
    ]
    got = repo(lambda r: httpx.Response(200, json=rows)).recent_outbound("tok", TENANT, limit=3)
    assert [(x.lead_id, x.channel) for x in got] == [(a, "whatsapp"), (b, None), (c, "email")]
    capped = repo(lambda r: httpx.Response(200, json=rows)).recent_outbound("tok", TENANT, limit=2)
    assert [x.lead_id for x in capped] == [a, b]  # c is past the cap and is not counted


def test_a_counted_lead_still_learns_its_channel_from_a_row_after_the_cap_was_reached() -> None:
    a, b, c = uuid.UUID(int=0xA1), uuid.UUID(int=0xB1), uuid.UUID(int=0xC1)
    rows = [  # newest first: c is the first lead past the cap of 2, and a's latest e-mail or WhatsApp touch comes after it
        {"lead_id": str(a), "channel": "phone"},
        {"lead_id": str(b), "channel": "phone"},
        {"lead_id": str(c), "channel": "email"},
        {"lead_id": str(a), "channel": "whatsapp"},
    ]
    got = repo(lambda r: httpx.Response(200, json=rows)).recent_outbound("tok", TENANT, limit=2)
    assert [(x.lead_id, x.channel) for x in got] == [(a, "whatsapp"), (b, None)]


def test_the_candidate_read_asks_for_outbound_touches_with_their_channel_and_four_times_the_cap() -> (
    None
):
    seen, handler = _capture()
    repo(handler).recent_outbound("tok", TENANT, limit=7)
    params = seen[0].url.params
    assert params["select"] == "lead_id,channel" and params["direction"] == "eq.out"
    assert params["limit"] == "28" and params["order"] == "occurred_at.desc,id.desc"


def test_the_server_still_distinguishes_an_erased_key_in_the_log_and_the_typed_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    caplog.set_level(logging.INFO, logger="app.followups.repository")
    with pytest.raises(errors.ContactBlockedError) as caught:
        repo(refusing(400, "SM220", "erased_key")).create_draft("tok", {})
    assert caught.value.reason == "key" and caught.value.internal_reason == "erased_key"
    lines = [r.getMessage() for r in caplog.records if r.name == "app.followups.repository"]
    assert any("sqlstate=SM220" in line and "reason=erased_key" in line for line in lines), lines
    assert all(CANARY not in line for line in lines)
