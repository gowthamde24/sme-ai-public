"""Which model answers this turn (job natural-voice): short, simple turns (yes, no, a confirmation, thanks, small talk) go to the fastest model; a turn that needs a tool, a number from the business's data, a date or a
decision, or is long, goes to the stronger one. Pure rules, no model call: the router itself must cost nothing in latency.

The model ids are settings of the deployment (AI_JOB_CALL_TURN and friends, ADR 0102); this module returns only the TIER ("fast" or "strong")."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Literal

Tier = Literal["fast", "strong"]

SMALL_TALK_WORDS = 6
LONG_TURN_CHARS = 80

# words that mean the answer must come from the business's data or ends in an action (a tool): price, stock, booking, dates, money, complaint, in the four languages we speak on a call
NEEDS_TOOL = re.compile(
    r"(price|rate|cost|stock|available|availability|book|booking|visit|appointment|schedule|reschedule|cancel|refund|order|deliver|payment|invoice|fee|discount|offer|complain|cheque|loan|"
    r"ధర|రేటు|ఎంత|స్టాక్|బుక్|ఆర్డర్|డెలివరీ|ఫీజు|డబ్బు|"
    r"कीमत|दाम|रेट|कितना|स्टॉक|बुक|ऑर्डर|डिलीवरी|फीस|"
    r"ಬೆಲೆ|ರೇಟ್|ಎಷ್ಟು|ಸ್ಟಾಕ್|ಬುಕ್|ಆರ್ಡರ್|ಫೀಸ್)",
    re.IGNORECASE,
)
DIGITS = re.compile(r"\d|[౦-౯०-९೦-೯]")
SIMPLE = re.compile(
    r"^\s*(yes|no|ok|okay|sure|fine|thanks?|thank you|bye|hello|hi|hmm|right|correct|alright|"
    r"అవును|కాదు|సరే|ఓకే|థాంక్స్|హలో|హా|"
    r"हाँ|हां|नहीं|ठीक|ठीक है|ओके|धन्यवाद|हेलो|जी|"
    r"ಹೌದು|ಇಲ್ಲ|ಸರಿ|ಓಕೆ|ಥ್ಯಾಂಕ್ಸ್|ಹಲೋ)\b",
    re.IGNORECASE,
)


def route(text: str, *, tools_available: bool = False, turn_number: int = 1) -> Tier:
    """`fast` or `strong` for what the caller just said."""
    said = text.strip()
    words = len(said.split())
    if NEEDS_TOOL.search(said) or DIGITS.search(said):
        return "strong"
    if tools_available and said.endswith("?") and words > SMALL_TALK_WORDS:
        return "strong"
    if len(said) > LONG_TURN_CHARS or words > 14:
        return "strong"
    if SIMPLE.match(said) or words <= SMALL_TALK_WORDS:
        return "fast"
    return "strong" if turn_number <= 1 and words > 10 else "fast"
