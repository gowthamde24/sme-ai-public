"""(i) Call analysis: summary, key points, captured custom fields, sentiment and a QA score per call, and the recordings-and-transcripts retention setting. A rule-based FAKE analyser (no model, no cost): the real one
is the same shape with a model behind it. Pure."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

POSITIVE = re.compile(r"\b(yes|sure|okay|ok|thank|thanks|great|good|interested|please send)\b|అవును|సరే|ధన్యవాదాలు|हाँ|ठीक|धन्यवाद|ಹೌದು|ಸರಿ", re.IGNORECASE)
NEGATIVE = re.compile(r"\b(no|not interested|stop|don'?t call|angry|waste|complaint|cheat)\b|వద్దు|కాదు|नहीं|मत करो|ಬೇಡ", re.IGNORECASE)
RETENTION_DAYS = (0, 30, 90, 180, 365)  # 0 = keep the summary only, never the recording or the transcript


@dataclass(frozen=True)
class Analysis:
    summary: str
    key_points: list[str]
    captured: dict[str, str]
    sentiment: str  # positive | neutral | negative
    qa_score: int  # 0-100


def analyse(transcript: list[tuple[str, str]], fields: dict[str, re.Pattern[str]], *, mention_ai_required: bool) -> Analysis:
    """`transcript`: (speaker, text) with speaker assistant|customer. `fields`: custom field -> a pattern whose first group is the value."""
    customer = " ".join(t for s, t in transcript if s == "customer")
    assistant = [t for s, t in transcript if s == "assistant"]
    pos, neg = len(POSITIVE.findall(customer)), len(NEGATIVE.findall(customer))
    sentiment = "positive" if pos > neg else "negative" if neg > pos else "neutral"
    captured = {k: m.group(1).strip() for k, rx in fields.items() if (m := rx.search(customer))}
    points = [t[:120] for s, t in transcript if s == "customer" and len(t) > 12][:3]
    summary = f"{len(transcript)} turns; customer sounded {sentiment}; captured {', '.join(captured) or 'nothing'}."
    first = assistant[0] if assistant else ""
    checks = [
        bool(first),  # greeted
        (not mention_ai_required) or bool(re.search(r"\bAI\b", first)),  # said it is an AI when the switch is on
        any("?" in t for t in assistant),  # asked something
        bool(assistant) and bool(re.search(r"thank|ధన్యవాదాలు|धन्यवाद|ಧನ್ಯವಾದ", assistant[-1], re.IGNORECASE)),  # closed politely
        not any(re.search(r"\b(i am|i'm) (a )?(human|real person)\b", t, re.IGNORECASE) for t in assistant),  # never claimed to be human
    ]
    return Analysis(summary, points, captured, sentiment, round(100 * sum(checks) / len(checks)))


def keep_until(created: date, retention_days: int) -> date | None:
    """The day the recording and transcript are deleted; None = already (retention 0: only the analysis is kept)."""
    if retention_days not in RETENTION_DAYS:
        raise ValueError("retention days")
    return None if retention_days == 0 else created + timedelta(days=retention_days)


def as_dict(a: Analysis) -> dict[str, Any]:
    return {"summary": a.summary, "key_points": a.key_points, "captured": a.captured, "sentiment": a.sentiment, "qa_score": a.qa_score}
