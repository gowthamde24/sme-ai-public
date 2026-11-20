"""What a job did in the last seven days: `results {days, numbers, items}` of the job page (jobs contract 1.0 sections 1 and 7), from the data the subsystems already hold, read through their own services (no raw tables, no provider
call, nothing paid).

  numbers   whole counts under closed keys per kind: speed_to_lead {called, picked_up, visits}; followups {drafted, approved, sent, waiting}; store_visits {booked, done, no_show, cancelled}; offers {sent, replied};
            researcher {searches, prospects_found}; answer_calls none yet
  items     at most five of the newest: {customer, status: done|waiting|failed|instead|noanswer, detail_code, params, at}. `customer` is the person's display name from the same helper every screen uses (`real_name`: the name when
            it is one; never a phone number, never an internal id), else a plain word for "no name". The offers and the researcher have counts only (a recipient list and a prospect list belong to their own screens; a researcher's
            prospect names may cost a Google lookup).

A part that cannot be read is empty: a subsystem that is not built here, a role the database refuses, anything that fails. The page never fails for its results."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from app.display_name import NO_NAME, real_name

logger = logging.getLogger("app.jobs")
IST = timezone(timedelta(hours=5, minutes=30))
DAYS = 7
MAX_ITEMS = 5


def _empty() -> dict[str, Any]:
    return {"days": DAYS, "numbers": {}, "items": []}


def _when(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    return None


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _speed_to_lead(env: Any, since: datetime, now: datetime) -> dict[str, Any]:
    out = _empty()
    outreach = env.runtime.outreach
    if outreach is None:
        return out
    today = now.astimezone(IST).date()
    total = outreach.report(env.token, env.tenant_id, today - timedelta(days=DAYS - 1), today).total
    out["numbers"] = {"called": int(total.calls), "picked_up": round(total.calls * total.connected_rate), "visits": int(total.bookings)}
    return out


def _followups(env: Any, since: datetime, now: datetime) -> dict[str, Any]:
    out = _empty()
    repo = env.runtime.followups
    if repo is None:
        return out
    rows = repo.list_drafts(env.token, env.tenant_id, lead_id=None, status=None, limit=100)
    created = [r for r in rows if (_when(r.get("created_at")) or since) >= since]
    approved = [r for r in rows if (_when(r.get("approved_at")) or since - timedelta(days=1)) >= since]
    out["numbers"] = {
        "drafted": len(created), "approved": len(approved),
        "sent": sum(1 for r in approved if r.get("status") == "recorded_sent"),
        "waiting": sum(1 for r in rows if r.get("status") == "draft"),   # drafts that wait for the owner, whatever their age
    }
    status_of = {"recorded_sent": "done", "approved": "waiting", "draft": "waiting"}
    recent: list[tuple[datetime, dict[str, Any]]] = []
    for r in rows:
        at = max((t for t in (_when(r.get("created_at")), _when(r.get("approved_at"))) if t is not None), default=None)
        if at is not None and at >= since and r.get("status") in status_of:
            recent.append((at, r))
    recent.sort(key=lambda pair: pair[0], reverse=True)
    for at, r in recent[:MAX_ITEMS]:
        out["items"].append({"customer": _contact_name(env, r.get("contact_id")), "status": status_of[str(r["status"])], "detail_code": f"draft_{r['status']}",
                             "params": {"touch": r.get("touch_number"), "channel": r.get("channel")}, "at": _iso(at)})
    return out


def _contact_name(env: Any, contact_id: Any) -> str:
    """The person's name by the one display-name helper; no phone number and no id ever stands in for it."""
    crm = getattr(env.runtime, "crm", None)
    if crm is None or contact_id is None:
        return NO_NAME
    try:
        row = crm.get_row(env.token, "contacts", env.tenant_id, uuid.UUID(str(contact_id)))
    except Exception:   # noqa: BLE001 - a name that cannot be read is "no name"
        return NO_NAME
    return real_name(getattr(row, "full_name", None)) or NO_NAME


def _store_visits(env: Any, since: datetime, now: datetime) -> dict[str, Any]:
    from app.visits import service as visits_service

    out = _empty()
    repo = env.runtime.visits
    if repo is None:
        return out
    today = now.astimezone(IST).date()
    raw = repo.list_visits(env.token, env.tenant_id, date_from=(today - timedelta(days=DAYS - 1)).isoformat(), date_to=today.isoformat(), open_only=False, status=None, lead_id=None, visit_id=None)
    visits = visits_service.list_out(raw).items
    out["numbers"] = {
        "booked": sum(1 for v in visits if v.status != "cancelled"), "done": sum(1 for v in visits if v.status == "completed"),
        "no_show": sum(1 for v in visits if v.status == "no_show"), "cancelled": sum(1 for v in visits if v.status == "cancelled"),
    }
    status_of = {"completed": "done", "booked": "waiting", "confirmed": "waiting", "arrived": "waiting", "no_show": "noanswer", "cancelled": "failed"}
    for v in sorted(visits, key=lambda x: x.starts_at, reverse=True)[:MAX_ITEMS]:
        out["items"].append({"customer": v.who, "status": status_of[v.status], "detail_code": f"visit_{v.status}", "params": {"date": v.date.isoformat(), "source": v.source}, "at": v.starts_at.isoformat()})
    return out


def _offers(env: Any, since: datetime, now: datetime) -> dict[str, Any]:
    out = _empty()
    repo = env.runtime.campaigns
    if repo is None:
        return out
    sent = replied = 0
    for row in [r for r in repo.list_campaigns(env.token, env.tenant_id, None, 50, None) if r.get("kind") == "offer" and r.get("status") in ("approved", "running", "paused", "done")][:3]:
        res = repo.results(env.token, env.tenant_id, uuid.UUID(str(row["id"])))
        by_state = res.get("by_state") or {}
        sent += sum(int(by_state.get(k) or 0) for k in ("sent", "delivered", "read"))
        replied += int(res.get("replied") or 0)
    out["numbers"] = {"sent": sent, "replied": replied}
    return out


def _researcher(env: Any, since: datetime, now: datetime) -> dict[str, Any]:
    out = _empty()
    finder = env.runtime.lead_finder
    if finder is None:
        return out
    done = [s for s in finder.searches(env.token, env.tenant_id, 50).items if s.state == "done" and (_when(s.finished_at) or _when(s.created_at) or since) >= since]
    out["numbers"] = {"searches": len(done), "prospects_found": sum(int(s.found) for s in done)}
    last = max((t for t in (_when(s.finished_at) or _when(s.created_at) for s in done) if t is not None), default=None)
    if last is not None:
        out["numbers"]["last_search_at"] = last.isoformat()   # contract 15.8: may sit next to the whole numbers; the web draws the whole numbers only
    return out


_BY_KIND = {"speed_to_lead": _speed_to_lead, "followups": _followups, "store_visits": _store_visits, "offers": _offers, "researcher": _researcher}


def results_of(env: Any, kind: str, now: datetime | None = None) -> dict[str, Any]:
    reader = _BY_KIND.get(kind)
    if reader is None:
        return _empty()
    moment = now or datetime.now(UTC)
    try:
        return reader(env, moment - timedelta(days=DAYS), moment)
    except Exception as err:   # noqa: BLE001 - results are a nicety: the page opens without them
        logger.info("jobs results: %s not readable (%s)", kind, type(err).__name__)
        return _empty()
