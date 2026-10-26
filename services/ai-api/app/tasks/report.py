"""The report of a task (job DR B1): a SHORT ANSWER first, then a row per person. Built by CODE from the stored results: the cheapest price is the lowest captured amount (no model does arithmetic or compares prices), the counts are counts. The sentences are fixed per language (drafts for native review)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.today.service import format_rupees

CHEAPEST: dict[str, str] = {"en": "Cheapest", "te": "తక్కువ price", "hi": "सबसे सस्ता", "kn": "ಕಡಿಮೆ price", "ta": "குறைவான price", "ml": "ഏറ്റവും കുറഞ്ഞ price"}
COUNTS: dict[str, str] = {
    "en": "{reached} of {total} reached, {positive} interested.",
    "te": "{total} లో {reached} మందితో మాట్లాడాం, {positive} మంది interested.",
    "hi": "{total} में से {reached} से बात हुई, {positive} interested हैं।",
    "kn": "{total} ರಲ್ಲಿ {reached} ಜನರೊಂದಿಗೆ ಮಾತಾಡಿದ್ವಿ, {positive} ಜನ interested.",
    "ta": "{total} பேர்ல {reached} பேர்கிட்ட பேசினோம், {positive} பேர் interested.",
    "ml": "{total} പേരിൽ {reached} പേരോട് സംസാരിച്ചു, {positive} പേർ interested.",
}
NONE_YET: dict[str, str] = {"en": "Nothing to report yet.", "te": "ఇంకా ఏమీ report చేయడానికి లేదు.", "hi": "अभी report करने को कुछ नहीं है।", "kn": "ಇನ್ನೂ report ಮಾಡೋದಕ್ಕೆ ಏನೂ ಇಲ್ಲ.", "ta": "இன்னும் report பண்ண எதுவும் இல்ல.", "ml": "ഇതുവരെ report ചെയ്യാൻ ഒന്നുമില്ല."}


def _rupees(paise: int) -> str:
    text = format_rupees(paise)
    return text[:-3] if text.endswith(".00") else text


def _row_outcome(row: dict[str, Any]) -> str:
    status = str(row.get("status"))
    if status == "done":
        return str(row.get("outcome") or "unclear")
    return {"failed": "failed", "skipped": "skipped"}.get(status, status)


def build(raw: dict[str, Any], language: str) -> dict[str, Any]:
    """`raw` is the answer of the database's task_report: the task and its rows. Returns the body of GET /tasks/{id}/report."""
    plan = raw.get("plan") or {}
    questions = plan.get("questions") or []
    amount_key = next((q["key"] for q in questions if q.get("type") == "amount"), None)
    date_key = next((q["key"] for q in questions if q.get("type") == "date"), None)
    rows = raw.get("rows") or []
    done = [r for r in rows if r.get("status") == "done"]
    totals = {
        "contacts": len(rows),
        "reached": sum(1 for r in done if r.get("outcome") in ("positive", "negative", "unclear")),
        "positive": sum(1 for r in done if r.get("outcome") == "positive"),
        "negative": sum(1 for r in done if r.get("outcome") == "negative"),
        "unclear": sum(1 for r in done if r.get("outcome") == "unclear"),
        "no_answer": sum(1 for r in done if r.get("outcome") == "no_answer"),
        "spent_paise": int(raw.get("spent_paise") or 0),
    }
    short, kind = NONE_YET[language], "counts"
    priced = [r for r in done if amount_key and isinstance((r.get("captured") or {}).get(amount_key), int) and not isinstance((r.get("captured") or {}).get(amount_key), bool)]
    if priced:
        best = min(priced, key=lambda r: ((r.get("captured") or {})[amount_key], r.get("name") or ""))
        captured = best.get("captured") or {}
        short = f"{CHEAPEST[language]}: {best.get('name')} {_rupees(int(captured[amount_key]))}"
        if date_key and captured.get(date_key):
            short += f", {captured[date_key]}"
        kind = "cheapest"
    elif rows and (totals["reached"] or done or raw.get("status") in ("done", "running", "paused")):
        short = COUNTS[language].format(reached=totals["reached"], total=sum(1 for r in rows if r.get("status") != "skipped"), positive=totals["positive"])
    out_rows = []
    for r in rows:
        out_rows.append({
            "contact_id": r["contact_id"], "name": r.get("name") or "", "phone_last4": r.get("phone_last4"), "outcome": _row_outcome(r), "category": r.get("outcome_category"),
            "captured": r.get("captured"), "transcript": r.get("transcript"), "recording_url": None, "simulated": bool(r.get("simulated", True)), "message_status": r.get("message_status"),
        })
    return {"task_id": raw["id"], "status": raw["status"], "short_answer": short, "short_answer_kind": kind, "totals": totals, "rows": out_rows, "simulated": True, "wording": "draft"}
