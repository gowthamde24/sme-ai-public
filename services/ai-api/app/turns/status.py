"""What a proposed action is doing now (job EA): the state of the task behind it, in the closed words of the contract. Pure; no imports from the rest of the app."""

from __future__ import annotations

from datetime import datetime, timedelta

PLAN_MINUTES = 30   # a plan nobody answers expires after this long


def action_status(task_status: str, proposed_at: datetime | None, now: datetime) -> str:
    """proposed | confirmed | declined | expired | running | done. A plan that waited more than PLAN_MINUTES without a yes or no is `expired`."""
    if task_status == "needs_answer":
        return "proposed"
    if task_status == "planned":
        if proposed_at is not None and now - proposed_at > timedelta(minutes=PLAN_MINUTES):
            return "expired"
        return "proposed"
    if task_status == "approved":
        return "confirmed"
    if task_status in ("running", "paused"):
        return "running"
    if task_status == "done":
        return "done"
    return "declined"   # cancelled
