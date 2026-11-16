"""The first message templates as DATA (13 Nov 2026): six templates in te / hi / kn / en, created as DRAFTS for a workspace and then submitted to Meta. Every body has TWO structured variables ({{1}} the customer's first name, {{2}} the business name; never free message text) with words around it (Meta's rule, the same
as the database CHECK), no price and no link: the same checks run in a test, so a data change that Meta or the database would refuse fails here first."""

from __future__ import annotations

import json
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).parent / "data" / "first_templates.json"
LANGUAGES = ("en", "te", "hi", "kn")
SAMPLES = ("Ravi", "Sri Lakshmi Silks")   # Meta's review samples for {{1}} (the customer's first name) and {{2}} (the business name)
NAMESPACE = uuid.UUID("0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70")


OPT_OUT_PAYLOAD = "marketing_stop"   # the payload a tap on the marketing opt-out button comes back with (we send it with the message; Meta returns it in the webhook)


def sample_values(body: str, name: str | None = None) -> list[str]:
    """The sample values sent with a template to Meta (its `example`): one per variable. A body with two or more variables is a structured one (name, business, and for an offer a short label whose sample the template data names);
    an older single-variable body keeps its one sample."""
    count = len(set(re.findall(r"\{\{(\d)\}\}", body)))
    third = next((str(t["sample3"]) for t in load() if t["name"] == name and t.get("sample3")), "sample")
    return [*SAMPLES, third, *["sample"] * 6][:count] if count >= 2 else ["a sample message"]


def meta_components(template: dict[str, Any]) -> list[dict[str, Any]]:
    """What Meta is sent for a template: its BODY with the sample values and, for a marketing template, the quick-reply opt-out button (Meta's own marketing opt-out)."""
    components: list[dict[str, Any]] = [{"type": "BODY", "text": template["body"], "example": {"body_text": [sample_values(str(template["body"]), str(template.get("name") or ""))]}}]
    label = template.get("opt_out_label")
    if isinstance(label, str) and label:
        components.append({"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": label}]})
    return components


_LINK = re.compile(r"https?:|www\.|://|@|\.(?:com|in|co|net|org|app|me|io|shop|store)(?:\b|$)", re.IGNORECASE)
_PRICE = re.compile(r"(?:₹|\brs\.?|\binr|\brupees?)\s*[0-9]|[0-9]\s*(?:₹|%|\brs\b|\binr\b|\brupees?\b|\bpercent\b)|\bpercent\b|%", re.IGNORECASE)
_DISCOUNT = re.compile(r"\b(?:off|discount|cashback)\b|తగ్గింపు|డిస్కౌంట్|छूट|डिस्काउंट|ರಿಯಾಯಿತಿ|ಡಿಸ್ಕೌಂಟ್", re.IGNORECASE)


def offer_label_problem(label: str | None) -> str | None:
    """The {{3}} label of an offer message (a collection or an occasion: "Silk sarees", "Diwali"): None when it is fine, else the closed reason. The same rule as the database's app.offer_label_problem (a test runs both on the same words)."""
    if label is None or label != label.strip() or not 2 <= len(label) <= 30:
        return "length"
    if re.search(r"[\x00-\x1f\x7f]", label) or re.search(r"\s{2,}", label):
        return "text"
    if _LINK.search(label):
        return "link"
    if _PRICE.search(label):
        return "price"
    if _DISCOUNT.search(label):
        return "discount"
    return None


@lru_cache(maxsize=1)
def load() -> list[dict[str, Any]]:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    return list(doc["templates"])


def drafts(languages: tuple[str, ...] = LANGUAGES, *, include_unreviewed: bool = False) -> list[dict[str, str]]:
    """Every (name, language) draft: {name, language, category, purpose, body, opt_out_label}. A template that names the languages a native reader has checked (`ready`) is created only in those, unless `include_unreviewed` is set (tests, review)."""
    out: list[dict[str, str]] = []
    for t in load():
        for lang in languages:
            if lang in t["body"] and (include_unreviewed or "ready" not in t or lang in t["ready"]):
                out.append({"name": t["name"], "language": lang, "category": t["category"], "purpose": t["purpose"], "body": t["body"][lang], "opt_out_label": (t.get("buttons") or {}).get(lang, "")})
    return out


def template_id(tenant_id: uuid.UUID, name: str, language: str) -> uuid.UUID:
    """The same draft of the same workspace always has the same id, so seeding twice changes nothing."""
    return uuid.uuid5(NAMESPACE, f"{tenant_id}|{name}|{language}")


# Meta's template status words -> ours
META_STATUS = {"APPROVED": "approved", "REJECTED": "rejected", "PAUSED": "paused", "DISABLED": "disabled", "PENDING": "submitted", "IN_APPEAL": "submitted", "PENDING_DELETION": "disabled"}
