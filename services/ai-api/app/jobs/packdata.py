"""The job templates of a business type: packages/packs/<pack>/jobs.json (jobs contract section 5: suggestions come from pack data, like lead_finder.json).

Code never names a pack: the workspace's pack id (from the database) picks the file. A file is read whole or not at all: anything that breaks a rule below (a wrong count, a word outside the closed lists, a Telugu
text missing, a price or a promise in a customer-facing line, a call that does not say it is an AI) makes the loader refuse the file, log it and answer "no templates" (fail closed); it never serves half a file.
Every customer-facing text in these files is a DRAFT for a native reader (the file says "status": "draft").

Rules the loader enforces (the same ones the owner wrote in decision-ai-team.md):
  * 8 to 12 templates per pack, 3 or 4 of them `popular`, unique snake_case ids, closed words for kind / goal / needs / finds_out / season;
  * en is present for every text, te for every title, ask and customer-facing preview line; hi and kn are optional (a missing language falls back to English in the web);
  * a preview line uses only the placeholders {business} {customer} {item} {assistant}, has no digit and no price, discount, offer, free, guarantee, refund or other money word (a get_paid template may say payment or fee
    but never an amount), every call snippet is exactly two lines and starts with the AI line, and en and te use the same placeholders;
  * a researcher template shows 3 invented example prospects and NEVER a whatsapp or call preview: the owner reaches out personally, and its text says so.
"""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.packs.registry import default_directory

logger = logging.getLogger("app.jobs.packdata")

KINDS = ("speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher", "custom")
GOALS = ("answer_every_enquiry", "bring_customers_back", "fill_your_visits", "get_paid", "find_new_customers")
NEEDS = ("whatsapp", "phone_number", "catalogue_item", "visit_hours", "lead_source")
FINDS_OUT = ("need", "quantity", "when", "visit", "budget_range", "still_interested")
SEASONS = ("diwali", "wedding_season", "new_year", "none")
LANGUAGES = ("en", "te", "hi", "kn")
PLACEHOLDERS = frozenset({"business", "customer", "item", "assistant"})
MIN_TEMPLATES, MAX_TEMPLATES = 8, 12
MIN_POPULAR, MAX_POPULAR = 3, 4
EXAMPLES_PER_RESEARCHER = 3
STATUS = "draft"  # every customer-facing text is a draft for a native reader until the owner's review says otherwise

_PACK = re.compile(r"^[a-z][a-z0-9_]{1,30}$")
_ID = re.compile(r"^[a-z][a-z0-9_]{2,40}$")
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")
_TELUGU = re.compile(r"[ఀ-౿]")
_DIGIT = re.compile(r"[0-9౦-౯०-९೦-೯]")  # ascii, Telugu, Hindi and Kannada digits
AI_LINE = "{assistant}, the AI assistant of {business}"
_AI_TE = re.compile(r"^\{assistant\}[^\n]*\{business\}[^\n]*\bAI\b")

# what a message or a call to a customer may NEVER carry (the platform forbids price, discount, delivery or refund promises, guarantees)
_MONEY_EN = re.compile(r"\b(price|prices|pricing|priced|discount|discounts|offer|offers|offered|free|freebie|guarantee|guaranteed|warranty|refund|refunds|cheap|cheaper|cheapest|cost|costs|rate|rates|emi|sale|deal|deals|rupee|rupees|rs|inr|lowest|best|hurry|limited|exclusive|cashback|coupon|waive|waived|deliver|delivery|delivered)\b", re.I)
_MONEY_TE = re.compile(r"(డిస్కౌంట్|ఆఫర్|ధర|రేటు|రేట్|ఫ్రీ|ఉచిత|గ్యారంటీ|గ్యారెంటీ|వారంటీ|రిఫండ్|తిరిగి ఇచ్చ|తక్కువ|చవక|రూపాయ|రూ\.|ప్రైస్|ఖర్చు|ఈఎంఐ|సేల్|డీల్|క్యాష్‌బ్యాక్|కూపన్|డెలివరీ)")
# payment words: only a get_paid template may use them, and still without an amount (the digit rule)
_PAY_EN = re.compile(r"\b(payment|payments|pay|paid|fee|fees|due|dues|bill|invoice|balance|advance|installment|installments|instalment|instalments|premium|renewal)\b", re.I)
_PAY_TE = re.compile(r"(పేమెంట్|చెల్లింపు|ఫీజు|బాకీ|బిల్లు|ఇన్వాయిస్|బ్యాలెన్స్|అడ్వాన్స్|ప్రీమియం|రెన్యువల్|కట్టా|కట్టే)")
_PROSPECT_PROMISE_EN = re.compile(r"you contact them yourself", re.I)


class JobsPackError(ValueError):
    """A jobs.json that must not be served; the message says where."""


@dataclass(frozen=True)
class Example:
    name: str
    area: str
    why: dict[str, str]


@dataclass(frozen=True)
class JobTemplate:
    id: str
    kind: str
    goal: str
    popular: bool
    title: dict[str, str]
    benefit: dict[str, str]
    ask: dict[str, str]
    whatsapp: dict[str, str] = field(default_factory=dict)
    call: dict[str, str] = field(default_factory=dict)
    sample_audio: str | None = None  # a voice sample id, added later
    examples: tuple[Example, ...] = ()
    needs: tuple[str, ...] = ()
    finds_out: tuple[str, ...] = ()
    season: str = "none"


@dataclass(frozen=True)
class PackJobs:
    pack_id: str
    status: str
    templates: tuple[JobTemplate, ...]

    def popular(self) -> tuple[JobTemplate, ...]:
        return tuple(t for t in self.templates if t.popular)

    def by_goal(self, goal: str) -> tuple[JobTemplate, ...]:
        return tuple(t for t in self.templates if t.goal == goal)

    def get(self, template_id: str) -> JobTemplate | None:
        return next((t for t in self.templates if t.id == template_id), None)


def text_in(texts: dict[str, str], language: str) -> str:
    """The text in this language, else English (a language without the text falls back to English)."""
    return texts.get(language) or texts["en"]


def fill(text: str, *, business: str, customer: str = "", item: str = "", assistant: str = "") -> str:
    """The text with the four placeholders filled; a placeholder that is not one of them was refused at load time."""
    values = {"business": business, "customer": customer, "item": item, "assistant": assistant}
    return _PLACEHOLDER.sub(lambda m: values[m.group(1)], text)


def _fail(where: str, why: str) -> JobsPackError:
    return JobsPackError(f"{where}: {why}")


def _texts(raw: Any, where: str, *, need_te: bool, one_line: bool = True) -> dict[str, str]:
    if not isinstance(raw, dict) or not raw:
        raise _fail(where, "must be an object with a text per language")
    out: dict[str, str] = {}
    for language, value in raw.items():
        if language not in LANGUAGES:
            raise _fail(where, f"language {language!r} is not one of {LANGUAGES}")
        if not isinstance(value, str) or not value.strip():
            raise _fail(where, f"{language} must be a non-empty text")
        if value != value.strip():
            raise _fail(where, f"{language} has spaces at its ends")
        if one_line and "\n" in value:
            raise _fail(where, f"{language} must be one line")
        if _DIGIT.search(value) or "₹" in value or "%" in value:
            raise _fail(where, f"{language} carries a digit, a percent sign or a rupee sign: no invented numbers")
        out[language] = value
    if "en" not in out:
        raise _fail(where, "en is missing")
    if need_te and "te" not in out:
        raise _fail(where, "te is missing")
    if "te" in out and not _TELUGU.search(out["te"]):
        raise _fail(where, "te has no Telugu letters (a Latin-only value is a copy of the English)")
    return out


def _placeholders(text: str, where: str) -> frozenset[str]:
    found = frozenset(_PLACEHOLDER.findall(text))
    if not found <= PLACEHOLDERS:
        raise _fail(where, f"placeholders {sorted(found - PLACEHOLDERS)} are not allowed (only {sorted(PLACEHOLDERS)})")
    rest = _PLACEHOLDER.sub("", text)
    if "{" in rest or "}" in rest:
        raise _fail(where, "a brace that is not a whole placeholder")
    return found


def _customer_text(texts: dict[str, str], where: str, goal: str) -> None:
    """The rules for a line a customer will read or hear: no price, discount, promise, guarantee; money words only for a get_paid template; same placeholders in every language."""
    sets = {language: _placeholders(value, f"{where}.{language}") for language, value in texts.items()}
    for language, found in sets.items():
        if "business" not in found:
            raise _fail(f"{where}.{language}", "{business} is missing: the customer must see who writes")
        if found != sets["en"]:
            raise _fail(f"{where}.{language}", "uses other placeholders than en")
    for language, value in texts.items():
        if _MONEY_EN.search(value) or _MONEY_TE.search(value):
            raise _fail(f"{where}.{language}", "names a price, discount, offer, guarantee, refund or delivery: the platform forbids it in every message and call")
        if goal != "get_paid" and (_PAY_EN.search(value) or _PAY_TE.search(value)):
            raise _fail(f"{where}.{language}", "mentions money (payment, fee, due...): only a get_paid template may, and without an amount")


def _closed(raw: Any, allowed: tuple[str, ...], where: str) -> tuple[str, ...]:
    if not isinstance(raw, list) or any(not isinstance(v, str) or v not in allowed for v in raw) or len(set(raw)) != len(raw):
        raise _fail(where, f"must be a list of distinct words from {allowed}")
    return tuple(raw)


def _example(raw: Any, where: str) -> Example:
    if not isinstance(raw, dict) or set(raw) != {"name", "area", "why"}:
        raise _fail(where, "an example is {name, area, why}")
    name, area = raw["name"], raw["area"]
    if not isinstance(name, str) or not name.endswith("(example)") or _DIGIT.search(name) or "@" in name or "+" in name:
        raise _fail(where, "an invented prospect's name ends with '(example)' and carries no number or contact detail")
    if not isinstance(area, str) or not area.strip() or _DIGIT.search(area):
        raise _fail(where, "area must be a plain place word")
    why = _texts(raw["why"], f"{where}.why", need_te=True)
    return Example(name=name, area=area, why=why)


def _template(raw: Any, where: str) -> JobTemplate:
    if not isinstance(raw, dict):
        raise _fail(where, "a template is an object")
    allowed = {"id", "kind", "goal", "popular", "title", "benefit", "ask", "preview", "examples", "needs", "finds_out", "season"}
    if set(raw) - allowed or {"id", "kind", "goal", "popular", "title", "benefit", "ask", "needs", "finds_out"} - set(raw):
        raise _fail(where, f"keys are wrong: extra {sorted(set(raw) - allowed)}, missing {sorted({'id', 'kind', 'goal', 'popular', 'title', 'benefit', 'ask', 'needs', 'finds_out'} - set(raw))}")
    tid = raw["id"]
    if not isinstance(tid, str) or not _ID.match(tid):
        raise _fail(where, "id must be snake_case")
    where = f"{where}[{tid}]"
    kind, goal = raw["kind"], raw["goal"]
    if kind not in KINDS:
        raise _fail(where, f"kind {kind!r} is not one of {KINDS}")
    if goal not in GOALS:
        raise _fail(where, f"goal {goal!r} is not one of {GOALS}")
    if not isinstance(raw["popular"], bool):
        raise _fail(where, "popular is true or false")
    title = _texts(raw["title"], f"{where}.title", need_te=True)
    benefit = _texts(raw["benefit"], f"{where}.benefit", need_te=True)
    ask = _texts(raw["ask"], f"{where}.ask", need_te=True)
    for label, value in (("title", title), ("benefit", benefit), ("ask", ask)):
        for language, text in value.items():
            if _PLACEHOLDER.search(text) or "{" in text:
                raise _fail(f"{where}.{label}.{language}", "owner-facing lines carry no placeholders")
    needs = _closed(raw["needs"], NEEDS, f"{where}.needs")
    finds_out = _closed(raw["finds_out"], FINDS_OUT, f"{where}.finds_out")
    season = raw.get("season", "none")
    if season not in SEASONS:
        raise _fail(where, f"season {season!r} is not one of {SEASONS}")

    if kind == "researcher":
        if "preview" in raw:
            raise _fail(where, "a researcher template has no whatsapp or call preview: the owner reaches out personally")
        if goal != "find_new_customers" or finds_out or "whatsapp" in needs or "phone_number" in needs:
            raise _fail(where, "a researcher finds new customers, asks nothing and needs no number or WhatsApp")
        examples_raw = raw.get("examples")
        if not isinstance(examples_raw, list) or len(examples_raw) != EXAMPLES_PER_RESEARCHER:
            raise _fail(where, f"a researcher template carries exactly {EXAMPLES_PER_RESEARCHER} example prospects")
        examples = tuple(_example(e, f"{where}.examples[{i}]") for i, e in enumerate(examples_raw))
        if not _PROSPECT_PROMISE_EN.search(benefit["en"] + " " + ask["en"]) or "మీరే" not in benefit["te"] + ask["te"]:
            raise _fail(where, "a prospect-finding template must say 'you contact them yourself' (te: మీరే)")
        for label, value in (("title", title), ("benefit", benefit), ("ask", ask)):
            if re.search(r"\b(call|calls|message|messages|whatsapp)\s+(them|prospects)\b", value["en"], re.I) and "yourself" not in value["en"]:
                raise _fail(f"{where}.{label}", "a researcher never calls or messages prospects")
        return JobTemplate(tid, kind, goal, raw["popular"], title, benefit, ask, examples=examples, needs=needs, finds_out=finds_out, season=season)

    if goal == "find_new_customers":
        raise _fail(where, "only a researcher template has the goal find_new_customers")
    if "examples" in raw:
        raise _fail(where, "only a researcher template carries examples")
    preview = raw.get("preview")
    if not isinstance(preview, dict) or set(preview) - {"whatsapp", "call", "sample_audio"} or "sample_audio" not in preview or preview["sample_audio"] is not None:
        raise _fail(where, "preview is {whatsapp?, call?, sample_audio: null} (a voice sample id is added later)")
    if "whatsapp" not in preview and "call" not in preview:
        raise _fail(where, "preview shows a whatsapp bubble, a call snippet or both")
    whatsapp = _texts(preview["whatsapp"], f"{where}.preview.whatsapp", need_te=True, one_line=False) if "whatsapp" in preview else {}
    call = _texts(preview["call"], f"{where}.preview.call", need_te=True, one_line=False) if "call" in preview else {}
    if whatsapp:
        _customer_text(whatsapp, f"{where}.preview.whatsapp", goal)
        if any("{customer}" not in v for v in whatsapp.values()) and kind != "answer_calls":
            raise _fail(f"{where}.preview.whatsapp", "a message greets the customer by first name ({customer})")
        if "whatsapp" not in needs:
            raise _fail(where, "a template with a whatsapp bubble needs 'whatsapp'")
    if call:
        _customer_text(call, f"{where}.preview.call", goal)
        for language, snippet in call.items():
            lines = snippet.split("\n")
            if len(lines) != 2 or any(not line.strip() for line in lines):
                raise _fail(f"{where}.preview.call.{language}", "a call snippet is exactly two lines")
            if language == "en" and not lines[0].startswith(AI_LINE):
                raise _fail(f"{where}.preview.call.{language}", f"must start with {AI_LINE!r}: every call says it is an AI")
            if language == "te" and not _AI_TE.match(lines[0]):
                raise _fail(f"{where}.preview.call.{language}", "must start with the assistant's name, say {business} and AI in the first line")
        if "phone_number" not in needs:
            raise _fail(where, "a template with a call snippet needs 'phone_number'")
    return JobTemplate(tid, kind, goal, raw["popular"], title, benefit, ask, whatsapp=whatsapp, call=call, needs=needs, finds_out=finds_out, season=season)


def parse(pack_id: str, raw: Any) -> PackJobs:
    """The templates of a pack from the parsed file, or JobsPackError. Nothing is repaired: a rule broken anywhere refuses the whole file."""
    if not isinstance(raw, dict):
        raise _fail(pack_id, "the file is an object")
    if set(raw) - {"$comment", "status", "pack", "version", "templates"} or {"status", "pack", "version", "templates"} - set(raw):
        raise _fail(pack_id, "top-level keys are wrong")
    if raw["status"] != STATUS:
        raise _fail(pack_id, f"status must be {STATUS!r} until a native reader has checked the words")
    if raw["pack"] != pack_id:
        raise _fail(pack_id, f"the file says it belongs to {raw['pack']!r}")
    if not isinstance(raw["version"], int) or raw["version"] < 1:
        raise _fail(pack_id, "version is a whole number from 1")
    rows = raw["templates"]
    if not isinstance(rows, list) or not MIN_TEMPLATES <= len(rows) <= MAX_TEMPLATES:
        raise _fail(pack_id, f"{MIN_TEMPLATES} to {MAX_TEMPLATES} templates are needed")
    templates = tuple(_template(row, f"{pack_id}.templates[{i}]") for i, row in enumerate(rows))
    ids = [t.id for t in templates]
    if len(set(ids)) != len(ids):
        raise _fail(pack_id, "template ids repeat")
    popular = sum(1 for t in templates if t.popular)
    if not MIN_POPULAR <= popular <= MAX_POPULAR:
        raise _fail(pack_id, f"{MIN_POPULAR} or {MAX_POPULAR} templates are popular, not {popular}")
    if sum(1 for t in templates if t.kind == "researcher") > 1:
        raise _fail(pack_id, "one researcher template at most")
    return PackJobs(pack_id=pack_id, status=raw["status"], templates=templates)


def load_file(path: Path, pack_id: str) -> PackJobs:
    """Read and check one file; raises JobsPackError (also for a file that does not parse)."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise JobsPackError(f"{pack_id}: the file cannot be read ({type(exc).__name__})") from exc
    return parse(pack_id, raw)


@lru_cache(maxsize=64)
def _load(directory: str, pack_id: str) -> PackJobs | None:
    path = Path(directory) / pack_id / "jobs.json"
    if not path.is_file():
        return None
    try:
        return load_file(path, pack_id)
    except JobsPackError as exc:
        logger.error("a job templates file was refused: %s", exc)
        return None


def for_pack(pack_id: str | None, directory: Path | None = None) -> PackJobs | None:
    """The job templates of this business type, or None (no file, a file that broke a rule, or an id that is not a pack id)."""
    if not pack_id or not _PACK.match(pack_id):
        return None
    base = directory or default_directory()
    if base is None:
        return None
    return _load(str(base), pack_id)
