"""Lead-form templates (docs/contracts/commerce-notify.md section A): readers for what a form tool sends to a lead address, and the guide cards that explain each tool.

A reader turns a vendor's own envelope (Google Ads lead form, Typeform, Tally, Jotform, Webflow) into the flat body the intake already understands (name, phone, email, message, city, external_id and the
consent fields). It acts ONLY when the payload is unmistakably that vendor's envelope AND the switch is on (LEAD_FORM_TEMPLATES; `ENABLED` is set by wiring from the settings). With the switch off every body is
passed on untouched.

Consent. A tick is believed only with its evidence (LeadSourcesService.consent_evidence): the wording the person saw, and when they agreed. Each reader looks for ONE consent question: a yes/no or checkbox
question whose name (Typeform: the question's reference or title; Tally: the label; Webflow: the field name; Jotform: the unique name or label; Google Ads: the column) contains the word "consent". Its
wording is the question's own text, so the owner changes nothing the person sees. A payload without that question still becomes a lead, with no consent stored ("ask first").

TradeIndia sends lead e-mails, not a webhook; `tradeindia_mail` reads them by label (verify with a real mail: their format is not published).

The payload shapes are taken from the vendors' public documentation (cited in docs/contracts/commerce-notify.md); a field the documentation does not show is marked "verify" in data/form_templates.json.
Untrusted data: everything is only picked by key and cut to a length; nothing is evaluated or logged."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.lead_sources import portals

PATH = Path(__file__).parent / "data" / "form_templates.json"
PLACEHOLDER = "{ADDRESS}"
NOW = "{NOW}"
ENABLED = False   # set from LEAD_FORM_TEMPLATES at start (app/main.py); tests set it directly
_YES = frozenset({"1", "true", "yes", "y", "on", "checked", "agree", "agreed", "i agree"})
_MAX_PAIRS = 120


# ------------------------------------------------------------------------------------------------------------- the readers
def _text(value: Any, size: int = 400) -> str:
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    return " ".join(value.split())[:size] if isinstance(value, str) else ""


def _truthy(value: Any) -> bool:
    if value is True:
        return True
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value == 1
    if isinstance(value, str):
        return value.strip().lower() in _YES
    if isinstance(value, list):
        return any(_truthy(v) or (isinstance(v, str) and v.strip()) for v in value)
    return False


class _Row:
    """The flat body being built: the first value of each field wins, extra answers become the message."""

    def __init__(self) -> None:
        self.out: dict[str, Any] = {}
        self.extra: list[str] = []

    def put(self, field: str, value: Any) -> None:
        text = _text(value)
        if text and field not in self.out:
            self.out[field] = text

    def note(self, label: str, value: Any) -> None:
        text = _text(value, 200)
        if text and len(self.extra) < 12:
            self.extra.append(f"{_text(label, 60)}: {text}" if label else text)

    def consent(self, ticked: bool, wording: str, at: str | None, form: str | None) -> None:
        if ticked and "consent" not in self.out:
            self.out["consent"] = "yes"
            if wording:
                self.out["consent_text"] = wording[:800]
            self.out["consent_at"] = at or datetime.now(UTC).isoformat()
            if form:
                self.out["consent_form"] = form[:80]

    def done(self, external_id: Any = None) -> dict[str, Any]:
        out = dict(self.out)
        if external_id:
            out["external_id"] = _text(external_id, 120)
        message = " | ".join(self.extra)
        if message:
            out["message"] = (out["message"] + " | " + message) if out.get("message") else message
        return out


def _by_label(row: _Row, label: str, value: Any, shown: str | None = None) -> None:
    """A text answer put where its question's name says: name, city, message; anything else is kept in the message with its question (`shown`, else the label)."""
    low = label.lower()
    shown = shown or label
    if re.search(r"\b(company|business|organi[sz]ation)\b", low) or "last name" in low:
        row.note(shown, value)
    elif "name" in low:
        row.put("name", value)
    elif "city" in low or "town" in low or "location" in low:
        row.put("city", value)
    elif re.search(r"message|requirement|enquiry|inquiry|query|comment|need|looking", low):
        row.put("message", value)
    else:
        row.note(shown, value)


def _google_ads(data: dict[str, Any]) -> dict[str, Any] | None:
    columns = data.get("user_column_data")
    if not (isinstance(data.get("lead_id"), str) and isinstance(columns, list)):
        return None
    row, first, last = _Row(), "", ""
    ticked, wording = False, ""
    for item in columns[:_MAX_PAIRS]:
        if not isinstance(item, dict):
            continue
        cid, label, value = str(item.get("column_id") or "").upper(), _text(item.get("column_name"), 200), item.get("string_value")
        if cid in ("FULL_NAME",):
            row.put("name", value)
        elif cid == "FIRST_NAME":
            first = _text(value, 100)
        elif cid == "LAST_NAME":
            last = _text(value, 100)
        elif cid in ("PHONE_NUMBER", "WORK_PHONE"):
            row.put("phone", value)
        elif cid in ("EMAIL", "WORK_EMAIL"):
            row.put("email", value)
        elif cid in ("CITY",):
            row.put("city", value)
        elif "CONSENT" in cid or "consent" in label.lower():   # a custom question of the form; its wording is the column's name when Google sends it (deprecated field: verify)
            ticked, wording = _truthy(value), label
        elif cid in ("PHONE_NUMBER_VERIFIED",):
            continue
        else:
            row.note(label or cid.title().replace("_", " "), value)
    if first or last:
        row.put("name", f"{first} {last}".strip())
    when = _text(data.get("lead_submit_time"), 40) or None
    row.consent(ticked, wording, when, f"Google Ads form {_text(data.get('form_id'), 30)}".strip() if data.get("form_id") else None)
    if data.get("is_test") is True:
        row.out.setdefault("message", "Test lead from Google Ads")
    return row.done(data.get("lead_id"))


def _typeform(data: dict[str, Any]) -> dict[str, Any] | None:
    resp = data.get("form_response")
    if data.get("event_type") != "form_response" or not isinstance(resp, dict) or not isinstance(resp.get("answers"), list):
        return None
    definition: dict[str, Any] = resp["definition"] if isinstance(resp.get("definition"), dict) else {}
    titles = {str(f.get("id")): _text(f.get("title"), 800) for f in (definition.get("fields") or []) if isinstance(f, dict)}
    row, ticked, wording = _Row(), False, ""
    for ans in resp["answers"][:_MAX_PAIRS]:
        if not isinstance(ans, dict):
            continue
        field: dict[str, Any] = ans["field"] if isinstance(ans.get("field"), dict) else {}
        ref, title = str(field.get("ref") or "").lower(), titles.get(str(field.get("id")), "")
        kind = str(ans.get("type") or "")
        label = title or ref
        if "consent" in ref or "consent" in title.lower():
            ticked, wording = _truthy(ans.get(kind)), title
        elif kind == "phone_number":
            row.put("phone", ans.get("phone_number"))
        elif kind == "email":
            row.put("email", ans.get("email"))
        elif kind == "text":
            _by_label(row, f"{ref.replace('_', ' ')} {title}", ans.get("text"), label.replace("_", " "))
        elif kind == "choice" and isinstance(ans.get("choice"), dict):
            row.note(label, ans["choice"].get("label") or ans["choice"].get("other"))
        elif kind == "choices" and isinstance(ans.get("choices"), dict):
            row.note(label, ", ".join(str(x) for x in (ans["choices"].get("labels") or [])[:5]))
        elif kind in ("number", "date", "url"):
            row.note(label, ans.get(kind))
    row.consent(ticked, wording, _text(resp.get("submitted_at"), 40) or None, _text(definition.get("title"), 80) or None)
    return row.done(resp.get("token"))


def _tally(data: dict[str, Any]) -> dict[str, Any] | None:
    body = data.get("data")
    if data.get("eventType") != "FORM_RESPONSE" or not isinstance(body, dict) or not isinstance(body.get("fields"), list):
        return None
    row, ticked, wording = _Row(), False, ""
    for field in body["fields"][:_MAX_PAIRS]:
        if not isinstance(field, dict):
            continue
        kind, label, value = str(field.get("type") or ""), _text(field.get("label"), 800), field.get("value")
        if kind in ("HIDDEN_FIELDS", "CALCULATED_FIELDS"):
            continue
        if "consent" in label.lower():
            if isinstance(value, list) and value:   # the question itself: the chosen options' text is what the person ticked
                texts = [_text(o.get("text"), 400) for o in (field.get("options") or []) if isinstance(o, dict) and o.get("id") in value]
                ticked, wording = True, " ".join(t for t in texts if t) or label
            elif value is True and "(" in label and not ticked:   # the per-option entry "Question (option text)"
                ticked, wording = True, label[label.index("(") + 1 : label.rindex(")")] if ")" in label else label
            continue
        if kind == "INPUT_PHONE_NUMBER":
            row.put("phone", value)
        elif kind == "INPUT_EMAIL":
            row.put("email", value)
        elif kind == "INPUT_TEXT":
            _by_label(row, label, value)
        elif kind == "TEXTAREA":
            row.put("message", value)
        elif kind in ("MULTIPLE_CHOICE", "DROPDOWN", "INPUT_NUMBER", "INPUT_DATE", "INPUT_LINK"):
            row.note(label, value if not isinstance(value, list) else ", ".join(str(v) for v in value[:3]))
    row.consent(ticked, wording, _text(body.get("createdAt") or data.get("createdAt"), 40) or None, _text(body.get("formName"), 80) or None)
    return row.done(body.get("responseId"))


def _jotform(data: dict[str, Any]) -> dict[str, Any] | None:
    raw = data.get("rawRequest")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return None
    if not isinstance(raw, dict):
        return None
    row, ticked, wording = _Row(), False, ""
    for key, value in list(raw.items())[:_MAX_PAIRS]:
        m = re.fullmatch(r"q\d+_(.+)", str(key))
        if not m:
            continue
        unique = m.group(1)
        low = unique.lower()
        flat = _jot_text(value)
        if "consent" in low:
            ticked, wording = _truthy(value), flat
        elif isinstance(value, dict) and "first" in value:
            row.put("name", f"{_text(value.get('first'), 100)} {_text(value.get('last'), 100)}".strip())
        elif "phone" in low or "mobile" in low or "whatsapp" in low:
            row.put("phone", flat)
        elif "email" in low or "mail" in low:
            row.put("email", flat)
        else:
            _by_label(row, re.sub(r"(?<=[a-z])(?=[A-Z])", " ", unique), flat)
    row.consent(ticked, wording, None, _text(data.get("formTitle") or data.get("formID"), 80) or None)
    return row.done(data.get("submissionID") or data.get("submission_id"))


def _jot_text(value: Any) -> str:
    """A Jotform answer is a text, a list of chosen options, or an object (a name has first and last; a phone has full, or area and phone)."""
    if isinstance(value, dict):
        if "full" in value:
            return _text(value.get("full"))
        if "area" in value or "phone" in value:
            return " ".join(x for x in (_text(value.get("area")), _text(value.get("phone"))) if x)
        return " ".join(_text(v) for v in value.values() if _text(v))
    if isinstance(value, list):
        return ", ".join(_text(v) for v in value[:5] if _text(v))
    return _text(value)


def _webflow(data: dict[str, Any]) -> dict[str, Any] | None:
    payload = data.get("payload")
    if data.get("triggerType") != "form_submission" or not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
        return None
    fields = {str(k): v for k, v in list(payload["data"].items())[:_MAX_PAIRS]}
    row, ticked, wording = _Row(), False, ""
    given_text = next((_text(v, 800) for k, v in fields.items() if k.lower().replace(" ", "_") == "consent_text"), "")
    for name, value in fields.items():
        low = name.lower()
        if low.replace(" ", "_") == "consent_text":
            continue
        if "consent" in low:
            ticked = _truthy(value)
            wording = given_text or (name if 10 <= len(name) else "")   # a checkbox named with its own wording is the wording; else a hidden field "consent_text" holds it
        elif "phone" in low or "mobile" in low or "whatsapp" in low:
            row.put("phone", value)
        elif "email" in low or "e-mail" in low:
            row.put("email", value)
        else:
            _by_label(row, name, value)
    row.consent(ticked, wording, _text(payload.get("submittedAt"), 40) or None, _text(payload.get("name"), 80) or None)
    return row.done(payload.get("id"))


def _first_last(data: dict[str, Any]) -> dict[str, Any] | None:
    """A flat body from Zapier or Make (LinkedIn Lead Gen and others) that carries a first and a last name but no `name`: they are joined."""
    low = {str(k).lower(): v for k, v in data.items() if isinstance(k, str)}
    if any(low.get(k) for k in ("name", "full_name", "fullname", "customer_name", "your_name")) or not (low.get("first_name") and low.get("last_name")):
        return None
    out = dict(data)
    out["name"] = f"{_text(low['first_name'], 100)} {_text(low['last_name'], 100)}".strip()
    return out


READERS = (_google_ads, _typeform, _tally, _jotform, _webflow, _first_last)


def flatten(data: dict[str, Any]) -> dict[str, Any]:
    """The flat body for a vendor's envelope; the body itself when the switch is off or the payload is nobody's envelope."""
    if not ENABLED or not isinstance(data, dict):
        return data
    for reader in READERS:
        try:
            got = reader(data)
        except (TypeError, ValueError, AttributeError, KeyError):   # a shape we did not expect: the body goes on as it came (and is probably refused as a bot or an empty row)
            got = None
        if got is not None:
            if data.get("_hp"):
                got["_hp"] = data["_hp"]
            return got
    return data


# ------------------------------------------------------------------------------------------------------------- Jotform's multipart body
def parse_multipart(content_type: str, raw: bytes) -> dict[str, str] | None:
    """The text parts of a multipart/form-data body, by name (Jotform's webhook posts this: its submission is in the `rawRequest` part as JSON). Files are ignored. None when it is not a readable multipart body."""
    if not content_type.lower().startswith("multipart/form-data") or "boundary=" not in content_type.lower():
        return None
    try:
        message = BytesParser(policy=policy.default).parsebytes(b"Content-Type: " + content_type.encode("latin-1", "ignore") + b"\r\nMIME-Version: 1.0\r\n\r\n" + raw)
    except (ValueError, UnicodeError):
        return None
    out: dict[str, str] = {}
    if not message.is_multipart():
        return None
    for part in list(message.iter_parts())[:_MAX_PAIRS]:
        name = part.get_param("name", header="content-disposition")
        if not isinstance(name, str) or part.get_filename():
            continue
        payload = part.get_payload(decode=True)
        if isinstance(payload, bytes) and len(payload) <= 100_000:
            out[name] = payload.decode(part.get_content_charset() or "utf-8", "replace")
    return out


# ------------------------------------------------------------------------------------------------------------- TradeIndia lead e-mails
_TI_LABELS: dict[str, tuple[str, ...]] = {
    "name": ("buyer name", "contact person", "contact name", "name", "sender name", "customer name"),
    "phone": ("mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact no", "contact number", "whatsapp"),
    "email": ("email", "e mail", "email id", "email address", "buyer email"),
    "city": ("city", "location", "buyer location", "state"),
    "message": ("product", "product name", "product requirement", "requirement", "requirement details", "looking for", "inquiry", "enquiry", "message", "description", "quantity"),
}
_PAIR = re.compile(r"^\s*([A-Za-z][A-Za-z0-9 .()/_&'-]{1,40}?)\s*[:：=]\s*(.*?)\s*$")
_PHONE = re.compile(r"\+?[0-9][0-9 ().-]{6,20}[0-9]")
_EMAIL = re.compile(r"[^\s@,;|<>()\[\]]+@[^\s@,;|<>()\[\]]+\.[^\s@,;|<>()\[\]]+")


def _sender_is(sender: str | None, domain: str) -> bool:
    """The mail's From address is on `domain` or one of its sub-domains (the host is compared whole, never searched for inside the text: code scanning py/incomplete-url-substring-sanitization)."""
    address = parseaddr(sender or "")[1].lower()
    host = address.rpartition("@")[2] if "@" in address else ""
    return host == domain or host.endswith("." + domain)


def tradeindia_mail(sender: str, subject: str, body: str) -> portals.Parsed | None:
    """One lead from a TradeIndia mail (sender tradeindia.com, or the name in the subject), read by its `Label: value` lines; None when it is not one or has neither a number nor an address.
    Written from the usual lead-mail labels, NOT from a real TradeIndia mail (their format is not published): verify with a real mail."""
    head = f"{subject}\n{(body or '')[:600]}".lower()
    if not ENABLED or not (_sender_is(sender, "tradeindia.com") or "tradeindia" in head):
        return None
    wanted = {re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", n.lower())).strip(): f for f, names in _TI_LABELS.items() for n in names}
    found: dict[str, list[str]] = {}
    for line in portals.unwrap(body or "").splitlines()[:300]:
        m = _PAIR.match(line)
        if not m:
            continue
        field = wanted.get(re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", m.group(1).lower())).strip())
        if field and m.group(2).strip():
            found.setdefault(field, []).append(m.group(2).strip())
    row: dict[str, Any] = {}
    phone = _PHONE.search(found.get("phone", [""])[0]) if found.get("phone") else None
    mail = _EMAIL.search(found.get("email", [""])[0]) if found.get("email") else None
    if phone:
        row["phone"] = phone.group(0).strip()[:32]
    if mail:
        row["email"] = mail.group(0)[:254]
    if not row:
        return None
    for field, size in (("name", 200), ("city", 100)):
        if found.get(field):
            row[field] = re.sub(r"\s+", " ", found[field][0])[:size]
    message = " | ".join(re.sub(r"\s+", " ", v) for v in found.get("message", [])[:4]) or re.sub(r"\s+", " ", subject or "").strip()
    if message:
        row["message"] = message[:1000]
    return portals.Parsed("tradeindia", row)


# ------------------------------------------------------------------------------------------------------------- the cards (data/form_templates.json)
@lru_cache(maxsize=1)
def _doc() -> dict[str, Any]:
    raw = json.loads(PATH.read_text(encoding="utf-8"))
    return raw if isinstance(raw, dict) else {}


def listing() -> list[dict[str, str]]:
    return [{"id": t["id"], "name": t["name"], "group": t["group"], "channel": t["channel"]} for t in _doc().get("templates", [])]


def template(template_id: str, address_url: str, *, now: datetime | None = None) -> dict[str, Any] | None:
    """One template with the address written in and a fresh time in the sample's consent line (so a sample is never older than the 30 days the intake accepts)."""
    stamp = (now or datetime.now(UTC)).isoformat()
    for t in _doc().get("templates", []):
        if t["id"] == template_id:
            text = json.dumps(t, ensure_ascii=False)
            text = text.replace(PLACEHOLDER, address_url.replace("\\", "\\\\").replace('"', '\\"')).replace(NOW, stamp)
            out: dict[str, Any] = json.loads(text)
            return out
    return None


def note() -> str:
    return str(_doc().get("note", ""))


def wire_body(t: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """What the vendor really sends for a template's sample: (content kind, body). Jotform sends its answers as JSON inside the `rawRequest` part of a multipart form."""
    sample = dict(t["sample"])
    if t["channel"] == "multipart":
        sample["rawRequest"] = json.dumps(sample["rawRequest"], ensure_ascii=False)
        return "multipart", sample
    return "json", sample
