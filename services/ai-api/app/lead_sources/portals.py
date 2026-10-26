"""Lead e-mails of the property and business portals (job DR / A2): IndiaMART, JustDial, 99acres, MagicBricks, Housing. A portal mails the business "a buyer is interested", with the buyer's name, number,
address and what they want as `Label: value` lines. The parsers read those lines by label, in any order, from the mail or from the same mail forwarded (the forwarding headers are skipped).

These parsers are written from the portals' typical lead mails, NOT from real samples: the labels below are the usual ones and may differ. A mail that yields neither a number nor an address is NOT
guessed at: the caller keeps it in the unparsed list. The mail's text is untrusted data: it is only ever split into labelled values and cut."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_EMAIL = re.compile(r"[^\s@,;|<>()\[\]]+@[^\s@,;|<>()\[\]]+\.[^\s@,;|<>()\[\]]+")
_PHONE = re.compile(r"\+?[0-9][0-9 ().-]{6,20}[0-9]")
_PAIR = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 .()/_&'-]{1,40}?)\s*[:：=]\s*(.*?)\s*$")
_FORWARD_HEADER = re.compile(r"^\s*(?:-{2,}\s*Forwarded message\s*-{2,}|Begin forwarded message:?|From|Sent|Date|To|Cc|Subject)\s*:?.*$", re.I)

# portal -> (sender domains, words that name it in a subject or body)
PORTALS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "indiamart": (("indiamart.com",), ("indiamart", "buyer enquiry", "buy lead")),
    "justdial": (("justdial.com", "jd.com"), ("justdial", "just dial", "jd lead")),
    "99acres": (("99acres.com",), ("99acres",)),
    "magicbricks": (("magicbricks.com",), ("magicbricks", "magic bricks")),
    "housing": (("housing.com",), ("housing.com", "housing lead")),
}

_LABELS: dict[str, tuple[str, ...]] = {
    "name": ("name", "buyer name", "sender name", "contact name", "contact person", "customer name", "lead name", "client name", "enquirer", "full name"),
    "phone": ("mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact no", "contact number", "contact mobile", "contact phone", "cell", "whatsapp", "customer mobile", "mob"),
    "email": ("email", "e mail", "email id", "email address", "contact email", "sender email", "mail"),
    "city": ("city", "location", "area", "locality", "address", "sender city", "buyer location"),
    "message": ("requirement", "requirements", "message", "enquiry", "inquiry", "query", "looking for", "interested in", "product", "property details", "comments", "remarks", "description", "buyer requirement"),
}
_PER_PORTAL_EXTRA: dict[str, dict[str, tuple[str, ...]]] = {
    "indiamart": {"message": ("enquiry for", "product name", "requirement details")},
    "justdial": {"message": ("category", "service required", "services")},
    "99acres": {"message": ("property", "property id", "response message")},
    "magicbricks": {"message": ("property", "enquiry message")},
    "housing": {"message": ("project", "property", "lead message")},
}


@dataclass(frozen=True)
class Parsed:
    portal: str | None
    row: dict[str, Any]


def _norm(label: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", label.lower())).strip()


def unwrap(text: str) -> str:
    """The body of a forwarded mail without the quote marks and the forwarding headers."""
    lines: list[str] = []
    for raw in text.splitlines():
        line = re.sub(r"^(?:\s*>)+\s?", "", raw)
        if _FORWARD_HEADER.match(line) and len(lines) < 12:
            continue
        lines.append(line)
    return "\n".join(lines)


def detect(sender: str, subject: str, body: str) -> str | None:
    s = (sender or "").lower()
    for portal, (domains, _words) in PORTALS.items():
        if any(d in s for d in domains):
            return portal
    head = f"{subject}\n{body[:600]}".lower()
    for portal, (_d, words) in PORTALS.items():
        if any(w in head for w in words):
            return portal
    return None


def _all_labels() -> set[str]:
    names = {_norm(n) for v in _LABELS.values() for n in v}
    names |= {_norm(n) for extra in _PER_PORTAL_EXTRA.values() for v in extra.values() for n in v}
    return names


def _pairs(body: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    lines = body.splitlines()
    known = _all_labels()
    for i, line in enumerate(lines[:400]):
        m = _PAIR.match(line)
        if not m and _norm(line) in known:   # a table: the label on one line, its value on the next
            m = re.match(r"^\s*(.+?)\s*$", line)
            if m:
                m = re.match(r"^(.*?)()$", m.group(1))
        if not m:
            continue
        label, value = _norm(m.group(1)), m.group(2).strip()
        if not value:   # the value is on the next non-empty line
            for nxt in lines[i + 1 : i + 3]:
                if nxt.strip() and not _PAIR.match(nxt):
                    value = nxt.strip()
                    break
        if label and value:
            out.append((label, value))
    return out


def parse_mail(sender: str, subject: str, body: str, hint: str | None = None) -> Parsed | None:
    """One lead from one mail, or None when the mail has neither a number nor an address in a labelled line."""
    text = unwrap(body or "")
    portal = detect(sender or "", subject or "", text) or hint
    labels = {k: set(map(_norm, v)) for k, v in _LABELS.items()}
    for k, extra in _PER_PORTAL_EXTRA.get(portal or "", {}).items():
        labels[k] |= set(map(_norm, extra))
    found: dict[str, str] = {}
    for label, value in _pairs(text):
        for field, names in labels.items():
            if label in names and field not in found:
                found[field] = value
    row: dict[str, Any] = {}
    phone_m = _PHONE.search(found.get("phone", "")) if found.get("phone") else None
    email_m = _EMAIL.search(found.get("email", "")) if found.get("email") else None
    if phone_m:
        row["phone"] = phone_m.group(0).strip()[:32]
    if email_m:
        row["email"] = email_m.group(0)[:254]
    if not row:
        return None
    if found.get("name"):
        row["name"] = re.sub(r"\s+", " ", found["name"])[:200]
    if found.get("city"):
        row["city"] = re.sub(r"\s+", " ", found["city"])[:100]
    message = " ".join(v for v in (found.get("message"),) if v)
    subj = re.sub(r"\s+", " ", subject or "").strip()
    if not message and subj:
        message = subj
    if message:
        row["message"] = re.sub(r"\s+", " ", message)[:1000]
    return Parsed(portal, row)
