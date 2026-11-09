"""My AI team v2, T1 (docs/contracts/ai-team.md): GET /ai-team/day and GET /ai-team/{helper}. The fake repository answers as public.ai_team_day does (pgTAP 170 pins the database: every mark a real
row, the ⚑ count == Needs you per role). Here: the lanes per pack and module, the 200-mark cap with the true count, the live status, the cost in paise and percent, dates, roles, the panel."""

# ruff: noqa: E501

from __future__ import annotations

import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from app.ai_team import routes as R
from app.ai_team import service as S
from app.ai_team import standup
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-team"
IST = ZoneInfo("Asia/Kolkata")


def mark(helper: str, kind: str, minute: int, *, needs: bool = False, in_day: bool = True, seconds: int | None = None) -> dict[str, Any]:
    t = datetime.now(IST).replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(minutes=minute)
    return {"helper": helper, "id": f"x:{uuid.uuid4()}", "t": t.isoformat(), "kind": kind, "seconds": seconds, "label": f"{helper} {minute}", "ref_type": "lead", "ref_id": str(uuid.uuid4()),
            "needs": needs, "in_day": in_day}


def raw_day(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "date": datetime.now(IST).date().isoformat(), "now": datetime.now(IST).isoformat(), "today": True, "school": False, "role": "owner",
        "modules": {"lead_finder": True, "quotes": True}, "hours": {"open": "10:00", "close": "20:30"},
        "marks": [mark("caller", "call", 5, seconds=84), mark("caller", "call", 50, needs=True, in_day=False), mark("lead_catcher", "lead_in", 1), mark("quote_writer", "quote", 30, needs=True)],
        "status": {"caller_busy": None, "caller_due": {"count": 5, "at": "2026-11-06T16:00:00+05:30"}, "followups_due": {"count": 0, "at": None}},
        "flow": {"steps": [{"key": "leads_in", "count": 1}, {"key": "called", "count": 1}, {"key": "interested", "count": 0}, {"key": "quotes", "count": 1}, {"key": "orders", "count": 0}], "extra": []},
        "cost": {"calls_paise": 900, "calls_seconds": 84, "search_paise": 100, "messages": 2, "ai_micros": 5_000_000, "ai_cap_micros": 20_000_000},
        "numbers": {"caller": {"calls": 4, "connected": 3, "interested": 1, "seconds": 84}, "lead_sources": [{"source": "indiamart", "count": 1}]},
    }
    base.update(over)
    return base


class FakeRepo:
    def __init__(self, raw: dict[str, Any]) -> None:
        self.raw, self.calls = raw, 0

    def day(self, token: str, tenant_id: uuid.UUID, on: Any) -> dict[str, Any]:
        self.calls += 1
        return dict(self.raw, date=on.isoformat())


@pytest.fixture(autouse=True)
def _no_cache() -> None:
    R._cache.clear()  # noqa: SLF001


def world(raw: dict[str, Any] | None = None) -> tuple[Any, FakeRepo]:
    R._cache.clear()  # noqa: SLF001 - a new world, a new day
    repo = FakeRepo(raw or raw_day())
    client, _ = make_client(ai_team=repo)
    return client, repo


def test_a_business_day_has_its_six_lanes_in_sales_order_with_marks_status_and_cost() -> None:
    client, _ = world()
    got = client.get(f"{BASE}/day", headers=auth("a_owner")).json()
    assert [lane["helper"] for lane in got["lanes"]] == ["lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk"]
    caller = next(lane for lane in got["lanes"] if lane["helper"] == "caller")
    assert caller["count_today"] == 1 and len(caller["marks"]) == 2 and caller["marks"][0]["seconds"] == 84 and caller["marks"][0]["ref"]["href"].startswith(f"/app/tenants/{TENANT_A.id}/leads/")
    assert caller["status_now"]["kind"] == "waiting" and caller["status_now"]["count"] == 1, "something waits for the Owner: that comes before what is due"
    assert got["needs_owner_total"] == 2 and got["day"] == {"opens": "10:00", "closes": "20:30", "source": "business_hours"}
    assert got["cost_today"] == {"paise": 900 + 100 + 500, "calls_minutes": 2, "messages": 2, "ai_percent": 25}
    assert [s["key"] for s in got["flow"]["steps"]] == ["leads_in", "called", "interested", "quotes", "orders"]


def test_a_school_gets_its_lanes_and_lead_finder_needs_its_module() -> None:
    client, _ = world(raw_day(school=True))
    assert [lane["helper"] for lane in client.get(f"{BASE}/day", headers=auth("a_owner")).json()["lanes"]] == list(S.SCHOOL)
    client, _ = world(raw_day(modules={"lead_finder": False, "quotes": True}))
    assert "lead_finder" not in [lane["helper"] for lane in client.get(f"{BASE}/day", headers=auth("a_owner")).json()["lanes"]]


def test_the_status_now_busy_then_waiting_then_due_then_idle() -> None:
    raw = raw_day(status={"caller_busy": {"who": "Ramesh", "since": "2026-11-06T14:11:18+05:30"}, "caller_due": {"count": 5, "at": None}, "followups_due": {"count": 3, "at": "2026-11-06T16:00:00+05:30"}})
    client, _ = world(raw)
    lanes = {lane["helper"]: lane["status_now"] for lane in client.get(f"{BASE}/day", headers=auth("a_owner")).json()["lanes"]}
    assert lanes["caller"]["kind"] == "busy" and lanes["caller"]["who"] == "Ramesh" and lanes["caller"]["since"]
    assert lanes["followups"] == {"kind": "due", "text_key": "due_next", "count": 3, "at": "2026-11-06T16:00:00+05:30", "who": None, "since": None}
    assert lanes["order_desk"]["kind"] == "idle"
    past = (datetime.now(IST).date() - timedelta(days=1)).isoformat()
    client, _ = world(raw_day(today=False, status=None))
    assert all(lane["status_now"] is None for lane in client.get(f"{BASE}/day?date={past}", headers=auth("a_owner")).json()["lanes"]), "no live status for a past day"


def test_at_most_200_marks_a_lane_newest_kept_and_the_true_count() -> None:
    client, _ = world(raw_day(marks=[mark("caller", "call", i) for i in range(260)]))
    caller = next(lane for lane in client.get(f"{BASE}/day", headers=auth("a_owner")).json()["lanes"] if lane["helper"] == "caller")
    assert len(caller["marks"]) == 200 and caller["count_today"] == 260 and caller["marks"][-1]["label"] == "caller 259"


def test_dates_roles_and_the_cache() -> None:
    client, repo = world()
    today = datetime.now(IST).date()
    for bad in ("tomorrow", (today + timedelta(days=1)).isoformat(), (today - timedelta(days=32)).isoformat()):
        got = client.get(f"{BASE}/day?date={bad}", headers=auth("a_owner"))
        assert got.status_code == 422 and got.json()["error"]["code"] == "date_out_of_range", bad
    assert client.get(f"{BASE}/day", headers=auth("a_viewer")).status_code == 403
    assert client.get(f"{BASE}/day", headers=auth("a_sales")).status_code == 200
    client.get(f"{BASE}/day", headers=auth("a_owner"))
    client.get(f"{BASE}/day", headers=auth("a_owner"))
    assert repo.calls == 2, "one read per person for 15 s (the Sales read and the Owner's first)"


def test_cost_is_null_when_the_database_gives_none() -> None:
    client, _ = world(raw_day(cost=None))
    assert client.get(f"{BASE}/day", headers=auth("a_sales")).json()["cost_today"] is None


def test_the_panel() -> None:
    client, _ = world()
    got = client.get(f"{BASE}/caller", headers=auth("a_owner")).json()
    assert got["helper"] == "caller" and got["status_now"]["kind"] == "waiting"
    assert not {"enabled", "can_switch", "reason_locked", "settings"} & got.keys(), "no placeholder fields: the switch and the settings are not built, so the panel does not pretend"
    assert dict((n["key"], n["value"]) for n in got["today"]["numbers"]) == {"connected_percent": 75, "interested": 1, "minutes": 2}
    assert got["cost_today"] == {"paise": 900} and got["train_href"] == "/ai-team/training"
    assert len(got["recent"]) >= 1
    assert client.get(f"{BASE}/nobody", headers=auth("a_owner")).status_code == 404
    client, _ = world(raw_day(modules={"lead_finder": False, "quotes": True}))
    assert client.get(f"{BASE}/lead_finder", headers=auth("a_owner")).status_code == 404, "not active here"
    client, _ = world(raw_day(school=True))
    assert client.get(f"{BASE}/admissions", headers=auth("a_owner")).status_code == 200


# ---- the morning stand-up (text only, made by code from the day's numbers; owner, 9 Nov 2026) -----------------------------------------------------------


IST_ = timezone(timedelta(hours=5, minutes=30))
NOW_ = datetime(2026, 11, 9, 9, 5, tzinfo=IST_)
NAMES = ("Ramesh K", "Lakshmi Devi", "Suresh Reddy", "Padma")


def synthetic_days(seed: int) -> tuple[dict[str, Any], dict[str, Any], dict[str, int]]:
    """Yesterday's and today's AI team day, as the screen gets them, with random counts and customer names in the labels (which must never reach the stand-up)."""
    rnd = random.Random(seed)  # noqa: S311 - a test fixture, not security
    counts = {k: rnd.choice([0, 0, 1, 2, 7, 23, 41]) for k in standup.BUSINESS_STEPS}
    yesterday = {"flow": {"steps": [{"key": k, "count": v} for k, v in counts.items()], "extra": []}, "lanes": [], "needs_owner_total": 0}
    waiting = rnd.choice([0, 1, 4])
    due = rnd.choice([0, 3, 5])
    visits = sorted(rnd.sample(range(10, 19), rnd.choice([0, 1, 3])))
    today = {
        "needs_owner_total": waiting,
        "lanes": [
            {"helper": "caller", "status_now": {"kind": "due", "count": due, "at": "2026-11-09T16:00:00+05:30"} if due else {"kind": "idle"},
             "marks": [{"kind": "visit", "t": f"2026-11-09T{h:02d}:30:00+05:30", "label": f"{rnd.choice(NAMES)} · visit"} for h in visits] + [{"kind": "call", "t": "2026-11-09T08:00:00+05:30", "label": f"{rnd.choice(NAMES)} · interested"}]},
            {"helper": "followups", "status_now": {"kind": "due", "count": due, "at": None} if due else {"kind": "idle"}, "marks": []},
        ],
    }
    return yesterday, today, {**counts, "waiting": waiting, "due": due, "visits": len(visits)}


@pytest.mark.parametrize("seed", range(10))
@pytest.mark.parametrize("lang", ["te", "en"])
def test_the_standup_says_only_what_the_data_says_and_never_a_customers_name(seed: int, lang: str) -> None:
    yesterday, today, truth = synthetic_days(seed)
    got = standup.build(yesterday, today, lang, NOW_)
    assert got["text"] == " ".join(line["text"] for line in got["lines"]) and all(line["source"] for line in got["lines"])
    said = {int(n) for n in re.findall(r"(?<![\d:])\d+(?![\d:])", re.sub(r"\d{2}:\d{2}", "", got["text"]))}
    listed = {int(n["value"]) for n in got["numbers"]}
    assert said == listed, "every number in the text is in `numbers`, and every listed number is in the text"
    truth_values = {v for v in truth.values() if v > 0}
    assert listed <= truth_values, "every number matches a number in the data"
    for key in standup.BUSINESS_STEPS:
        yes = [n for n in got["numbers"] if n["key"] == f"yesterday.{key}"]
        assert (len(yes) == 1 and yes[0]["value"] == truth[key]) if truth[key] > 0 else not yes, "a count above zero is said once; a zero is left out"
    assert next((n["value"] for n in got["numbers"] if n["key"] == "now.waiting"), 0) == truth["waiting"]
    assert next((n["value"] for n in got["numbers"] if n["key"] == "today.visits"), 0) == truth["visits"]
    assert not any(name.split()[0] in got["text"] for name in NAMES), "no customer's name, ever"
    assert got["draft"] is (lang != "en") and got["language"] == lang


def test_the_standup_in_each_language_a_quiet_day_a_school_and_an_unknown_language() -> None:
    quiet = {"flow": {"steps": [{"key": k, "count": 0} for k in standup.BUSINESS_STEPS]}, "lanes": [], "needs_owner_total": 0}
    for lang, said in (("en", "Yesterday was quiet"), ("te", "నిన్న కొత్తగా ఏమీ రాలేదు"), ("kn", "ನಿನ್ನೆ ಹೊಸದಾಗಿ ಏನೂ ಬರಲಿಲ್ಲ"), ("hi", "कल कुछ नया नहीं आया")):
        got = standup.build(quiet, quiet, lang, NOW_)
        assert said in got["text"] and got["numbers"] == [] and standup.WORDS[lang]["today_empty"] in got["text"] and standup.WORDS[lang]["nothing_waiting"] in got["text"]
    school = {"flow": {"steps": [{"key": "enquiries", "count": 5}, {"key": "called", "count": 4}, {"key": "campus_visits", "count": 2}, {"key": "admissions", "count": 1}], "extra": []}, "lanes": [], "needs_owner_total": 1}
    got = standup.build(school, quiet, "en", NOW_)
    assert "5 enquiries, 4 people called, 2 campus visits, 1 admissions." in got["text"] and "1 thing is waiting" not in got["text"]
    assert standup.build(school, school, "en", NOW_)["text"].count("1 thing is waiting for you.") == 1
    assert standup.build(quiet, quiet, "ta", NOW_)["language"] == "en", "a language without words gets English"
    assert not standup.build(quiet, quiet, "en", NOW_)["draft"] and all(standup.build(quiet, quiet, x, NOW_)["draft"] for x in ("te", "kn", "hi"))
