# ruff: noqa: E501
"""What a call list row says about a call, in plain words (13 Nov 2026, for the Calls page): a `status` from a closed list and an `outcome_sentence` made ONLY from closed words (state, end reason, the result category, the refusal reason): no customer
text, no number, no name, nothing the model wrote. English drafts; the web may reword."""

from __future__ import annotations

from typing import Any, Literal

Status = Literal["completed", "transferred", "no_answer", "rejected", "spam", "live"]

CATEGORY_SENTENCE = {
    "interested": "Interested; wants to know more",
    "visit_booked": "Visit booked",
    "order_likely": "Likely to order",
    "not_interested": "Not interested",
    "wrong_number": "Wrong number",
    "too_costly": "Found it too costly",
    "call_back_later": "Asked for a call back later",
    "already_bought": "Already bought elsewhere",
    "do_not_call": "Asked us not to call again",
}
OUTCOME_SENTENCE = {"positive": "The call went well", "negative": "Not interested", "unclear": "No clear result", "no_answer": "No answer", "failed": "The call did not connect"}
STATE_SENTENCE = {"no_answer": "No answer", "busy": "The line was busy", "voicemail": "Went to voicemail", "failed": "The call did not connect", "cancelled": "Cancelled before it was placed", "queued": "Waiting to be placed", "ringing": "Ringing"}
REFUSED_SENTENCE = {
    "blocked_caller": "Blocked caller",
    "outside_window": "Not called: outside calling hours", "outside_hours": "Not called: outside calling hours", "holiday": "Not called: a holiday",
    "no_consent": "Not called: no consent", "suppressed": "Not called: asked us to stop", "dnd": "Not called: on the do-not-disturb list", "dnd_unknown": "Not called: do-not-disturb could not be checked",
    "workspace_paused": "Not called: the assistant is paused", "billing_blocked": "Not called: balance too low",
}


def status_of(row: dict[str, Any], live: bool) -> Status:
    state = str(row.get("state") or "")
    if live:
        return "live"
    if state == "refused":
        return "spam" if row.get("refuse_reason") == "blocked_caller" else "rejected"
    if state == "cancelled":
        return "rejected"
    if state in ("no_answer", "busy", "voicemail", "failed", "queued", "ringing"):
        return "no_answer"
    if row.get("end_reason") == "handover" or row.get("handled_at"):
        return "transferred"
    return "completed"


def sentence_of(row: dict[str, Any], live: bool) -> str:
    state = str(row.get("state") or "")
    if live:
        return "Talking now"
    if state == "refused":
        return REFUSED_SENTENCE.get(str(row.get("refuse_reason")), "The call was not placed")
    if state in STATE_SENTENCE:
        return STATE_SENTENCE[state]
    if row.get("end_reason") == "handover" or row.get("handled_at"):
        return "A person took over"
    category = row.get("category")
    if isinstance(category, str) and category in CATEGORY_SENTENCE:
        return CATEGORY_SENTENCE[category]
    outcome = row.get("outcome")
    return OUTCOME_SENTENCE.get(str(outcome), "Call finished")
