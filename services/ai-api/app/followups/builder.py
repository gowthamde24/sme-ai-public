"""The follow-up REQUEST BUILDER: from what the database recorded for a lead (its status, its contact's suppression reason, a won opportunity, its touches and the policy in force) to the exact
request the pinned cadence engine runs on. Pure: no I/O, no clock (the caller gives `as_of`).

THE CONTRACT with the database (`app.followup_build`, migration 20261024090000): create_followup_draft refuses (SM226) any request that is not the one the database builds from its own rows, so this
module must produce it as the same JSON value, key for key (object key order does not matter; the ARRAYS do):
  * as_of                        = the API's now, UTC, whole seconds, "YYYY-MM-DDTHH:MM:SSZ" (the database bounds it to its own clock: 3 minutes back to 2 minutes ahead);
  * recipient_utc_offset_minutes = the policy's fixed offset (an integer);
  * lead  = {do_not_contact: the contact is suppressed for complained / legal / manual, opted_out: for opted_out, bounced: for bounced (all false for a lead without a contact),
             replied: an inbound touch exists, won: a non-archived opportunity of the lead is won, lost: the lead's status is `disqualified`};
  * history = every touch of the lead, ordered by (the second it occurred in, the touch id), each {timestamp (UTC, whole seconds), channel, direction, outcome:
              `recorded_sent` for an outbound touch, `recorded_reply` for an inbound one};
  * policy  = {gap_days, max_touches, quiet_hours: {start, end}, allowed_weekdays, holidays (ISO dates), min_gap_hours} exactly as stored (weekdays and holidays are stored sorted).
A key suppressed through ANOTHER contact is not a flag: it is the database's gate (SM220), which no caller can see or influence.
The integration gate (tests/integration/test_followup_equivalence.py) builds requests with this module and with the database side by side and requires them equal."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
DO_NOT_CONTACT_REASONS = ("complained", "legal", "manual")


class FollowupRequestError(ValueError):
    """The inputs cannot be turned into a request. `code` is a fixed name; no value is ever echoed."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Touch:
    id: str
    direction: str  # out | in
    channel: str  # email | whatsapp | phone
    occurred_at: datetime  # timezone-aware


@dataclass(frozen=True)
class PolicySnapshot:
    id: str
    gap_days: tuple[int, ...]
    max_touches: int
    quiet_start: str  # HH:MM
    quiet_end: str
    allowed_weekdays: tuple[int, ...]
    holidays: tuple[str, ...]  # ISO dates
    min_gap_hours: int
    recipient_utc_offset_minutes: int


@dataclass(frozen=True)
class LeadSnapshot:
    """What the database recorded for a lead: read with the caller's token, never taken from a request body."""

    lead_id: str
    status: str  # the lead's status (new | in_review | qualified | disqualified)
    contact_suppression_reason: str | None  # None: no contact, or a contact that is not suppressed
    has_won_opportunity: bool
    touches: tuple[Touch, ...]
    policy: PolicySnapshot | None


def utc_text(moment: datetime) -> str:
    """The engine's canonical timestamp: UTC, whole seconds, a trailing Z."""
    if moment.tzinfo is None:
        raise FollowupRequestError("naive_time")
    return moment.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_instant(raw: Any) -> datetime:
    """A timestamp as PostgREST returns it (ISO 8601 with an offset)."""
    if not isinstance(raw, str):
        raise FollowupRequestError("bad_time")
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        raise FollowupRequestError("bad_time") from None
    if moment.tzinfo is None:
        raise FollowupRequestError("naive_time")
    return moment


def _int(value: object) -> int:
    if type(value) is not int:
        raise FollowupRequestError("not_integer")
    return value


def _flags(snapshot: LeadSnapshot) -> dict[str, bool]:
    reason = snapshot.contact_suppression_reason
    return {
        "do_not_contact": reason in DO_NOT_CONTACT_REASONS,
        "opted_out": reason == "opted_out",
        "replied": any(t.direction == "in" for t in snapshot.touches),
        "bounced": reason == "bounced",
        "won": snapshot.has_won_opportunity,
        "lost": snapshot.status == "disqualified",
    }


def _history(touches: tuple[Touch, ...]) -> list[dict[str, str]]:
    for t in touches:
        if not _UUID.fullmatch(t.id) or t.direction not in ("out", "in"):
            raise FollowupRequestError("bad_touch")
    # (the second it occurred in, the touch id): the order of app.followup_build
    ordered = sorted(
        touches, key=lambda t: (t.occurred_at.astimezone(UTC).replace(microsecond=0), t.id)
    )
    return [
        {
            "timestamp": utc_text(t.occurred_at),
            "channel": t.channel,
            "direction": t.direction,
            "outcome": "recorded_sent" if t.direction == "out" else "recorded_reply",
        }
        for t in ordered
    ]


def policy_request(policy: PolicySnapshot) -> dict[str, Any]:
    return {
        "gap_days": [_int(g) for g in policy.gap_days],
        "max_touches": _int(policy.max_touches),
        "quiet_hours": {"start": policy.quiet_start, "end": policy.quiet_end},
        "allowed_weekdays": [_int(d) for d in policy.allowed_weekdays],
        "holidays": list(policy.holidays),
        "min_gap_hours": _int(policy.min_gap_hours),
    }


def build_request(snapshot: LeadSnapshot, *, as_of: datetime) -> dict[str, Any]:
    """The engine request for this lead as of `as_of` (UTC or any aware time). Raises FollowupRequestError('no_policy') when no policy is in force."""
    if snapshot.policy is None:
        raise FollowupRequestError("no_policy")
    return {
        "as_of": utc_text(as_of),
        "recipient_utc_offset_minutes": _int(snapshot.policy.recipient_utc_offset_minutes),
        "lead": _flags(snapshot),
        "history": _history(snapshot.touches),
        "policy": policy_request(snapshot.policy),
    }
