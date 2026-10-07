"""T010 part 2, commit 2: the follow-up REQUEST BUILDER (app/followups/builder.py). It must produce, key for key and value for value, what the database's `app.followup_build` produces; the
equality itself is proved on the real stack (tests/integration/test_followup_equivalence.py). Here: the contract by value, so a change to the builder cannot pass by moving a pin."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest

from app.followups.builder import (
    FollowupRequestError,
    LeadSnapshot,
    PolicySnapshot,
    Touch,
    build_request,
    parse_instant,
    utc_text,
)

AS_OF = datetime(2026, 10, 7, 6, 30, 0, 999999, tzinfo=UTC)
IST = timezone(timedelta(hours=5, minutes=30))
T1 = "11111111-1111-4111-8111-111111111111"
T2 = "22222222-2222-4222-8222-222222222222"
T3 = "33333333-3333-4333-8333-333333333333"
POLICY = PolicySnapshot(
    id=str(uuid.uuid4()),
    gap_days=(1, 2),
    max_touches=3,
    quiet_start="21:00",
    quiet_end="09:00",
    allowed_weekdays=(0, 1, 2, 3, 4),
    holidays=("2026-10-20", "2026-12-25"),
    min_gap_hours=12,
    recipient_utc_offset_minutes=330,
)


def snap(**over: object) -> LeadSnapshot:
    base: dict[str, object] = {
        "lead_id": str(uuid.uuid4()),
        "status": "new",
        "contact_suppression_reason": None,
        "has_won_opportunity": False,
        "touches": (),
        "policy": POLICY,
    }
    base.update(over)
    return LeadSnapshot(**base)  # type: ignore[arg-type]


def touch(tid: str, direction: str, moment: datetime, channel: str = "email") -> Touch:
    return Touch(id=tid, direction=direction, channel=channel, occurred_at=moment)


def test_the_request_by_value() -> None:
    request = build_request(
        snap(
            touches=(
                touch(T1, "out", datetime(2026, 10, 2, 6, 30, 0, 123456, tzinfo=UTC)),
                touch(T2, "in", datetime(2026, 10, 3, 12, 0, 59, tzinfo=IST), "whatsapp"),
            )
        ),
        as_of=AS_OF,
    )
    assert request == {
        "as_of": "2026-10-07T06:30:00Z",
        "recipient_utc_offset_minutes": 330,
        "lead": {
            "do_not_contact": False,
            "opted_out": False,
            "replied": True,
            "bounced": False,
            "won": False,
            "lost": False,
        },
        "history": [
            {
                "timestamp": "2026-10-02T06:30:00Z",
                "channel": "email",
                "direction": "out",
                "outcome": "recorded_sent",
            },
            {
                "timestamp": "2026-10-03T06:30:59Z",
                "channel": "whatsapp",
                "direction": "in",
                "outcome": "recorded_reply",
            },
        ],
        "policy": {
            "gap_days": [1, 2],
            "max_touches": 3,
            "quiet_hours": {"start": "21:00", "end": "09:00"},
            "allowed_weekdays": [0, 1, 2, 3, 4],
            "holidays": ["2026-10-20", "2026-12-25"],
            "min_gap_hours": 12,
        },
    }


@pytest.mark.parametrize(
    ("reason", "flags"),
    [
        (None, {}),
        ("opted_out", {"opted_out": True}),
        ("bounced", {"bounced": True}),
        ("complained", {"do_not_contact": True}),
        ("legal", {"do_not_contact": True}),
        ("manual", {"do_not_contact": True}),
    ],
)
def test_the_contact_flags_come_from_the_suppression_reason(
    reason: str | None, flags: dict[str, bool]
) -> None:
    got = build_request(snap(contact_suppression_reason=reason), as_of=AS_OF)["lead"]
    assert (
        got
        == {
            "do_not_contact": False,
            "opted_out": False,
            "replied": False,
            "bounced": False,
            "won": False,
            "lost": False,
        }
        | flags
    )


def test_won_lost_and_replied_flags() -> None:
    assert build_request(snap(has_won_opportunity=True), as_of=AS_OF)["lead"]["won"] is True
    assert build_request(snap(status="disqualified"), as_of=AS_OF)["lead"]["lost"] is True
    for status in ("new", "in_review", "qualified"):
        assert build_request(snap(status=status), as_of=AS_OF)["lead"]["lost"] is False
    out_only = snap(touches=(touch(T1, "out", AS_OF),))
    assert build_request(out_only, as_of=AS_OF)["lead"]["replied"] is False
    assert (
        build_request(snap(touches=(touch(T1, "in", AS_OF),)), as_of=AS_OF)["lead"]["replied"]
        is True
    )


def test_the_history_is_ordered_by_the_second_then_the_touch_id() -> None:
    same_second_a = datetime(2026, 10, 2, 6, 30, 5, 900000, tzinfo=UTC)
    same_second_b = datetime(2026, 10, 2, 6, 30, 5, 100000, tzinfo=UTC)
    earlier = datetime(2026, 10, 1, 6, 0, 0, tzinfo=UTC)
    history = build_request(
        snap(
            touches=(
                touch(T3, "out", same_second_b, "whatsapp"),
                touch(T1, "out", same_second_a, "email"),
                touch(T2, "out", earlier, "phone"),
            )
        ),
        as_of=AS_OF,
    )["history"]
    # the order is (second, id): a touch 0.9 s later does not sort after one 0.1 s earlier in the same second
    assert [h["timestamp"] for h in history] == [
        "2026-10-01T06:00:00Z",
        "2026-10-02T06:30:05Z",
        "2026-10-02T06:30:05Z",
    ]
    # the two touches of that second differ only by their ids (T1 < T3) and their channels: by id T1 (email, 0.9 s) comes BEFORE T3 (whatsapp, 0.1 s); by the microsecond it would come after
    assert [h["channel"] for h in history] == ["phone", "email", "whatsapp"]
    again = build_request(
        snap(
            touches=(
                touch(T1, "out", same_second_a, "email"),
                touch(T3, "out", same_second_b, "whatsapp"),
                touch(T2, "out", earlier, "phone"),
            )
        ),
        as_of=AS_OF,
    )["history"]
    assert again == history


def test_ordering_ties_break_on_the_lower_case_uuid_text() -> None:
    moment = datetime(2026, 10, 2, 6, 30, 5, tzinfo=UTC)
    ids = [T3, T1, T2]
    history = build_request(
        snap(
            touches=tuple(
                touch(i, "out", moment, c)
                for i, c in zip(ids, ("whatsapp", "email", "phone"), strict=True)
            )
        ),
        as_of=AS_OF,
    )["history"]
    assert [h["channel"] for h in history] == ["email", "phone", "whatsapp"]  # T1, T2, T3


def test_times_are_utc_whole_seconds() -> None:
    assert utc_text(datetime(2026, 10, 7, 12, 0, 0, 500000, tzinfo=IST)) == "2026-10-07T06:30:00Z"
    assert parse_instant("2026-10-02T06:30:00.123456+00:00") == datetime(
        2026, 10, 2, 6, 30, 0, 123456, tzinfo=UTC
    )
    assert parse_instant("2026-10-02T12:00:00+05:30") == datetime(2026, 10, 2, 6, 30, tzinfo=UTC)
    with pytest.raises(FollowupRequestError, match="naive_time"):
        utc_text(datetime(2026, 10, 7, 6, 30))
    with pytest.raises(FollowupRequestError, match="naive_time"):
        parse_instant("2026-10-02T06:30:00")
    for bad in ("yesterday", 5, None):
        with pytest.raises(FollowupRequestError, match="bad_time"):
            parse_instant(bad)


def test_no_policy_in_force_is_a_fixed_error() -> None:
    with pytest.raises(FollowupRequestError) as caught:
        build_request(snap(policy=None), as_of=AS_OF)
    assert caught.value.code == "no_policy"


@pytest.mark.parametrize(
    "bad",
    [
        snap(touches=(touch("not-a-uuid", "out", AS_OF),)),
        snap(touches=(touch("ABCDEFAB-1111-4111-8111-111111111111", "out", AS_OF),)),
        snap(touches=(touch(T1, "sideways", AS_OF),)),
    ],
)
def test_a_malformed_touch_is_refused_without_echoing_it(bad: LeadSnapshot) -> None:
    with pytest.raises(FollowupRequestError) as caught:
        build_request(bad, as_of=AS_OF)
    assert caught.value.code == "bad_touch"


def test_numbers_must_be_integers() -> None:
    bad = PolicySnapshot(**{**POLICY.__dict__, "max_touches": 3.0})
    with pytest.raises(FollowupRequestError, match="not_integer"):
        build_request(snap(policy=bad), as_of=AS_OF)
    flagged = PolicySnapshot(**{**POLICY.__dict__, "recipient_utc_offset_minutes": True})
    with pytest.raises(FollowupRequestError, match="not_integer"):
        build_request(snap(policy=flagged), as_of=AS_OF)


def test_the_policy_arrays_are_kept_in_the_stored_order_and_the_snapshot_is_not_modified() -> None:
    policy = PolicySnapshot(
        **{
            **POLICY.__dict__,
            "allowed_weekdays": (1, 2, 3),
            "holidays": ("2026-12-25", "2026-12-26"),
        }
    )
    s = snap(
        policy=policy,
        touches=(touch(T2, "out", AS_OF), touch(T1, "out", AS_OF - timedelta(days=1))),
    )
    request = build_request(s, as_of=AS_OF)
    assert request["policy"]["allowed_weekdays"] == [1, 2, 3] and request["policy"]["holidays"] == [
        "2026-12-25",
        "2026-12-26",
    ]
    assert [t.id for t in s.touches] == [T2, T1]  # sorting a copy: the snapshot keeps its order
