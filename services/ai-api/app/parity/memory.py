"""(c) Caller memory: every call starts with the lead's history (past calls, chats, the outcome, open promises). Builds the short brief the call prompt carries (app/opening/prompt.py). Pure; the rows come from the
lead's touches and outcomes."""

from __future__ import annotations

from typing import Any

MAX_CHARS = 700


def caller_brief(history: list[dict[str, Any]], promises: list[str]) -> str | None:
    """`history`: newest first, each {kind: call|chat|form, at: 'YYYY-MM-DD', summary, outcome?}. None for a first contact."""
    if not history and not promises:
        return None
    lines = []
    for item in history[:4]:
        part = f"{item.get('at', '?')} {item.get('kind', 'contact')}: {str(item.get('summary', '')).strip()[:140]}"
        if item.get("outcome"):
            part += f" (outcome: {item['outcome']})"
        lines.append(part)
    if promises:
        lines.append("Open promises: " + "; ".join(p.strip()[:100] for p in promises[:3]))
    return "\n".join(lines)[:MAX_CHARS]
