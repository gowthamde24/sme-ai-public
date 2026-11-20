"""What waits for the owner, as the Jobs routes send it (jobs contract 1.0 sections 1 and 15.7, 16). It is the list Today shows: the SAME service reads the SAME rows (`runtime.today.today_summary`), the words of `kind` are Today's own
and the sentences stay the web's. Each item is `{id, code, kind, at, target {type, id}}`; `code` is the same word as `kind` (a closed word the web already has a sentence for).

A job counts the items that are about it (NEEDS_OF); an item that is about no job (an order's money, a quote) is in the list and counted by no job."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.today import service as today_service

logger = logging.getLogger("app.jobs")

# Today's `kind` words per job (anything not listed here is on the list for the web, and counted by no job)
NEEDS_OF: dict[str, tuple[str, ...]] = {
    "speed_to_lead": ("hot_lead_waiting", "outreach_paused", "call_approval"),
    "answer_calls": ("person_requested",),
    "followups": ("followup_due", "enquired_again", "message_needs_change"),
    "store_visits": ("visit_requested",),
    "offers": ("campaign_approval",),
    "researcher": (),
}
# Today's target types in the contract's closed list (`order | lead | call_request | approval | message`); one that is not in it (a fee list, the billing page) is sent as Today sends it
TARGET_TYPE: dict[str, str] = {
    "order": "order", "lead": "lead", "enquiry": "lead", "call_request": "call_request", "phone_call": "call_request", "message": "message",
    "quote": "approval", "material_quote": "approval", "campaign": "approval", "outreach_batch": "approval", "outbox_message": "approval",
}


def items_of(runtime: Any, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    """The waiting items of the caller (Today's own read, shaped by the caller's role). Nothing readable is an empty list, never a failed page."""
    repo = getattr(runtime, "today", None)
    if repo is None:
        return []
    try:
        shaped = today_service.shape_today(repo.today_summary(token, tenant_id)).needs_you
    except Exception as err:   # noqa: BLE001 - Today may refuse or be down; the jobs still show
        logger.warning("jobs: needs-you not readable (%s)", type(err).__name__)
        return []
    return [{"id": str(i.id), "code": i.kind, "kind": i.kind, "at": i.at.isoformat(), "target": {"type": TARGET_TYPE.get(i.target.type, i.target.type), "id": str(i.target.id)}} for i in shaped]


def count_by_job(items: list[dict[str, Any]]) -> dict[str, int]:
    kinds = [str(i.get("kind")) for i in items]
    return {job: sum(1 for k in kinds if k in words) for job, words in NEEDS_OF.items()}
