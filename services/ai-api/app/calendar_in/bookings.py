"""What a vendor's booking message says, read into one shape, and the vendors' own signature checks.

Calendly (https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures): header `Calendly-Webhook-Signature: t=<unix seconds>,v1=<hex>`, v1 = HMAC-SHA256 (hex) of `<t>.<raw body>` with the
subscription's signing key. Body: {"event": "invitee.created" | "invitee.canceled", "created_at", "payload": <the invitee: uri, email, name, first_name, last_name, status, questions_and_answers,
text_reminder_number, rescheduled, old_invitee, new_invitee, scheduled_event {name, start_time, end_time}>} (the invitee's fields: https://developer.calendly.com/api-docs/calendly-api/scheduled-events/get-event-invitee;
that the webhook's `payload.scheduled_event` carries name, start_time and end_time is read from third-party documentation: verify with a real account).

Cal.com (source of the sender, calcom/cal.com packages/features/webhooks/lib/sendPayload.ts; docs https://cal.com/docs/developing/guides/automation/webhooks): header `X-Cal-Signature-256` = HMAC-SHA256 (hex)
of the raw body with the webhook's secret (no timestamp: replays are made harmless by the booking id). Body {"triggerEvent": "BOOKING_CREATED" | "BOOKING_CANCELLED" | "BOOKING_RESCHEDULED" ..., "createdAt",
"payload": {uid, title, startTime, endTime, attendees [{name, email, timeZone}], responses, smsReminderNumber, rescheduleUid, status ...}}. The name of the phone field in `responses` is
`attendeePhoneNumber` in current Cal.com; verify with a real account.

Nothing here logs: a body, a name, a number or an address never leaves these functions except into the returned Booking."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import re
from dataclasses import dataclass, field
from typing import Any

from app.lead_sources.phones import check_phone

_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)   # a cancellation that carries no time
CALENDLY_TOLERANCE_S = 300   # the vendor's own example uses 3 minutes
_EMAIL = re.compile(r"[^\s@,;<>()\[\]]{1,64}@[^\s@,;<>()\[\]]{1,200}\.[A-Za-z]{2,24}")
_PHONE_QUESTION = re.compile(r"phone|mobile|whatsapp|contact number|cell", re.I)
_NO = frozenset({"no", "n", "false", "0", "off", "none"})


@dataclass(frozen=True)
class Booking:
    kind: str                     # calendly | calcom
    action: str                   # created | cancelled
    external_id: str
    starts_at: dt.datetime
    ends_at: dt.datetime
    name: str | None = None
    email: str | None = None
    phone: str | None = None      # the stored form (+91...), or None
    purpose: str | None = None
    replaces: str | None = None   # the booking id this one moved from (a reschedule)
    consent_text: str | None = None
    consent_at: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __repr__(self) -> str:   # never the person
        return f"Booking({self.kind}, {self.action})"


def _time(raw: Any) -> dt.datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        value = dt.datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return value if value.tzinfo is not None else None


def _text(raw: Any, size: int) -> str | None:
    if not isinstance(raw, str):
        return None
    cleaned = " ".join(raw.split())[:size]
    return cleaned or None


def _phone(raw: Any) -> str | None:
    return check_phone(raw).stored if isinstance(raw, str) else None


def _email(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    m = _EMAIL.fullmatch(raw.strip())
    return m.group(0)[:254] if m else None


# ---------------------------------------------------------------------------------------------------------------- signatures
def verify_calendly(raw: bytes, header: str | None, signing_key: str, *, now: float, tolerance_s: int = CALENDLY_TOLERANCE_S) -> bool:
    if not header or not signing_key or len(header) > 300:
        return False
    parts: dict[str, str] = {}
    for item in header.split(","):
        key, _, value = item.strip().partition("=")
        if key and key not in parts:
            parts[key] = value
    stamp, sig = parts.get("t", ""), parts.get("v1", "")
    if not stamp.isdigit() or not re.fullmatch(r"[0-9a-f]{64}", sig):
        return False
    if abs(now - int(stamp)) > tolerance_s:
        return False
    want = hmac.new(signing_key.encode("utf-8"), stamp.encode("ascii") + b"." + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)


def verify_calcom(raw: bytes, header: str | None, secret: str) -> bool:
    if not header or not secret or not re.fullmatch(r"[0-9a-f]{64}", header.strip()):
        return False
    want = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, header.strip())


# ---------------------------------------------------------------------------------------------------------------- the messages
def _consent_from(answer: str | None, question: str | None, given_at: str | None) -> tuple[str | None, str | None]:
    """The owner mapped ONE question of their booking form as the consent question. A non-empty answer that is not a no is the consent: its wording is the question the person saw."""
    if not question or not answer or answer.strip().lower() in _NO:
        return None, None
    if not 10 <= len(question) <= 800:
        return None, None
    return question, given_at


def read_calendly(body: Any, consent_question: str | None = None) -> Booking | None:
    if not isinstance(body, dict) or not isinstance(body.get("payload"), dict):
        return None
    event, p = body.get("event"), body["payload"]
    uri = p.get("uri")
    if event not in ("invitee.created", "invitee.canceled") or not isinstance(uri, str) or not re.fullmatch(r"[!-~]{1,255}", uri):
        return None
    sched = p.get("scheduled_event") if isinstance(p.get("scheduled_event"), dict) else {}
    starts, ends = _time(sched.get("start_time")), _time(sched.get("end_time"))
    if event == "invitee.canceled":
        return Booking("calendly", "cancelled", uri, starts or _EPOCH, ends or _EPOCH + dt.timedelta(seconds=1))
    if starts is None or ends is None or ends <= starts:
        return None
    qa = [x for x in (p.get("questions_and_answers") or []) if isinstance(x, dict)]
    phone = _phone(p.get("text_reminder_number"))
    consent_answer = None
    for item in qa:
        q, a = _text(item.get("question"), 800), _text(item.get("answer"), 200)
        if phone is None and q and a and _PHONE_QUESTION.search(q):
            phone = _phone(a)
        if consent_question and q and a and q.lower() == consent_question.strip().lower():
            consent_answer = (q, a)
    name = _text(p.get("name"), 200) or _text(" ".join(x for x in (p.get("first_name"), p.get("last_name")) if isinstance(x, str)), 200)
    consent_text, consent_at = _consent_from(consent_answer[1] if consent_answer else None, consent_answer[0] if consent_answer else None, _text(body.get("created_at"), 40))
    old = p.get("old_invitee")
    return Booking("calendly", "created", uri, starts, ends, name, _email(p.get("email")), phone, _text(sched.get("name"), 200),
                   old if isinstance(old, str) and re.fullmatch(r"[!-~]{1,255}", old) else None, consent_text, consent_at)


def _calcom_response(responses: Any, *keys: str) -> Any:
    if not isinstance(responses, dict):
        return None
    for k in keys:
        v = responses.get(k)
        if isinstance(v, dict):
            v = v.get("value")
        if isinstance(v, (str, int)) and not isinstance(v, bool) and str(v).strip():
            return str(v)
    return None


def read_calcom(body: Any, consent_question: str | None = None) -> Booking | None:
    if not isinstance(body, dict) or not isinstance(body.get("payload"), dict):
        return None
    trigger, p = body.get("triggerEvent"), body["payload"]
    uid = p.get("uid")
    if trigger not in ("BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED") or not isinstance(uid, str) or not re.fullmatch(r"[!-~]{1,255}", uid):
        return None
    starts, ends = _time(p.get("startTime")), _time(p.get("endTime"))
    if trigger == "BOOKING_CANCELLED":
        return Booking("calcom", "cancelled", uid, starts or _EPOCH, ends or _EPOCH + dt.timedelta(seconds=1))
    if starts is None or ends is None or ends <= starts:
        return None
    attendees = [a for a in (p.get("attendees") or []) if isinstance(a, dict)]
    who = attendees[0] if attendees else {}
    responses = p.get("responses")
    phone = _phone(_calcom_response(responses, "attendeePhoneNumber", "phone", "smsReminderNumber")) or _phone(p.get("smsReminderNumber")) or _phone(who.get("phoneNumber"))
    name = _text(who.get("name"), 200) or _text(_calcom_response(responses, "name"), 200)
    email = _email(who.get("email")) or _email(_calcom_response(responses, "email"))
    answer = None
    if consent_question and isinstance(responses, dict):
        want = consent_question.strip().lower()
        for key, val in responses.items():
            label = val.get("label") if isinstance(val, dict) else None
            if (isinstance(key, str) and key.lower() == want) or (isinstance(label, str) and label.strip().lower() == want):
                answer = _calcom_response({key: val}, key)
    consent_text, consent_at = _consent_from(answer, consent_question, _text(body.get("createdAt"), 40))
    old = p.get("rescheduleUid")
    replaces = old if trigger == "BOOKING_RESCHEDULED" and isinstance(old, str) and old != uid and re.fullmatch(r"[!-~]{1,255}", old) else None
    return Booking("calcom", "created", uid, starts, ends, name, email, phone, _text(p.get("title"), 200), replaces, consent_text, consent_at)


def parse(kind: str, raw: bytes, consent_question: str | None = None) -> Booking | None:
    try:
        body = json.loads(raw)
    except ValueError:
        return None
    return read_calendly(body, consent_question) if kind == "calendly" else read_calcom(body, consent_question)
