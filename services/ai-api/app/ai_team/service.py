"""Shapes the database's day (public.ai_team_day) into the contract's lanes, flow strip, cost and panels (docs/contracts/ai-team.md). Pure: no I/O. Every mark comes from a row; nothing is made up
here. The labels are the rows' own words."""

# ruff: noqa: E501

from __future__ import annotations

import math
import uuid
from datetime import datetime
from typing import Any

BUSINESS = ("lead_catcher", "lead_finder", "caller", "followups", "quote_writer", "order_desk")
SCHOOL = ("lead_catcher", "caller", "followups", "admissions", "fee_reminders", "notices")
HELPERS = frozenset(BUSINESS + SCHOOL)
MAX_MARKS = 200
DEFAULT_OPENS, DEFAULT_CLOSES = "09:00", "20:00"
# where a mark opens in the app (C2 may ask for other paths)
HREF = {
    "lead": "leads/{id}", "call": "calls/{id}", "quote": "quotes/{id}", "order": "orders/{id}", "visit": "visits", "prospect": "lead-finder", "prospect_search": "lead-finder",
    "campaign": "campaigns", "student": "admissions", "intake": "lead-sources",
}
SETTINGS = {
    "caller": [("calling_hours", "settings/calls")], "followups": [("followup_rules", "lead-desk/rules")], "lead_catcher": [("lead_sources", "lead-sources")],
    "lead_finder": [("lead_finder", "lead-finder")], "quote_writer": [("price_lists", "pricelists")], "order_desk": [("orders", "orders")],
    "admissions": [("admissions", "admissions")], "fee_reminders": [("fees", "fees")], "notices": [("campaigns", "campaigns")],
}


def helpers_for(raw: dict[str, Any]) -> list[str]:
    if raw.get("school"):
        return list(SCHOOL)
    modules = raw.get("modules") or {}
    return [h for h in BUSINESS if h != "lead_finder" or modules.get("lead_finder")]   # Lead Finder only where its module is on


def _href(tenant_id: uuid.UUID, ref_type: str, ref_id: str | None) -> str | None:
    path = HREF.get(ref_type)
    if path is None:
        return None
    return f"/app/tenants/{tenant_id}/" + path.format(id=ref_id or "")


def mark_out(tenant_id: uuid.UUID, m: dict[str, Any]) -> dict[str, Any]:
    ref_id = m.get("ref_id")
    return {"id": m["id"], "t": m["t"], "kind": m["kind"], "seconds": m.get("seconds"), "label": m.get("label"),
            "ref": {"type": m["ref_type"], "id": ref_id, "href": _href(tenant_id, str(m["ref_type"]), str(ref_id) if ref_id else None)}, "needs_owner": bool(m.get("needs"))}


def _status(helper: str, raw: dict[str, Any], waiting: int) -> dict[str, Any] | None:
    if not raw.get("today"):
        return None
    status = raw.get("status") or {}
    busy = status.get("caller_busy") if helper == "caller" else None
    if busy:
        return {"kind": "busy", "text_key": "on_call", "count": None, "at": None, "who": busy.get("who"), "since": busy.get("since")}
    if waiting:
        return {"kind": "waiting", "text_key": "waiting_for_you", "count": waiting, "at": None, "who": None, "since": None}
    due = status.get("caller_due") if helper == "caller" else status.get("followups_due") if helper == "followups" else None
    if due and int(due.get("count") or 0) > 0:
        return {"kind": "due", "text_key": "due_next", "count": int(due["count"]), "at": due.get("at"), "who": None, "since": None}
    return {"kind": "idle", "text_key": "idle", "count": None, "at": None, "who": None, "since": None}


def hours(raw: dict[str, Any]) -> dict[str, str]:
    h = raw.get("hours")
    if isinstance(h, dict) and h.get("open") and h.get("close"):
        return {"opens": str(h["open"])[:5], "closes": str(h["close"])[:5], "source": "business_hours"}
    return {"opens": DEFAULT_OPENS, "closes": DEFAULT_CLOSES, "source": "default"}


def cost(raw: dict[str, Any]) -> dict[str, Any] | None:
    c = raw.get("cost")
    if not isinstance(c, dict):
        return None
    ai = c.get("ai_micros")
    cap = c.get("ai_cap_micros")
    paise = int(c.get("calls_paise") or 0) + int(c.get("search_paise") or 0) + (int(ai) // 10_000 if ai is not None else 0)
    return {"paise": paise, "calls_minutes": math.ceil(int(c.get("calls_seconds") or 0) / 60), "messages": int(c.get("messages") or 0),
            "ai_percent": (min(100, round(int(ai) * 100 / int(cap))) if ai is not None and cap else None)}


def day_out(tenant_id: uuid.UUID, raw: dict[str, Any]) -> dict[str, Any]:
    marks = [m for m in raw.get("marks") or [] if m.get("helper") in HELPERS]
    lanes = []
    for helper in helpers_for(raw):
        mine = sorted((m for m in marks if m["helper"] == helper), key=lambda m: str(m["t"]))
        waiting = sum(1 for m in mine if m.get("needs"))
        lanes.append({"helper": helper, "status_now": _status(helper, raw, waiting), "count_today": sum(1 for m in mine if m.get("in_day")),
                      "marks": [mark_out(tenant_id, m) for m in mine[-MAX_MARKS:]]})
    active = {lane["helper"] for lane in lanes}
    return {"date": raw["date"], "now": raw["now"], "day": hours(raw), "lanes": lanes, "flow": raw.get("flow") or {"steps": [], "extra": []}, "cost_today": cost(raw),
            "needs_owner_total": sum(1 for m in marks if m.get("needs") and m["helper"] in active)}


def _numbers(helper: str, raw: dict[str, Any], marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    in_day = [m for m in marks if m.get("in_day")]
    kinds = [m["kind"] for m in in_day]
    if helper == "caller":
        c = (raw.get("numbers") or {}).get("caller") or {}
        calls = int(c.get("calls") or 0)
        return [{"key": "connected_percent", "value": round(int(c.get("connected") or 0) * 100 / calls) if calls else None},
                {"key": "interested", "value": int(c.get("interested") or 0)}, {"key": "minutes", "value": math.ceil(int(c.get("seconds") or 0) / 60)}]
    if helper == "followups":
        return [{"key": "sent", "value": kinds.count("message")}, {"key": "due", "value": ((raw.get("status") or {}).get("followups_due") or {}).get("count")},
                {"key": "waiting", "value": sum(1 for m in marks if m.get("needs"))}]
    if helper == "quote_writer":
        return [{"key": "made", "value": kinds.count("quote")}, {"key": "approved", "value": kinds.count("quote_approved")}, {"key": "waiting", "value": sum(1 for m in marks if m.get("needs"))}]
    if helper == "order_desk":
        return [{"key": "order_steps", "value": len(in_day)}]
    if helper == "lead_catcher":
        return [{"key": "leads", "value": len(in_day)}, {"key": "by_source", "value": (raw.get("numbers") or {}).get("lead_sources") or []}]
    if helper == "lead_finder":
        return [{"key": "searches", "value": kinds.count("search")}, {"key": "found", "value": kinds.count("found")}]
    return [{"key": "actions", "value": len(in_day)}]


def panel_out(tenant_id: uuid.UUID, helper: str, raw: dict[str, Any], earlier: list[dict[str, Any]]) -> dict[str, Any]:
    marks = sorted((m for m in raw.get("marks") or [] if m.get("helper") == helper), key=lambda m: str(m["t"]), reverse=True)
    waiting = sum(1 for m in marks if m.get("needs"))
    recent = [m for m in marks if m.get("in_day")][:10]
    if len(recent) < 10:
        recent += sorted((m for m in earlier if m.get("helper") == helper and m.get("in_day")), key=lambda m: str(m["t"]), reverse=True)[: 10 - len(recent)]
    c = cost(raw)
    own_cost = None
    if c is not None and helper == "caller":
        own_cost = {"paise": int((raw.get("cost") or {}).get("calls_paise") or 0)}
    elif c is not None and helper == "lead_finder":
        own_cost = {"paise": int((raw.get("cost") or {}).get("search_paise") or 0)}
    return {"helper": helper, "status_now": _status(helper, raw, waiting), "enabled": True, "can_switch": False, "reason_locked": "not_built",
            "recent": [mark_out(tenant_id, m) for m in recent],
            "today": {"count": sum(1 for m in marks if m.get("in_day")), "numbers": _numbers(helper, raw, marks)},
            "cost_today": own_cost if c is not None else None,
            "settings": [{"key": key, "value": None, "href": f"/app/tenants/{tenant_id}/{path}"} for key, path in SETTINGS.get(helper, [])],
            "train_href": "/ai-team/training"}


def parse_day(raw: str | None, today: datetime) -> Any:
    from datetime import date as _date

    if not raw:
        return today.date()
    return _date.fromisoformat(raw)
