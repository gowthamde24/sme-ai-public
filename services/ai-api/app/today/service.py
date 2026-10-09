"""Shapes the database's plain facts into the screens' answers (job AD / D3).

Pure functions: no I/O, nothing decided here. The database functions `today_summary`,
`agents_status` and `ai_usage_today` return numbers, ids, codes and
timestamps, read under the caller's own row-level security. These only choose words and
convert units.
"""

from __future__ import annotations

from typing import Any

from app.errors import ApiError
from app.today.models import (
    AGENT_ORDER,
    AgentStatusOut,
    AiUsageOut,
    LastEvent,
    NeedsYouItem,
    RecentStep,
    Target,
    TodayCards,
    TodayOut,
)

MICROS_PER_PAISE = (
    10_000  # agent costs are kept in millionths of a rupee (100 paise = 1,000,000 micros)
)
UNKNOWN_CUSTOMER = "A customer"


def _bad(what: str) -> ApiError:
    return ApiError(502, "upstream_error", f"The data layer returned an unexpected {what}.")


def format_rupees(paise: int) -> str:
    """₹1,23,456.50 (Indian grouping: the last three digits, then pairs)."""
    whole, cents = divmod(abs(paise), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups: list[str] = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    sign = "-" if paise < 0 else ""
    return f"{sign}₹{digits}.{cents:02d}"


def _int(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _bad(what)
    return value


def _summary(kind: str, ref: str, amount: int | None) -> str:
    if kind == "quote_approval":
        total = format_rupees(amount) if amount is not None else "an amount to check"
        return f"Quote {ref} for {total} is ready for your approval."
    if kind == "followup_due":
        return f"A follow-up message (number {ref}) is drafted and waiting for your approval."
    held = format_rupees(amount) if amount is not None else "money"
    return f"Order {ref} is closed but still holds {held}. A refund may be owed."


_STEP_TEXT = {
    "created": "Order started",
    "send_quote": "Quote marked as sent to the customer",
    "customer_accept": "Customer accepted the quote",
    "customer_decline": "Customer said no",
    "expire": "Quote expired",
    "request_advance": "Advance asked for",
    "start_preparation": "Preparation started",
    "dispatch": "Order dispatched",
    "deliver": "Order delivered",
    "cancel": "Order cancelled",
}


def _step_text(kind: str, amount: int | None) -> str:
    if kind == "record_payment":
        return f"Payment of {format_rupees(amount)} recorded" if amount else "Payment recorded"
    if kind == "record_refund":
        return f"Refund of {format_rupees(amount)} recorded" if amount else "Refund recorded"
    return _STEP_TEXT.get(kind, "Order updated")


def shape_today(raw: Any) -> TodayOut:
    try:
        return _shape_today(raw)
    except (KeyError, TypeError, ValueError, AttributeError):
        raise _bad("Today answer") from None


def _shape_today(raw: Any) -> TodayOut:
    if not isinstance(raw, dict) or not isinstance(raw.get("cards"), dict):
        raise _bad("Today answer")
    cards = raw["cards"]
    needs: list[NeedsYouItem] = []
    for row in raw.get("needs_you") or []:
        amount = row.get("amount_paise")
        needs.append(
            NeedsYouItem(
                kind=row["kind"],
                id=row["id"],
                customer=row.get("customer") or UNKNOWN_CUSTOMER,
                city=row.get("city"),
                agent=row["agent"],
                summary=_summary(row["kind"], str(row["ref"]), amount),
                at=row["at"],
                amount_paise=amount,
                target=Target(type=row["target"]["type"], id=row["target"]["id"]),
            )
        )
    recent = [
        RecentStep(
            kind="order_step",
            order_ref=f"Order {row['order_no']}",
            customer=row.get("customer") or UNKNOWN_CUSTOMER,
            text=_step_text(str(row["type"]), row.get("amount_paise")),
            at=row["at"],
            target=Target(type="order", id=row["order_id"]),
        )
        for row in (raw.get("recent") or [])[:5]
    ]
    return TodayOut(
        cards=TodayCards(
            waiting=_int(cards.get("waiting"), "count"),
            money_held_paise=_int(cards.get("money_held_paise"), "amount"),
            orders_open=_int(cards.get("orders_open"), "count"),
        ),
        needs_you=needs,
        recent=recent,
    )


def shape_ai_usage(raw: Any) -> AiUsageOut:
    """Today's AI spend in paise, for the Asia/Kolkata day (the database cuts the day).

    Money still reserved by a call in flight counts as spent (the cap counts it too), rounded
    UP; the cap is rounded DOWN, so the figure left never overstates what can still be used.
    """
    if not isinstance(raw, dict):
        raise _bad("usage answer")
    cap_micros = _int(raw.get("cap_micros"), "cap")
    used_micros = _int(raw.get("spent_micros"), "spend")
    spent = -(-used_micros // MICROS_PER_PAISE)
    cap = cap_micros // MICROS_PER_PAISE
    return AiUsageOut(spent_paise=spent, cap_paise=cap, left_paise=max(cap - spent, 0))


JOBS: dict[str, str] = {
    "main": "Answers your questions about your business, with sources, and leaves drafts for you to approve. It sends nothing and sets no price.",
    "lead_finder": "Finds new businesses that may want to buy. Not built yet.",
    "researcher": "Reads public pages about a lead and writes down what it finds, with sources.",
    "requirement_analyst": "Reads an enquiry and lists what the customer asked for, to be checked.",
    "quote_writer": "Prepares a quote from the prices you set. A person approves it.",
    "followup_desk": "Drafts follow-up messages. A person approves and sends them.",
    "order_desk": "Keeps each order's steps, payments and refunds in order.",
}

_RUN_TEXT = {
    "succeeded": "Finished a run",
    "failed": "A run did not finish",
    "cancelled": "A run was cancelled",
    "expired": "A run ran out of time",
    "killed": "A run was stopped",
    "running": "Started a run",
}


_MAIN_TEXT = {
    "succeeded": "Answered a question",
    "failed": "Could not answer a question",
    "cancelled": "A question was stopped",
    "expired": "A question ran out of time",
    "killed": "A question was stopped",
    "running": "Started on a question",
}


def _last(text: str | None, at: Any) -> LastEvent | None:
    if text is None or at is None:
        return None
    return LastEvent(text=text, at=at)


def shape_agents(raw: Any) -> list[AgentStatusOut]:
    if not isinstance(raw, dict):
        raise _bad("agents answer")
    workspace_switch = raw.get("agents_enabled") is True

    def run_agent(key: str) -> tuple[str, LastEvent | None]:
        """"switched_off" is a helper that exists and whose switch is off (the platform's, its own, or the workspace's); a helper that does not exist is "not_available"."""
        facts = raw.get(key) or {}
        on = facts["switched_on"] if isinstance(facts.get("switched_on"), bool) else workspace_switch
        state = "switched_off" if not on else ("working" if facts.get("running") is True else "idle")
        status = facts.get("last_status")
        words = _MAIN_TEXT if key == "main" else _RUN_TEXT
        return state, _last(words.get(str(status)) if status else None, facts.get("last_at"))

    out: list[AgentStatusOut] = []
    for key in AGENT_ORDER:
        state = "idle"
        last: LastEvent | None = None
        if key == "lead_finder":
            state = "not_available"
        elif key in ("main", "researcher", "requirement_analyst"):
            state, last = run_agent(key)
        elif key == "quote_writer":
            facts = raw.get(key) or {}
            last = _last(
                f"Prepared quote {facts['last_no']}" if facts.get("last_no") else None,
                facts.get("last_at"),
            )
        elif key == "followup_desk":
            facts = raw.get(key) or {}
            last = _last(
                f"Drafted follow-up message number {facts['last_touch']}"
                if facts.get("last_touch")
                else None,
                facts.get("last_at"),
            )
        else:
            facts = raw.get(key) or {}
            kind = facts.get("last_type")
            last = _last(_step_text(str(kind), None) if kind else None, facts.get("last_at"))
        out.append(AgentStatusOut(agent=key, state=state, job=JOBS[key], last_event=last))  # type: ignore[arg-type]
    return out
