"""What a file dropped in the chat IS (job assistant-does-the-work A2b; owner, 5 Nov 2026: "the assistant reads ANY attached file, understands it, and then does what the owner asks").

The understanding is made by CODE from what the extraction step read (app/assistant_work/extract.py) or from the sheet, vCard or text itself: its kind (a guess, by words and shape), its tables, the
people in it, the amounts and the dates, and the text, bounded. Nothing here calls a model. It is kept for the chat's next turns under the same 24 h rule as the file (as a small JSON file in
assistant_files), and it is DATA: a planner that reads it gets it between delimiters, never as instructions."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from app.assistant_work import extract

Kind = Literal["lead_list", "visiting_card", "price_list", "enquiry", "order", "brochure", "other"]
MAX_TEXT = 60_000          # kept (About my business takes up to 60,000 characters)
MAX_PLANNER_TEXT = 12_000  # what a planner reads of it
MAX_TABLE_ROWS = 60
MAX_TABLES = 3

_PRICE_HEAD = re.compile(r"(?i)\b(price|rate|mrp|cost|amount|₹|rs\.?)\b|ధర|कीमत|दाम|ಬೆಲೆ")
_ITEM_HEAD = re.compile(r"(?i)\b(item|product|description|particulars|sku|design|code|article)\b")
_QTY_HEAD = re.compile(r"(?i)\b(qty|quantity|pcs|pieces|nos|units)\b")
_ORDER = re.compile(r"(?i)\b(purchase order|p\.?\s?o\.?\s*(no|number|#)|order no|order form|delivery date|please supply|kindly supply|we are pleased to place)\b")
_ENQUIRY = re.compile(r"(?i)\b(enquiry|inquiry|requirement|please quote|kindly quote|send (us )?(your )?(best )?(price|rates|quotation)|request for quotation|rfq|we need|we require|interested in)\b|కావాలి|ధర చెప్పండి|चाहिए|भाव बताइए|ಬೇಕು")
_BROCHURE = re.compile(r"(?i)\b(about us|our (company|story|collection|products|services)|since \d{4}|established|we (are|offer|specialise|specialize)|visit our|showroom|terms and conditions|faq|policy)\b")
_AMOUNT = re.compile(r"(?:₹|rs\.?|inr)\s?\d[\d,]*(?:\.\d{1,2})?|\b\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?\b|\b\d+(?:\.\d{1,2})?\s?(?:/-|rupees)", re.IGNORECASE)
_DATE = re.compile(r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s\d{2,4}\b", re.IGNORECASE)


@dataclass
class Understanding:
    file_name: str
    read_by: str                      # file | local_ocr | ai
    kind: Kind
    text: str
    tables: list[list[list[str]]] = field(default_factory=list)
    people: list[list[str]] = field(default_factory=list)   # header first (Name, Company, Phone, Email), or empty
    amounts: list[str] = field(default_factory=list)
    dates: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> Understanding:
        return Understanding(file_name=str(d.get("file_name") or "file"), read_by=str(d.get("read_by") or "file"), kind=d.get("kind") or "other", text=str(d.get("text") or ""),
                             tables=list(d.get("tables") or []), people=list(d.get("people") or []), amounts=list(d.get("amounts") or []), dates=list(d.get("dates") or []))

    def data_lines(self) -> list[str]:
        """The understanding as plain lines for a planner (DATA, between delimiters)."""
        lines = [f"file: {self.file_name}", f"looks like: {self.kind}", f"read by: {self.read_by}"]
        if self.people:
            lines.append(f"people found: {max(0, len(self.people) - 1)}")
        for n, table in enumerate(self.tables, start=1):
            lines.append(f"table {n} ({max(0, len(table) - 1)} rows):")
            lines.extend(" | ".join(cell for cell in row) for row in table[: MAX_TABLE_ROWS + 1])
        if self.amounts:
            lines.append("amounts: " + "; ".join(self.amounts[:30]))
        if self.dates:
            lines.append("dates: " + "; ".join(self.dates[:20]))
        lines.append("text:")
        lines.extend(self.text[:MAX_PLANNER_TEXT].splitlines())
        return lines

    def numbers(self) -> set[str]:
        """Every run of digits in the file as read (a planner's numbers are checked against these)."""
        blob = self.text + "\n" + "\n".join(" ".join(r) for t in self.tables for r in t) + "\n" + "\n".join(" ".join(r) for r in self.people)
        return digit_runs(blob)


def digit_runs(text: str) -> set[str]:
    return {re.sub(r"[,\s]", "", m) for m in re.findall(r"\d[\d,]*(?:\.\d+)?", text)}


def _has(header: list[str], rx: re.Pattern[str]) -> bool:
    return any(rx.search(h or "") for h in header)


def guess_kind(text: str, tables: list[list[list[str]]], people: list[list[str]]) -> Kind:
    """By code, in this order: an order, an enquiry, a price list, people, a brochure. A guess: the planner and the person can see past it."""
    head = text[:3000]
    priced = next((t for t in tables if t and _has(t[0], _PRICE_HEAD) and _has(t[0], _ITEM_HEAD)), None)
    if _ORDER.search(head) and (priced is not None or any(t and _has(t[0], _QTY_HEAD) for t in tables)):
        return "order"
    if _ENQUIRY.search(head) and len(people) <= 2:
        return "enquiry"
    if priced is not None and not any(_has(t[0], re.compile(r"(?i)phone|mobile|e-?mail")) for t in tables if t):
        return "price_list"
    if len(people) == 2 and len(text.splitlines()) <= 30:
        return "visiting_card"
    if len(people) > 2:
        return "lead_list"
    if _ENQUIRY.search(text[:20000]):
        return "enquiry"
    if _BROCHURE.search(text[:20000]) or len(text) > 600:
        return "brochure"
    return "other"


def understand(file_name: str, read_by: str, text: str, tables: list[list[list[str]]], people: list[list[str]] | None = None) -> Understanding:
    tables = [[[str(c)[:200] for c in row] for row in t[: MAX_TABLE_ROWS + 1]] for t in tables[:MAX_TABLES]]
    if people is None:
        found = sorted((t for t in tables if any(extract.phones_in(" ".join(r)) or "@" in " ".join(r) for r in t[1:])), key=len, reverse=True)
        people = found[0] if found else extract.people_of_text(text)
    body = text[:MAX_TEXT]
    return Understanding(file_name=file_name, read_by=read_by, kind=guess_kind(body, tables, people), text=body, tables=tables, people=people[: 5001],
                         amounts=list(dict.fromkeys(m.strip() for m in _AMOUNT.findall(body)))[:30], dates=list(dict.fromkeys(_DATE.findall(body)))[:20])
