"""The switch of a job: pause and resume (jobs contract 1.0 section 2). `enabled` IS the underlying switch of the subsystem, written through the same function as the old screen; a job owns no switch of its own.

  speed_to_lead   the standing rules: pause stops every rule that is on; resume turns on the rules the OWNER paused. It never creates an approval: a rule nobody approved does not exist (the job says it is not set up), and a rule
                  that stopped for the plan (billing) or for a limit (the day's calls, the minutes) is not restarted by a tap: the plan or the limit lifts it.
  answer_calls    the Owner's assistant: Pause and Go live (the same two doors "My assistant" has). Going live is refused while support holds the assistant or a name or a number is missing.
  offers          the offers that are approved or running pause; the ones that are paused resume.
  followups, store_visits, researcher   have no switch in the code base (a policy, the visit hours and the monthly search have no off): `409 job_not_switchable`.

Nothing here decides who may: the database does, with the caller's own token (Owner and Admin for the rules and the offers, Owner for the assistant)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.errors import ApiError

SWITCHABLE = ("speed_to_lead", "answer_calls", "offers")


def not_switchable() -> ApiError:
    return ApiError(409, "job_not_switchable", "This job has no switch: it works as long as it is set up. Change its settings instead.")


def _need(service: Any) -> Any:
    if service is None:
        raise ApiError(503, "jobs_unavailable", "Jobs are not available on this system.")
    return service


def _speed_to_lead(runtime: Any, token: str, tenant_id: uuid.UUID, enabled: bool) -> None:
    service = _need(runtime.outreach)
    for rule in service.rules(token, tenant_id):
        if not enabled and rule.active:
            service.rule_state(token, tenant_id, rule.id, "pause")
        elif enabled and not rule.active and rule.paused_reason == "owner":
            service.rule_state(token, tenant_id, rule.id, "resume")


def _answer_calls(runtime: Any, token: str, tenant_id: uuid.UUID, enabled: bool) -> None:
    from app.assistant_status.service import HeldBySupportError, NotReadyError

    service = _need(runtime.assistant_status)
    try:
        if enabled:
            service.go_live(token, tenant_id)
        else:
            service.pause(token, tenant_id)
    except HeldBySupportError:
        raise ApiError(409, "held_by_support", "Stack19 support paused your assistant. Ask support to resume it.") from None
    except NotReadyError:
        raise ApiError(409, "assistant_not_ready", "The assistant needs a business name and a connected phone number before it can go live.", extra={"missing": service.status(token, tenant_id).missing}) from None


def _offers(runtime: Any, token: str, tenant_id: uuid.UUID, enabled: bool) -> None:
    repo = _need(runtime.campaigns)
    for row in repo.list_campaigns(token, tenant_id, None, 50, None):
        if row.get("kind") != "offer":
            continue
        if not enabled and row.get("status") in ("approved", "running"):
            repo.set_state(token, tenant_id, uuid.UUID(str(row["id"])), "pause")
        elif enabled and row.get("status") == "paused":
            repo.set_state(token, tenant_id, uuid.UUID(str(row["id"])), "resume")


_BY_KIND = {"speed_to_lead": _speed_to_lead, "answer_calls": _answer_calls, "offers": _offers}


def set_enabled(runtime: Any, token: str, tenant_id: uuid.UUID, kind: str, enabled: bool) -> None:
    if kind not in _BY_KIND:
        raise not_switchable()
    _BY_KIND[kind](runtime, token, tenant_id, enabled)
