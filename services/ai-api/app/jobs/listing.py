"""The Jobs list, thin version (planner, 21 Nov 2026): what already runs, read from the subsystems that own it, in the shape of jobs contract 1.0 section 1.

A job owns no rows: `enabled` IS the underlying switch (outreach rules, the business line, follow-up policy, visit settings, offer campaigns, the Lead Finder). Each reader is defensive: a subsystem that is not built in this process or that refuses the caller's role gives a job that is simply off, never a 500. Not here yet (full S2): detail, PATCH, results, custom names, needs_you items."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

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
        return _job(tenant_id, kind, enabled=True, status="running", code="answering")
    return _job(tenant_id, kind, enabled=False, status="paused", code="line_not_switched_on")


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


_READERS = (("speed_to_lead", _speed_to_lead), ("answer_calls", _answer_calls), ("followups", _followups), ("store_visits", _store_visits), ("offers", _offers), ("researcher", _researcher))


def jobs_of(runtime: Any, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    """Every job of the workspace, in the contract's order. One that cannot be read is listed as off (and logged), so one broken subsystem never blanks the page."""
    out: list[dict[str, Any]] = []
    for kind, reader in _READERS:
        try:
            job = reader(runtime, token, tenant_id)
        except Exception as err:   # noqa: BLE001  (a subsystem may refuse this role or not be built here)
            logger.warning("jobs list: %s not readable (%s)", kind, type(err).__name__)
            job = _job(tenant_id, kind, enabled=False, status="paused", code="not_readable")
        if job is not None:
            out.append(job)
    return out
