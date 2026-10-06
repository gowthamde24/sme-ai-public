"""T010 part 2, commit 2: THE GATE (docs/adr/0022, decision 3). The database re-implements the cadence engine's DRAFT condition (`app.followup_blocker`) and builds the engine's request itself
(`app.followup_build`). Two implementations of one rule set can disagree; this file is what keeps them equal, and ANY disagreement fails the build.

  TIER 1  the rules, against the REAL engine (packages/pure/followup_cadence, through the adapter): an exhaustive boundary grid of requests, every rule at n-1, n and n+1 minutes (the gap in
          days, the minimum gap in hours, the quiet-hour edges of wrapping and non-wrapping windows, the weekday and holiday edges at the recipient's local midnight under positive, negative and
          fractional offsets, the touch cap, the future-history edge), every combination of the six stop flags with every history shape. For each request: the engine's answer (draft_followup /
          wait / stop / a rejection) is mapped to the database's closed reason and compared with `app.followup_blocker`. They must agree on due-ness AND on the reason.
  TIER 2  the BUILDER, against the real database: for a spread of real leads and states (every suppression reason, a reply, a lost lead, a won, an archived won and a lost opportunity, a lead
          without a contact, same-second ties, microsecond order, three channels, every touch count) and several policies, the request built in Python from rows READ THROUGH PostgREST with the
          caller's token (the API's own reading code) must equal, key for key, `app.followup_build`; and the real engine on that request must agree with `app.followup_blocker` on the database's.

KNOWN DIVERGENCE (found by this gate, reported to the owner, NOT fixed here: a fix is a new migration): the engine VALIDATES before it applies any rule, so a history entry after as_of is a REJECTION
(FUTURE_HISTORY) even when a suppression flag, a reply or a close would also stop the lead; `app.followup_blocker` checks the flags, a reply and a close BEFORE the future-history rule and names those
reasons instead. Both say "not due" (the due-ness always agrees); only the NAME of the reason differs, and only for a lead with a history entry after as_of AND one of those stops. It is
pinned below as a strict expected failure, so the day it is fixed that test fails and must be removed."""

# ruff: noqa: E501, S608, S311

from __future__ import annotations

import itertools
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead, policy_body
from order_support import psql

from app.followups import cadence_port
from app.followups.builder import LeadSnapshot, build_request, utc_text
from app.followups.repository import PostgrestFollowupsRepository

BASE = datetime(2026, 10, 7, 0, 0, 0, tzinfo=UTC)  # a Wednesday
ENGINE_STOPS = {
    "do_not_contact": "suppressed",
    "opted_out": "suppressed",
    "bounced": "suppressed",
    "human_takeover": "replied",
    "won": "closed",
    "lost": "closed",
    "max_touches_reached": "max_touches",
    "initial_outreach_required": "initial_outreach",
}


def engine_reason(result: dict[str, Any]) -> str | None:
    """The database's closed reason for what the real engine answered (None: a draft is due)."""
    if cadence_port.is_rejected(result):
        code = result["codes"][0]
        assert code == "FUTURE_HISTORY", f"an unexpected rejection of a valid request: {code}"
        return "future_history"
    if result["action"] == "draft_followup":
        assert result["reason_code"] == "eligible_now" and result["next_eligible_at"] is not None
        return None
    if result["action"] == "wait":
        return "not_yet"
    return ENGINE_STOPS[result["reason_code"]]


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def touch(moment: datetime, direction: str = "out", channel: str = "email") -> dict[str, str]:
    return {
        "timestamp": iso(moment),
        "channel": channel,
        "direction": direction,
        "outcome": "recorded_sent" if direction == "out" else "recorded_reply",
    }


def policy(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "gap_days": [1, 2],
        "max_touches": 3,
        "quiet_hours": {"start": "21:00", "end": "09:00"},
        "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "holidays": [],
        "min_gap_hours": 0,
    }
    base.update(over)
    if "max_touches" in over and "gap_days" not in over:
        base["gap_days"] = [1] * max(over["max_touches"] - 1, 0)
    return base


FLAGS = ("do_not_contact", "opted_out", "replied", "bounced", "won", "lost")


def request(
    as_of: datetime,
    history: list[dict[str, str]],
    pol: dict[str, Any],
    offset: int = 330,
    **flags: bool,
) -> dict[str, Any]:
    return {
        "as_of": iso(as_of),
        "recipient_utc_offset_minutes": offset,
        "lead": {f: bool(flags.get(f, False)) for f in FLAGS},
        "history": history,
        "policy": pol,
    }


def local(offset: int, day: int, hour: int, minute: int, second: int = 0) -> datetime:
    """The UTC instant at which a recipient with this fixed offset reads (BASE + day days) hour:minute:second."""
    return (
        BASE
        + timedelta(days=day, hours=hour, minutes=minute, seconds=second)
        - timedelta(minutes=offset)
    )


OFFSETS = (330, 0, -300, 840, -840, 345, -210, 60)
WINDOWS = (
    ("21:00", "09:00"),
    ("12:00", "13:00"),
    ("00:00", "00:01"),
    ("23:59", "00:00"),
    ("08:30", "09:30"),
    ("22:15", "06:45"),
)


def grid() -> list[tuple[str, dict[str, Any]]]:
    cases: list[tuple[str, dict[str, Any]]] = []
    ref = datetime(
        2026, 9, 25, 6, 0, tzinfo=UTC
    )  # an outbound touch long enough ago for every gap below

    # 1. quiet-hour edges: the edge minute at n-1, n, n+1 (and with seconds), for every window and every offset, on a Wednesday
    for off, (qs, qe) in itertools.product(OFFSETS, WINDOWS):
        for edge in (qs, qe):
            h, m = int(edge[:2]), int(edge[3:])
            for delta, sec in itertools.product((-1, 0, 1), (0, 59)):
                at = local(off, 0, h, m + delta, sec)
                cases.append(
                    (
                        f"quiet off={off} {qs}-{qe} edge={edge} d={delta} s={sec}",
                        request(
                            at, [touch(ref)], policy(quiet_hours={"start": qs, "end": qe}), off
                        ),
                    )
                )

    # 2. the weekday and holiday edges at the recipient's local midnight, around a Saturday (5) and a Sunday (6), every offset
    for off in OFFSETS:
        for allowed in (
            [0, 1, 2, 3, 4],
            [5, 6],
            [0],
            [6],
            [1, 2, 3, 4, 5, 6],
            [0, 1, 2, 3, 4, 5, 6],
        ):
            for day, delta in itertools.product(
                (2, 3, 4, 5), (-1, 0, 1)
            ):  # local days Fri..Mon (BASE is Wednesday: +2 = Friday)
                at = local(off, day, 0, delta)
                cases.append(
                    (
                        f"weekday off={off} allowed={allowed} day+{day} d={delta}",
                        request(
                            at,
                            [touch(ref)],
                            policy(
                                allowed_weekdays=allowed,
                                quiet_hours={"start": "03:00", "end": "03:01"},
                            ),
                            off,
                        ),
                    )
                )
        for hol_day, delta in itertools.product((2, 3), (-1, 0, 1)):
            hol = (BASE + timedelta(days=hol_day)).date().isoformat()
            at = local(off, hol_day, 0, delta)
            cases.append(
                (
                    f"holiday off={off} {hol} d={delta}",
                    request(
                        at,
                        [touch(ref)],
                        policy(holidays=[hol], quiet_hours={"start": "03:00", "end": "03:01"}),
                        off,
                    ),
                )
            )
            at2 = local(off, hol_day + 1, 0, delta)
            cases.append(
                (
                    f"holiday-next off={off} {hol} d={delta}",
                    request(
                        at2,
                        [touch(ref)],
                        policy(holidays=[hol], quiet_hours={"start": "03:00", "end": "03:01"}),
                        off,
                    ),
                )
            )

    # 3. the gap in days and the minimum gap in hours, every boundary at n-1, n, n+1 minutes, for touch 2 and touch 3
    last = datetime(2026, 10, 1, 6, 30, tzinfo=UTC)
    for gap in (0, 1, 2, 7):
        for hours in (0, 1, 24, 48):
            for delta in (-1, 0, 1):
                floor = max(timedelta(days=gap), timedelta(hours=hours))
                at = last + floor + timedelta(minutes=delta)
                cases.append(
                    (
                        f"gap2 gap={gap} min={hours} d={delta}",
                        request(
                            at,
                            [touch(last)],
                            policy(
                                gap_days=[gap, 99],
                                min_gap_hours=hours,
                                quiet_hours={"start": "03:00", "end": "03:01"},
                            ),
                        ),
                    )
                )
                cases.append(
                    (
                        f"gap3 gap={gap} min={hours} d={delta}",
                        request(
                            at + timedelta(days=3),
                            [touch(last - timedelta(days=3)), touch(last)],
                            policy(
                                gap_days=[99, gap],
                                min_gap_hours=hours,
                                quiet_hours={"start": "03:00", "end": "03:01"},
                            ),
                        ),
                    )
                )
                # the gap is measured from the LAST outbound touch, in any list order
                cases.append(
                    (
                        f"gap-order gap={gap} d={delta}",
                        request(
                            at,
                            [touch(last), touch(last - timedelta(days=5))],
                            policy(
                                gap_days=[0, gap],
                                min_gap_hours=hours,
                                quiet_hours={"start": "03:00", "end": "03:01"},
                            ),
                        ),
                    )
                )
        for delta in (-1, 0, 1):  # the two floors together: the later one rules
            at = last + timedelta(days=gap, hours=5) + timedelta(minutes=delta)
            cases.append(
                (
                    f"floors gap={gap} min=29 d={delta}",
                    request(
                        at,
                        [touch(last)],
                        policy(
                            gap_days=[gap, 1],
                            min_gap_hours=gap * 24 + 5,
                            quiet_hours={"start": "03:00", "end": "03:01"},
                        ),
                    ),
                )
            )

    # 4. the touch cap and the initial-outreach rule: 0..max+1 outbound touches under a limit of 1..4
    for max_touches in (1, 2, 3, 4):
        for outs in range(0, max_touches + 2):
            history = [touch(ref + timedelta(days=i)) for i in range(outs)]
            cases.append(
                (
                    f"cap max={max_touches} outs={outs}",
                    request(
                        datetime(2026, 10, 7, 6, 30, tzinfo=UTC),
                        history,
                        policy(
                            max_touches=max_touches, quiet_hours={"start": "03:00", "end": "03:01"}
                        ),
                    ),
                )
            )

    # 5. every combination of the six stop flags with every history shape (no touch, one out, an out and a reply, a reply only, a future touch, a future reply)
    now = datetime(2026, 10, 7, 6, 30, tzinfo=UTC)
    shapes = {
        "none": [],
        "out": [touch(now - timedelta(days=5))],
        "out+in": [touch(now - timedelta(days=5)), touch(now - timedelta(days=4), "in")],
        "in": [touch(now - timedelta(days=4), "in")],
        "capped": [touch(now - timedelta(days=i)) for i in (5, 4, 3)],
        "future-out": [touch(now - timedelta(days=5)), touch(now + timedelta(minutes=1))],
        "future-in": [touch(now - timedelta(days=5)), touch(now + timedelta(minutes=1), "in")],
        "at-as_of": [touch(now - timedelta(days=5)), touch(now)],
    }
    for bits in itertools.product((False, True), repeat=len(FLAGS)):
        flags = dict(zip(FLAGS, bits, strict=True))
        for name, history in shapes.items():
            cases.append(
                (
                    f"flags={''.join('1' if b else '0' for b in bits)} history={name}",
                    request(
                        now,
                        history,
                        policy(quiet_hours={"start": "03:00", "end": "03:01"}),
                        330,
                        **flags,
                    ),
                )
            )

    # 6. the future-history edge itself: a touch at as_of - 1 s, at as_of, at as_of + 1 s
    for delta in (-1, 0, 1):
        cases.append(
            (
                f"future-edge d={delta}",
                request(
                    now,
                    [touch(now - timedelta(days=5)), touch(now + timedelta(seconds=delta))],
                    policy(max_touches=4, quiet_hours={"start": "03:00", "end": "03:01"}),
                ),
            )
        )

    # 7. as_of with seconds: a due minute stays due for the whole minute, a quiet one stays quiet
    for sec in (0, 1, 30, 59):
        cases.append(
            (f"seconds due s={sec}", request(local(330, 0, 12, 0, sec), [touch(ref)], policy()))
        )
        cases.append(
            (f"seconds quiet s={sec}", request(local(330, 0, 21, 0, sec), [touch(ref)], policy()))
        )
        cases.append(
            (
                f"seconds before quiet s={sec}",
                request(local(330, 0, 20, 59, sec), [touch(ref)], policy()),
            )
        )
    return cases


def database_reasons(cases: list[tuple[str, dict[str, Any]]]) -> list[str]:
    """`app.followup_blocker` for every request, in batches through ONE psql session each (no round trip per case)."""
    out: list[str] = []
    for start in range(0, len(cases), 400):
        script = "\n".join(
            f"select coalesce(app.followup_blocker($j${json.dumps(req, separators=(',', ':'))}$j$::jsonb), '-');"
            for _, req in cases[start : start + 400]
        )
        lines = psql(script).split("\n")
        assert len(lines) == len(cases[start : start + 400]), (len(lines), start)
        out += lines
    return out


@pytest.fixture(scope="module")
def evaluated() -> list[tuple[str, dict[str, Any], str | None, str]]:
    cases = grid()
    engine = [engine_reason(cadence_port.run_decide(req)) for _, req in cases]
    database = database_reasons(cases)
    return [(label, req, e, d) for (label, req), e, d in zip(cases, engine, database, strict=True)]


def has_future(req: dict[str, Any]) -> bool:
    return any(h["timestamp"] > req["as_of"] for h in req["history"])


def stops(req: dict[str, Any]) -> bool:
    lead = req["lead"]
    return any(lead[f] for f in FLAGS) or any(h["direction"] == "in" for h in req["history"])


# ============================================================================ TIER 1
def test_the_grid_is_large_and_every_reason_the_database_can_name_is_met(
    evaluated: list[tuple[str, dict[str, Any], str | None, str]],
) -> None:
    assert len(evaluated) >= 1900, len(evaluated)
    met = {e for _, _, e, _ in evaluated}
    assert met == {
        None,
        "suppressed",
        "replied",
        "closed",
        "max_touches",
        "initial_outreach",
        "future_history",
        "not_yet",
    }, met
    due = sum(1 for _, _, e, _ in evaluated if e is None)
    assert 200 < due < len(evaluated) - 200, (
        "the grid must straddle every boundary: plenty of due and plenty of not-due cases"
    )


def test_the_engine_and_the_database_agree_on_due_ness_in_every_case(
    evaluated: list[tuple[str, dict[str, Any], str | None, str]],
) -> None:
    disagreements = [(label, e, d) for label, _, e, d in evaluated if (e is None) != (d == "-")]
    assert disagreements == [], (
        f"{len(disagreements)} case(s) where one says DUE and the other not; first: {disagreements[:5]}"
    )


def test_the_engine_and_the_database_name_the_same_reason_in_every_case_without_a_future_touch_and_a_stop(
    evaluated: list[tuple[str, dict[str, Any], str | None, str]],
) -> None:
    cases = [
        (label, e, d) for label, req, e, d in evaluated if not (has_future(req) and stops(req))
    ]
    assert len(cases) >= 1800
    differing = [(label, e, "-" if d == "-" else d) for label, e, d in cases if (e or "-") != d]
    assert differing == [], (
        f"{len(differing)} case(s) where the engine and the database name different reasons; first: {differing[:5]}"
    )


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN DIVERGENCE (ADR 0022): the engine rejects a future touch BEFORE any stop rule; app.followup_blocker names the stop first. Due-ness agrees; only the reason's NAME differs. Fix = a new migration (owner decision).",
)
def test_the_reason_for_a_lead_that_has_a_future_touch_and_a_stop(
    evaluated: list[tuple[str, dict[str, Any], str | None, str]],
) -> None:
    cases = [(label, e, d) for label, req, e, d in evaluated if has_future(req) and stops(req)]
    assert cases, "the grid must contain the combination"
    assert [(label, e, d) for label, e, d in cases if (e or "-") != d] == []


def test_the_divergence_is_only_about_names_never_about_due_ness(
    evaluated: list[tuple[str, dict[str, Any], str | None, str]],
) -> None:
    for label, req, e, d in evaluated:
        if has_future(req) and stops(req):
            assert e == "future_history" and d in ("suppressed", "replied", "closed"), (
                label,
                e,
                d,
            )  # both say "not due"


def test_the_database_fails_closed_on_requests_the_engine_rejects_for_other_reasons() -> None:
    """A request the engine REJECTS (not a stop, not a wait) is never due in the database either: invalid / unreadable input is `invalid`, never null."""
    bad = [
        request(
            datetime(2026, 10, 7, 6, 30, tzinfo=UTC),
            [touch(datetime(2026, 10, 1, tzinfo=UTC))],
            policy(gap_days=[]),
        ),  # too few gaps for touch 2
        {**request(datetime(2026, 10, 7, 6, 30, tzinfo=UTC), [], policy()), "as_of": "not a time"},
        {
            k: v
            for k, v in request(datetime(2026, 10, 7, 6, 30, tzinfo=UTC), [], policy()).items()
            if k != "lead"
        },
    ]
    for req in bad:
        assert cadence_port.is_rejected(
            cadence_port.run_decide(req)
        )  # the engine rejects each of them too
    reasons = database_reasons([("x", r) for r in bad])
    assert reasons == ["invalid", "invalid", "invalid"], reasons


# ============================================================================ TIER 2
@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    return FollowWorld(client, eval_world, eval_world.a)


T0 = datetime(2026, 10, 2, 6, 30, 0, tzinfo=UTC)


def scenarios(fw: FollowWorld) -> list[Lead]:
    """A spread of real leads. Touches are planted at exact times (the operator's insert: the functions bound the time), flags through the real routes."""
    leads: list[Lead] = []

    def make(label: str, **kw: Any) -> Lead:
        lead = fw.lead(label, age_days=90, **kw)
        leads.append(lead)
        return lead

    def plant(
        lead: Lead,
        when: str,
        direction: str = "out",
        channel: str = "email",
        tid: str | None = None,
    ) -> None:
        fw.plant_touch(
            lead,
            direction,
            f"timestamptz '{when}'",
            recorded_sql="now()",
            touch_id=tid,
            channel=channel,
        )

    make("none")
    plant(make("one"), "2026-10-02 06:30:00+00")
    plant(make("fractional"), "2026-10-02 06:30:00.999999+00")
    two = make("out-in")
    plant(two, "2026-10-02 06:30:00+00")
    plant(two, "2026-10-03 06:30:00+00", "in", "whatsapp")
    plant(make("in-only"), "2026-10-03 06:30:00+00", "in")
    three = make("three")
    for day in (28, 30, 2):
        plant(three, f"2026-{'09' if day > 20 else '10'}-{day:02d} 06:30:00+00")
    four = make("four")
    for i in range(4):
        plant(four, f"2026-09-{20 + i} 06:30:00+00")
    ties = make(
        "ties"
    )  # same second, different microseconds and ids: the order is (second, id); fresh ids every run, in a known order a < b < c
    a_id, b_id, c_id = sorted(str(uuid.uuid4()) for _ in range(3))
    for tid, when, ch in (
        (c_id, "2026-10-02 06:30:05.100000+00", "phone"),
        (a_id, "2026-10-02 06:30:05.900000+00", "email"),
        (b_id, "2026-10-02 06:30:05.500000+00", "whatsapp"),
    ):
        plant(ties, when, "out", ch, tid)
    plant(ties, "2026-10-01 06:30:00+00")
    mixed = make("channels")
    for i, ch in enumerate(("email", "whatsapp", "phone")):
        plant(mixed, f"2026-09-2{i} 06:30:00+00", "out", ch)
    for reason in ("opted_out", "bounced", "complained", "legal", "manual"):
        s = make(f"sup-{reason}")
        plant(s, "2026-10-02 06:30:00+00")
        assert fw.suppress(s, reason).status_code == 200
    lost = make("lost")
    plant(lost, "2026-10-02 06:30:00+00")
    assert (
        fw.w.call(
            fw.owner,
            "PATCH",
            fw.t,
            "leads",
            f"/{lost.id}",
            json={"status": "disqualified", "disqualified_reason": "no fit"},
        ).status_code
        == 200
    )
    for status in ("won", "lost"):
        opp = make(f"opp-{status}")
        plant(opp, "2026-10-02 06:30:00+00")
        reason = ", lost_reason" if status == "lost" else ""
        fw.sql(
            f"insert into public.opportunities (tenant_id, company_id, contact_id, lead_id, title, status{reason}) select tenant_id, company_id, contact_id, id, 'Synthetic deal', '{status}'{', $r$no$r$' if status == 'lost' else ''} from public.leads where id = '{opp.id}'"
        )
    archived_won = make("opp-archived-won")
    plant(archived_won, "2026-10-02 06:30:00+00")
    fw.sql(
        f"insert into public.opportunities (tenant_id, company_id, contact_id, lead_id, title, status, archived_at) select tenant_id, company_id, contact_id, id, 'Synthetic deal', 'won', now() from public.leads where id = '{archived_won.id}'"
    )
    nocontact_id = uid()
    assert (
        fw.w.call(
            fw.owner,
            "POST",
            fw.t,
            "leads",
            json={"id": nocontact_id, "company_id": fw.t.rows["companies"]["id"]},
        ).status_code
        == 201
    )
    fw.sql(
        f"update public.leads set created_at = now() - interval '90 days' where id = '{nocontact_id}'"
    )
    leads.append(Lead("no-contact", nocontact_id, "", None, None))
    future = make("future")
    plant(future, "2026-10-02 06:30:00+00")
    fw.sql(
        f"insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at) select gen_random_uuid(), tenant_id, id, contact_id, 'out', 'email', timestamptz '2027-01-01 00:00:00+00', timestamptz '2027-01-01 00:00:00+00' from public.leads where id = '{future.id}'"
    )
    return leads


POLICIES: list[dict[str, Any]] = [
    {},
    {
        "gap_days": [0, 0],
        "recipient_utc_offset_minutes": -300,
        "quiet_start": "12:00",
        "quiet_end": "13:00",
    },
    {
        "allowed_weekdays": [0, 1, 2, 3, 4],
        "holidays": ["2026-10-07", "2026-10-09"],
        "recipient_utc_offset_minutes": 840,
    },
    {
        "gap_days": [3, 5],
        "min_gap_hours": 100,
        "quiet_start": "23:59",
        "quiet_end": "00:00",
        "recipient_utc_offset_minutes": -840,
    },
    {
        "max_touches": 4,
        "gap_days": [1, 1, 1],
        "quiet_start": "22:15",
        "quiet_end": "06:45",
        "recipient_utc_offset_minutes": 345,
    },
    {"max_touches": 2, "gap_days": [1], "allowed_weekdays": [2], "recipient_utc_offset_minutes": 0},
]
AS_OFS = [
    datetime(2026, 10, 7, 6, 30, 0, tzinfo=UTC),
    datetime(2026, 10, 5, 12, 15, 30, 400000, tzinfo=UTC),
    datetime(2026, 10, 3, 6, 30, 0, tzinfo=UTC),
    datetime(2026, 10, 8, 18, 29, 59, tzinfo=UTC),
    datetime(2026, 10, 6, 18, 30, 0, tzinfo=UTC),
    datetime(2026, 10, 9, 6, 29, 0, tzinfo=UTC),
]


def python_snapshot(fw: FollowWorld, lead: Lead) -> LeadSnapshot:
    repo = PostgrestFollowupsRepository(fw.w.stack.rest, fw.w.stack.anon_key)
    try:
        snap = repo.lead_snapshot(fw.owner.token, uuid.UUID(fw.t.id), uuid.UUID(lead.id))
    finally:
        repo.close()
    assert snap is not None
    return snap


def test_the_python_request_equals_the_databases_for_every_lead_policy_and_time(
    fw: FollowWorld,
) -> None:
    leads = scenarios(fw)
    compared = 0
    for number, over in enumerate(POLICIES, start=1):
        body = policy_body(**{k if not k.startswith("quiet") else k: v for k, v in over.items()})
        body["effective_from"] = fw.sql("select app.quote_today()")
        r = fw.call("POST", "/followup-policy-versions", fw.owner, body)
        assert r.status_code in (200, 201), r.text
        active = fw.sql(
            f"select app.followup_active_policy_version('{fw.t.id}', app.quote_today())"
        )
        assert active == body["id"], f"policy {number} is not the one in force"
        script = "\n".join(
            f"select concat_ws(chr(9), app.followup_build('{lead.id}', '{utc_text(as_of)}', '{active}')::text, coalesce(app.followup_blocker(app.followup_build('{lead.id}', '{utc_text(as_of)}', '{active}')), '-'));"
            for lead in leads
            for as_of in AS_OFS
        )
        lines = psql(script).split("\n")
        assert len(lines) == len(leads) * len(AS_OFS)
        for (lead, as_of), line in zip(itertools.product(leads, AS_OFS), lines, strict=True):
            db_text, db_reason = line.split("\t")
            snap = python_snapshot(fw, lead) if as_of == AS_OFS[0] else cache[lead.id]
            cache[lead.id] = snap
            assert snap.policy is not None and snap.policy.id == active
            ours = build_request(snap, as_of=as_of)
            theirs = json.loads(db_text)
            assert ours == theirs, (
                f"policy {number} lead {lead.label} as_of {utc_text(as_of)}: the Python request differs from app.followup_build\n python: {ours}\n  db:     {theirs}"
            )
            assert cadence_port.canonical_json(ours) == cadence_port.canonical_json(theirs)
            expected = engine_reason(cadence_port.run_decide(ours))
            future_and_stop = has_future(ours) and stops(ours)
            if expected is None or not future_and_stop:
                assert (expected or "-") == db_reason, (
                    f"policy {number} lead {lead.label} as_of {utc_text(as_of)}: engine says {expected}, the database says {db_reason}"
                )
            else:
                assert expected == "future_history" and db_reason != "-", (
                    lead.label,
                    expected,
                    db_reason,
                )  # the known naming divergence: both not due
            compared += 1
    assert compared == len(POLICIES) * len(leads) * len(AS_OFS) and compared >= 700


cache: dict[str, LeadSnapshot] = {}
