"""Job BI: the iCalendar text (a golden file, folding, escaping), the rate limiter and the PostgREST repository (what is sent, how failures are classified, that the anonymous feed read sends no token)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.crm.repository import InvalidValueError
from app.integrations.errors import ExportTooLargeError, ImportJobStateError, ImportMismatchError
from app.integrations.ics import _fold, build_calendar
from app.integrations.ratelimit import SlidingWindow
from app.integrations.repository import PostgrestIntegrationsRepository
from app.tenancy.repository import Forbidden, MfaRequired, UpstreamError

GOLDEN = Path(__file__).parent / "golden_bi"
FEED: dict[str, Any] = {
    "business": "Reddy; Sons, Silks",
    "generated_at": "2026-10-05T08:30:00+00:00",
    "events": [
        {"id": "11111111-1111-4111-8111-111111111111", "starts_at": "2026-10-05T11:30:00+05:30", "ends_at": "2026-10-05T12:00:00+05:30", "status": "booked", "party_size": 3, "label": "Ravi K.", "updated_at": "2026-10-04T09:00:00+00:00"},
        {"id": "22222222-2222-4222-8222-222222222222", "starts_at": "2026-10-06T05:00:00+00:00", "ends_at": "2026-10-06T05:30:00+00:00", "status": "confirmed", "party_size": 1, "label": "శ్రీ లక్ష్మి చీరల అంగడి యజమాని గారు", "updated_at": "2026-10-05T08:00:00+00:00"},
        {"id": "33333333-3333-4333-8333-333333333333", "starts_at": "2026-10-07T05:00:00+00:00", "ends_at": "2026-10-07T05:30:00+00:00", "status": "arrived", "party_size": 2, "label": "Anil\r\nSUMMARY:evil", "updated_at": "2026-10-05T08:00:00+00:00"},
    ],
}  # fmt: skip


def test_the_calendar_golden() -> None:
    text = build_calendar(FEED)
    path = GOLDEN / "visits.ics"
    import os

    if os.environ.get("UPDATE_GOLDEN") == "1":
        path.write_bytes(text.encode("utf-8"))
    assert text == path.read_bytes().decode("utf-8")


def test_the_calendar_is_valid_in_the_ways_calendar_apps_check() -> None:
    text = build_calendar(FEED)
    assert text.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") and text.endswith("END:VCALENDAR\r\n") and "\n" not in text.replace("\r\n", "")
    assert all(len(line.encode("utf-8")) <= 75 for line in text.split("\r\n")), "lines are folded at 75 octets"
    assert text.count("BEGIN:VEVENT") == text.count("END:VEVENT") == 3
    assert "DTSTART:20261005T060000Z" in text, "11:30 India time is 06:00 UTC"
    assert "STATUS:TENTATIVE" in text and text.count("STATUS:CONFIRMED") == 2
    assert "UID:visit-11111111-1111-4111-8111-111111111111@sme-ai" in text


def test_text_is_escaped_and_a_label_cannot_inject_a_line() -> None:
    text = build_calendar(FEED)
    unfolded = text.replace("\r\n ", "")
    assert r"X-WR-CALNAME:Reddy\; Sons\, Silks - store visits" in unfolded
    assert "\r\nSUMMARY:evil" not in text and "SUMMARY:Visit: Anil\\nSUMMARY:evil" in unfolded, "a newline in a label is escaped, never a new property"


def test_nothing_but_the_allowed_fields_reaches_the_calendar() -> None:
    leaky = {**FEED, "events": [{**FEED["events"][0], "phone": "+91 98765 43210", "note": "secret", "purpose": "wedding", "email": "a@example.test"}]}
    text = build_calendar(leaky)
    for secret in ("98765", "secret", "wedding", "a@example.test"):
        assert secret not in text


def test_folding_never_splits_a_character() -> None:
    line = "SUMMARY:" + "శ్రీ" * 40
    parts = _fold(line)
    assert all(len(p.encode("utf-8")) <= 75 for p in parts) and "".join(p[1:] if i else p for i, p in enumerate(parts)) == line


def test_an_empty_feed_is_a_valid_calendar() -> None:
    text = build_calendar({"business": "Shop", "generated_at": "2026-10-05T08:30:00+00:00", "events": []})
    assert "BEGIN:VEVENT" not in text and text.endswith("END:VCALENDAR\r\n")


# ------------------------------------------------------------------------------------------------------------------------ the limiter
def test_sliding_window() -> None:
    now = [0.0]
    lim = SlidingWindow(3, 10, clock=lambda: now[0])
    assert [lim.allow("a") for _ in range(4)] == [True, True, True, False]
    assert lim.allow("b") is True, "keys are independent"
    now[0] = 9.9
    assert lim.allow("a") is False and lim.retry_after("a") >= 1
    now[0] = 10.1
    assert lim.allow("a") is True, "the first hit left the window"


def test_the_table_is_bounded() -> None:
    lim = SlidingWindow(1, 1000, max_keys=50)
    for i in range(500):
        lim.allow(f"k{i}")
    assert len(lim._hits) <= 50


# ------------------------------------------------------------------------------------------------------------------------ the repository
def repo_with(handler: Any) -> tuple[PostgrestIntegrationsRepository, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)  # type: ignore[no-any-return]

    return PostgrestIntegrationsRepository("http://rest", "PUBLIC-KEY", client=httpx.Client(base_url="http://rest", transport=httpx.MockTransport(wrapped))), seen


def test_calls_carry_the_callers_token_and_the_public_key_only() -> None:
    repo, seen = repo_with(lambda r: httpx.Response(200, json={"active": True}))
    repo.calendar_status("USER-JWT", __import__("uuid").UUID(int=1))
    assert seen[0].url.path == "/rpc/calendar_feed_status" and seen[0].headers["authorization"] == "Bearer USER-JWT" and seen[0].headers["apikey"] == "PUBLIC-KEY"
    assert json.loads(seen[0].content) == {"p_tenant_id": str(__import__("uuid").UUID(int=1))}


def test_the_anonymous_feed_read_sends_no_authorization() -> None:
    repo, seen = repo_with(lambda r: httpx.Response(200, json={"events": []}))
    assert repo.calendar_read("a" * 64) == {"events": []}
    assert "authorization" not in seen[0].headers and seen[0].headers["apikey"] == "PUBLIC-KEY"
    repo2, _ = repo_with(lambda r: httpx.Response(200, content=b"null", headers={"content-type": "application/json"}))
    assert repo2.calendar_read("a" * 64) is None, "a null answer (unknown or revoked token) is None"


@pytest.mark.parametrize(
    ("code", "exc"),
    [("SM601", ExportTooLargeError), ("SM602", ImportJobStateError), ("SM603", ImportMismatchError), ("SM306", MfaRequired), ("42501", Forbidden), ("22023", InvalidValueError)],
)
def test_failures_are_classified_by_sqlstate_only(code: str, exc: type[Exception]) -> None:
    repo, _ = repo_with(lambda r: httpx.Response(400, json={"code": code, "message": "SECRET customer text", "details": "more"}))
    with pytest.raises(exc) as e:
        repo.export_data("t", __import__("uuid").UUID(int=1), __import__("uuid").UUID(int=2), "csv", "2026-10-01", "2026-10-31")
    assert "SECRET" not in str(e.value)


def test_an_unreachable_data_layer_and_odd_answers() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    repo, _ = repo_with(boom)
    with pytest.raises(UpstreamError):
        repo.policy_mine("t")
    repo2, _ = repo_with(lambda r: httpx.Response(200, json=[1, 2]))
    with pytest.raises(UpstreamError):
        repo2.job_get("t", __import__("uuid").UUID(int=1), __import__("uuid").UUID(int=2))
    repo3, _ = repo_with(lambda r: httpx.Response(200, text="not json"))
    with pytest.raises(UpstreamError):
        repo3.policy_mine("t")
