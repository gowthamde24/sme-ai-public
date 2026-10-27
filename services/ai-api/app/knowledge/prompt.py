"""The blocks of a prompt that come from the knowledge base and the lead playbook (job DR / A1). Pure. THE ASSISTANT MAY ONLY STATE APPROVED FACTS: `facts_block` is the only way approved facts get into a prompt, and it
leaves the price facts out unless the channel may state them (`allow_prices`)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

NOTHING = "FACTS YOU MAY STATE: none have been approved yet. Do not state any fact about the business (a price, an address, hours, an offer); say the team will get back to the customer."


def facts_block(facts: Sequence[dict[str, Any]], *, allow_prices: bool) -> str:
    """Only approved facts reach here (the database returns nothing else). A price fact is included only when `allow_prices` is true."""
    usable = [f for f in facts if allow_prices or f.get("kind") != "price"]
    if not usable:
        return NOTHING
    lines = [f"- {' '.join(str(f['text']).split())}" for f in usable]
    rule = "State only these facts; if the customer asks for anything else, say the team will get back to them. Never work out a total, a discount or a balance."
    if not allow_prices:
        rule += " Do not state any price or amount."
    return "FACTS YOU MAY STATE (approved by the business owner):\n" + "\n".join(lines) + "\n" + rule


def playbook_block(playbook: dict[str, Any], safety: Sequence[str], goal_label: str | None = None) -> str:
    """The playbook of a call or a lead conversation: the goal, the questions to ask (one at a time, in this order), the answers to the objections, and the safety rules of the business type."""
    lines = ["LEAD PLAYBOOK:", f"Goal: {playbook['goal_ask']['en']}" + (f" ({goal_label})" if goal_label else "")]
    lines.append("Ask these one at a time, in this order, and skip any the customer has already answered:")
    for i, q in enumerate(playbook["questions"], start=1):
        lines.append(f"  {i}. {q['ask']['en']}" + (" [needed]" if q.get("required") else ""))
    if playbook.get("objections"):
        lines.append("If the customer says something like this, answer in this spirit (in the customer's language, in your own spoken words):")
        for o in playbook["objections"]:
            lines.append(f"  - \"{'; '.join(o['hears'])}\": {o['answer']['en']}")
    if safety:
        lines.append("Rules for this kind of business:")
        lines += [f"  - {s}" for s in safety]
    return "\n".join(lines)
