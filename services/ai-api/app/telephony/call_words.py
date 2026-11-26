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
    "no_consent": "Not called: no consent", "no_proof_of_request": "Not called: this person has not asked us to call", "prospect_no_ai_call": "Not called: Lead Finder prospects are never called by the assistant", "suppressed": "Not called: asked us to stop", "dnd": "Not called: on the do-not-disturb list", "dnd_unknown": "Not called: do-not-disturb could not be checked",
    "workspace_paused": "Not called: the assistant is paused", "complaints_pause": "Not called: calls are paused after people asked us to stop", "billing_blocked": "Not called: balance too low",
    "enquiry_too_old": "Not called: the person's enquiry is too old to call about (seven days; an application, three months) and no registered consent is recorded",
    "outbound_not_real": "Not called: real outgoing calls are not switched on yet", "no_own_number": "Not called: the business needs its own verified number first",
    "usage_not_accepted": "Not called: the owner has not yet accepted how the number will be used",
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


def code_of(row: dict[str, Any], live: bool) -> str:
    """The closed word the sentence is made from, so a screen can word it in the person's own language (26 Nov 2026): `live`, `refused_<reason>` (or `refused`), `state_<state>`, `handover`, `category_<category>`,
    `outcome_<outcome>` or `finished`. Always one of them, never empty; `outcome_sentence` stays as the English fallback and says exactly what the English of this code is."""
    state = str(row.get("state") or "")
    if live:
        return "live"
    if state == "refused":
        reason = str(row.get("refuse_reason"))
        return f"refused_{reason}" if reason in REFUSED_SENTENCE else "refused"
    if state in STATE_SENTENCE:
        return f"state_{state}"
    if row.get("end_reason") == "handover" or row.get("handled_at"):
        return "handover"
    category = row.get("category")
    if isinstance(category, str) and category in CATEGORY_SENTENCE:
        return f"category_{category}"
    outcome = row.get("outcome")
    if str(outcome) in OUTCOME_SENTENCE:
        return f"outcome_{outcome}"
    return "finished"


def all_codes() -> list[str]:
    """Every code `code_of` can give (the web words each one; a test keeps this list and the sentences equal)."""
    return sorted(["live", "refused", "handover", "finished", *(f"refused_{k}" for k in REFUSED_SENTENCE), *(f"state_{k}" for k in STATE_SENTENCE), *(f"category_{k}" for k in CATEGORY_SENTENCE), *(f"outcome_{k}" for k in OUTCOME_SENTENCE)])


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
