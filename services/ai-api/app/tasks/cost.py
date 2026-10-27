"""What a task is estimated to cost (job DR B1). Money is computed HERE, from counts, with fixed fake rates (telephony and the message price are not contracted yet): the model never calculates a price. Paise throughout."""

from __future__ import annotations

from typing import Any

CALL_MINUTES = 2
CALL_PAISE_PER_MINUTE = 150
MESSAGE_PAISE = 60
CAP_MARGIN_NUMERATOR, CAP_MARGIN_DENOMINATOR = 12, 10   # the default cap is the estimate plus 20 percent
BASIS = "fake rates: Rs 1.50 a minute, Rs 0.60 a message"


def estimate(contacts: int, channel: str, follow_up_kind: str) -> dict[str, Any]:
    calls = contacts if channel in ("call", "both") else 0
    messages = contacts if channel in ("whatsapp", "both") else 0
    if channel == "call" and follow_up_kind == "whatsapp_summary":
        messages = contacts
    minutes = calls * CALL_MINUTES
    cost = minutes * CALL_PAISE_PER_MINUTE + messages * MESSAGE_PAISE
    return {"contacts": contacts, "calls": calls, "messages": messages, "minutes": minutes, "cost_paise": cost, "basis": BASIS}


def default_cap(estimated_paise: int) -> int:
    return (estimated_paise * CAP_MARGIN_NUMERATOR + CAP_MARGIN_DENOMINATOR - 1) // CAP_MARGIN_DENOMINATOR
