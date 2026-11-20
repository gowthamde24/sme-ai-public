"""The Jobs list, thin version (planner, 21 Nov 2026): what already runs, read from the subsystems that own it, in the shape of jobs contract 1.0 section 1.

A job owns no rows: `enabled` IS the underlying switch (outreach rules, the business line, follow-up policy, visit settings, offer campaigns, the Lead Finder). Each reader is defensive: a subsystem that is not built in this process or that refuses the caller's role gives a job that is simply off, never a 500. S2 adds the owner's own names (jobs_meta) and the count of what waits for the owner (the items Today shows) on top of what the readers say; the detail, the settings and the switch are app/jobs/detail.py, catalogue.py and control.py."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.jobs import needs as needs_mod

logger = logging.getLogger("app.jobs")
KINDS = ("speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher")
_NAMESPACE = uuid.UUID("5a1d9c7e-3b44-4f63-9d0e-2f6a8c1b7e90")


def job_id(tenant_id: uuid.UUID, kind: str) -> uuid.UUID:
    """Stable per (workspace, kind): the same on every call, never stored."""
    return uuid.uuid5(_NAMESPACE, f"{tenant_id}:{kind}")


def _job(tenant_id: uuid.UUID, kind: str, *, enabled: bool, status: str, code: str, params: dict[str, Any] | None = None, plan_gate: str | None = None, fix: dict[str, Any] | None = None, last_run_at: datetime | None = None) -> dict[str, Any]:
    return {
        "id": str(job_id(tenant_id, kind)),
        "kind": kind,
        "custom_name": None,
        "enabled": enabled,
        "status": status,
        "result": {"code": code, "params": params or {}},
        "needs_you": 0,
        "last_run_at": last_run_at.isoformat() if last_run_at else None,
        "fix": fix,
        "plan_gate": {"code": plan_gate} if plan_gate else None,
    }


def _speed_to_lead(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
    kind = "speed_to_lead"
    rules = runtime.outreach.rules(token, tenant_id) if runtime.outreach is not None else []
    if not rules:
        return _job(tenant_id, kind, enabled=False, status="paused", code="not_set_up")
    live = [r for r in rules if r.active]
    reasons = {r.paused_reason for r in rules if not r.active}
    if len(live) == len(rules):
        return _job(tenant_id, kind, enabled=True, status="running", code="rules_on", params={"count": len(rules)})
    if "billing" in reasons:
        return _job(tenant_id, kind, enabled=False, status="waiting", code="paused_by_plan", plan_gate="billing_blocked")
    if reasons & {"cap_calls", "cap_minutes"}:
        return _job(tenant_id, kind, enabled=False, status="waiting", code="cap_reached", params={"count": len(rules) - len(live)})
    return _job(tenant_id, kind, enabled=False, status="paused", code="paused_by_owner", params={"count": len(rules)})


def _answer_calls(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
    kind = "answer_calls"
    service = runtime.phone_numbers
    line = service.line(token, tenant_id) if service is not None else None
    number = getattr(line, "number", None)
    if not number:
        return _job(tenant_id, kind, enabled=False, status="waiting", code="no_number", plan_gate="no_number")
    if getattr(line, "inbound_on", False):
        live = _assistant_state(runtime, token, tenant_id)
        if live is not None and live.state != "live":   # the owner's Pause (or support's) is what stops the line answering: the same switch "My assistant" shows
            return _job(tenant_id, kind, enabled=False, status="paused", code="paused_by_support" if getattr(live, "held_by_support", False) else "paused_by_owner")
        return _job(tenant_id, kind, enabled=True, status="running", code="answering")
    return _job(tenant_id, kind, enabled=False, status="paused", code="line_not_switched_on")


def _assistant_state(runtime: Any, token: str, tenant_id: uuid.UUID) -> Any:
    """The status of the Owner's assistant (live or not), or None when it cannot be read: then the line's own switch alone decides."""
    service = getattr(runtime, "assistant_status", None)
    if service is None:
        return None
    try:
        return service.status(token, tenant_id)
    except Exception:   # noqa: BLE001 - an unreadable status never hides the job
        return None


def _followups(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
    kind = "followups"
    policies = runtime.followups.list_policies(token, tenant_id, limit=1) if runtime.followups is not None else []
    if policies:
        return _job(tenant_id, kind, enabled=True, status="running", code="policy_on")
    return _job(tenant_id, kind, enabled=False, status="paused", code="not_set_up")


def _store_visits(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
    kind = "store_visits"
    settings = runtime.visits.settings_get(token, tenant_id) if runtime.visits is not None else {}
    if settings.get("is_default") is False:
        return _job(tenant_id, kind, enabled=True, status="running", code="visits_on")
    return _job(tenant_id, kind, enabled=False, status="paused", code="not_set_up")


def _offers(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
    kind = "offers"
    rows = runtime.campaigns.list_campaigns(token, tenant_id, None, 50, None) if runtime.campaigns is not None else []
    offers = [r for r in rows if r.get("kind") == "offer"]
    running = [r for r in offers if r.get("status") in ("approved", "running")]
    if running:
        return _job(tenant_id, kind, enabled=True, status="running", code="offer_running", params={"count": len(running)})
    if offers and all(r.get("status") in ("done", "cancelled") for r in offers):
        return _job(tenant_id, kind, enabled=False, status="done", code="offer_done", params={"count": len(offers)})
    if any(r.get("status") == "paused" for r in offers):
        return _job(tenant_id, kind, enabled=False, status="paused", code="paused_by_owner")
    return _job(tenant_id, kind, enabled=False, status="paused", code="no_offer_yet")


def _researcher(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
    """None: this business type never has the Lead Finder (a school), so the job is not listed."""
    kind = "researcher"
    if runtime.lead_finder is None:
        return None
    seen = runtime.lead_finder.availability(token, tenant_id)
    if seen.reason == "not_for_this_business":
        return None
    if seen.available:
        return _job(tenant_id, kind, enabled=True, status="running", code="free_search_ready")
    if seen.access == "limit_reached":
        return _job(tenant_id, kind, enabled=False, status="waiting", code="free_search_used", plan_gate="minutes_used")
    return _job(tenant_id, kind, enabled=False, status="paused", code="switched_off")


Reader = Callable[[Any, str, uuid.UUID], dict[str, Any] | None]
_READERS: tuple[tuple[str, Reader], ...] = (("speed_to_lead", _speed_to_lead), ("answer_calls", _answer_calls), ("followups", _followups), ("store_visits", _store_visits), ("offers", _offers), ("researcher", _researcher))
READERS: dict[str, Reader] = dict(_READERS)


def read_one(runtime: Any, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any] | None:
    """One job as its subsystem says it. A subsystem that cannot be read gives an off job (logged); None only for a kind this business never has."""
    try:
        return READERS[kind](runtime, token, tenant_id)
    except Exception as err:   # noqa: BLE001  (a subsystem may refuse this role or not be built here)
        logger.warning("jobs list: %s not readable (%s)", kind, type(err).__name__)
        return _job(tenant_id, kind, enabled=False, status="paused", code="not_readable")


# the jobs that have no switch in their own subsystem: their on/off is the `enabled` of their jobs_meta row (migration 20261231987700), read by the work itself
META_SWITCH = ("followups", "store_visits", "researcher")


def metas_of(runtime: Any, token: str, tenant_id: uuid.UUID) -> dict[str, dict[str, Any]]:
    """The jobs_meta row of each kind that has one (the owner's own name, the switch of the three jobs that have none of their own; every member reads); {} when there are none or they cannot be read."""
    trust = getattr(getattr(runtime, "jobs", None), "trust", None)
    if trust is None:
        return {}
    try:
        return {str(m["kind"]): m for m in trust.meta_list(token, tenant_id)}
    except Exception as err:   # noqa: BLE001
        logger.warning("jobs list: names not readable (%s)", type(err).__name__)
        return {}


def overlay(job: dict[str, Any], metas: dict[str, dict[str, Any]], counts: dict[str, int]) -> dict[str, Any]:
    """The owner's name, the owner's switch and what waits, on top of the reader's answer. A job the owner switched off is `paused`. A job that is running and has something waiting for the owner is `waiting` (contract section 1)."""
    kind = job["kind"]
    meta = metas.get(kind) or {}
    waiting = counts.get(kind, 0)
    job["custom_name"] = str(meta["custom_name"]) if meta.get("custom_name") else None
    job["needs_you"] = waiting
    if kind in META_SWITCH and meta.get("enabled") is False:
        job.update(enabled=False, status="paused", result={"code": "paused_by_owner", "params": {}})
    elif waiting and job["status"] == "running":
        job["status"] = "waiting"
    return job


def jobs_of(runtime: Any, token: str, tenant_id: uuid.UUID, needs: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Every job of the workspace, in the contract's order. One that cannot be read is listed as off (and logged), so one broken subsystem never blanks the page. `needs` are the waiting items when the caller has them already."""
    metas = metas_of(runtime, token, tenant_id)
    counts = needs_mod.count_by_job(needs if needs is not None else needs_mod.items_of(runtime, token, tenant_id))
    out: list[dict[str, Any]] = []
    for kind, _ in _READERS:
        job = read_one(runtime, token, tenant_id, kind)
        if job is not None:
            out.append(overlay(job, metas, counts))
    return out
