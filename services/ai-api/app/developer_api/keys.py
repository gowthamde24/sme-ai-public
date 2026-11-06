"""API keys and the test-mode sandbox's rules (pure: no I/O)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import re
import secrets
import string
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

PREFIX = "sk_test_"
_ALPHABET = string.ascii_letters + string.digits
_KEY = re.compile(r"sk_test_[A-Za-z0-9]{40}")
SCOPES = ("leads:write", "leads:read", "calls:read", "campaigns:write", "webhooks", "usage:read")
IST = ZoneInfo("Asia/Kolkata")
# test mode's calling hours: Monday to Saturday, 10:00 to 19:00 India time (the app's default); live mode will use the workspace's own
TEST_DAYS = (1, 2, 3, 4, 5, 6)
TEST_FROM, TEST_TO = 10 * 60, 19 * 60


@dataclass(frozen=True)
class NewKey:
    secret: str
    hash: str
    prefix: str
    last4: str


def key_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def new_key() -> NewKey:
    secret = PREFIX + "".join(secrets.choice(_ALPHABET) for _ in range(40))
    return NewKey(secret=secret, hash=key_hash(secret), prefix=secret[:12], last4=secret[-4:])


def looks_like_key(raw: str | None) -> bool:
    return bool(raw) and _KEY.fullmatch(raw or "") is not None


def bearer(header: str | None) -> str | None:
    """The key from `Authorization: Bearer sk_test_...`, or None. Nothing else is accepted (no query string, no cookie)."""
    if not header:
        return None
    scheme, _, value = header.strip().partition(" ")
    value = value.strip()
    return value if scheme.lower() == "bearer" and looks_like_key(value) else None


def body_sha(body: dict[str, object]) -> str:
    """The same request body gives the same hash whatever the key order or spacing (the idempotency check)."""
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str).encode("utf-8")).hexdigest()


def is_dnd_test_number(phone: str | None) -> bool:
    """Test mode's Do-Not-Disturb list: any number ending in 0000."""
    return bool(phone) and str(phone).endswith("0000")


def next_opening(now: datetime) -> datetime:
    local = now.astimezone(IST)
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    for offset in range(8):
        candidate_day = day + timedelta(days=offset)
        if candidate_day.isoweekday() not in TEST_DAYS:
            continue
        opening = candidate_day + timedelta(minutes=TEST_FROM)
        closing = candidate_day + timedelta(minutes=TEST_TO)
        if local < opening:
            return opening.astimezone(UTC)
        if local < closing:
            return local.astimezone(UTC)
    raise AssertionError("no opening in a week")   # cannot happen: six days a week are open


def first_step(phone: str | None, now: datetime) -> dict[str, object]:
    """The app's call-first rule, applied to a sandbox lead: call now inside the hours, at the next opening outside them, never a DND number; a lead with only an e-mail is followed up."""
    if not phone:
        return {"next_step": "follow_up", "next_step_at": None, "blocked": None}
    if is_dnd_test_number(phone):
        return {"next_step": "none", "next_step_at": None, "blocked": "dnd"}
    opening = next_opening(now)
    if opening <= now:
        return {"next_step": "call", "next_step_at": None, "blocked": None}
    return {"next_step": "call_at", "next_step_at": opening.isoformat(), "blocked": "calling_hours"}


def test_outcome(phone: str) -> str:
    """The simulated call's outcome, by the number's last digit (contract section 3)."""
    return {"1": "interested", "2": "not_interested", "3": "callback", "4": "no_answer", "5": "visit_booked"}.get(phone[-1:], "interested")
