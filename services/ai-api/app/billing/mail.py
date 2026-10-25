"""The e-mails of a workspace that went read-only (job DI, owner decision 25 Oct 2026): at day 1, 30, 60 and 83 of read-only the Owners are told, in plain words, that the workspace is read-only, what still works,
and the day the data will be deleted. Only a FAKE sender exists (it sends nothing anywhere: it keeps the message in memory and logs one constant line); a real one (SMTP) is a later job and needs the owner's
written approval (ADR 0017). No amount, no customer, no child and no business data is in a message: the business's name, a date and a count of days.

The worker asks the database which reminders are due (only while the platform's billing switch is on), sends each through the sender, and marks it. A mark that fails after a send means the same reminder is
offered again on the next tick: with a real sender that would be a duplicate e-mail, so the order is: send, mark, and a failed send is NOT marked."""

from __future__ import annotations

import html
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing.mail")
DAYS = (1, 30, 60, 83)
PENDING_DAYS = (30, 60, 90)
TRIAL_DAYS = (11, 13)
MAIL_LANGUAGES = ("en", "te", "hi")
MAIL_DATA = Path(__file__).resolve().parent / "data" / "mail.json"
ACCENT = "#c2410c"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str = field(repr=False)
    # a simple HTML version of the same words (optional; the plain text is always there)
    html: str | None = field(default=None, repr=False)
    # makes a retry of the same reminder harmless at the provider (optional)
    idempotency_key: str | None = None


class EmailSender(Protocol):
    name: str

    def send(self, message: Email) -> bool: ...


class FakeEmailSender:
    """Sends nothing. Keeps what it was asked to send (tests, a local look)."""

    name = "fake"

    def __init__(self) -> None:
        self.sent: list[Email] = []

    def send(self, message: Email) -> bool:
        self.sent.append(message)
        logger.info("billing e-mail (fake): one reminder not sent anywhere")   # no address, no text in the log
        return True


def build_sender(name: str, api_key: str | None = None, mail_from: str | None = None, reply_to: str | None = None) -> EmailSender:
    """BILLING_EMAIL_SENDER: `fake` (sends nothing) or `resend` (Resend's HTTP API; needs RESEND_API_KEY, which comes from Secret Manager and is never logged, and MAIL_FROM). Anything else stops the process at start."""
    if name == "fake":
        return FakeEmailSender()
    if name == "resend":
        if not api_key or not mail_from:
            raise ValueError("BILLING_EMAIL_SENDER=resend needs RESEND_API_KEY and MAIL_FROM")
        from app.billing.resend_sender import ResendEmailSender

        return ResendEmailSender(api_key, mail_from, reply_to)
    raise ValueError("BILLING_EMAIL_SENDER must be 'fake' or 'resend'")


def compose(business: str, day: int, delete_on: str, to: str) -> Email:
    """The fixed words of each reminder (English; Telugu, Hindi and Kannada come with the review of the other wording). The business's name is data and is only ever put between the lines."""
    deletes = f"Your data will be kept until {delete_on} and then deleted."
    if day == 1:
        subject = "Your workspace is now read-only"
        lead = "Your trial or plan has ended, so your workspace is now read-only."
    elif day == 83:
        subject = "Your data will be deleted in 7 days"
        lead = "Your workspace is still read-only and its data will be deleted in 7 days."
    else:
        subject = f"Your workspace has been read-only for {day} days"
        lead = f"Your workspace has been read-only for {day} days."
    body = (
        f"{lead}\n\nWorkspace: {business}\n\nYou can still sign in, look at everything and export your data. Sending messages, the AI and calls are paused, and nothing can be changed.\n"
        f"{deletes}\n\nTo carry on, choose a plan in the app under Plan. If you want your data, export it before {delete_on}.\n"
    )
    return Email(to=to, subject=subject, body=body)


@lru_cache(maxsize=1)
def _texts() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(MAIL_DATA.read_text(encoding="utf-8"))
    return loaded


def mail_language(value: object) -> str:
    """The language of an e-mail: the workspace's own when we have words for it (English, Telugu, Hindi), else English."""
    return str(value) if value in MAIL_LANGUAGES else "en"


def _fill(text: str, **values: str) -> str:
    # one pass over the template: a value (a business name with braces, say) is never read again as a placeholder
    return re.sub(r"\{(\w+)\}", lambda m: values.get(m.group(1), m.group(0)), text)


def to_html(lines: list[str], signoff: str) -> str:
    """The same words as simple HTML: paragraphs, the brand colour on the name, nothing loaded from anywhere (no image, no tracking)."""
    paragraphs = "".join(f'<p style="margin:0 0 14px 0;font-size:15px;line-height:22px;">{html.escape(line)}</p>' for line in lines)
    return (
        '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#faf7f2;"><div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #eadfd3;border-radius:12px;'
        f'padding:24px 28px;font-family:Arial,Helvetica,sans-serif;color:#1c1917;"><div style="font-size:20px;font-weight:bold;color:{ACCENT};margin-bottom:16px;">Stack19</div>{paragraphs}'
        f'<p style="margin:18px 0 0 0;font-size:15px;line-height:22px;">{html.escape(signoff)}</p></div></body></html>'
    )


def _compose(kind: str, business: str, to: str, language: str, key: str, **values: str) -> Email:
    texts = _texts()
    lang = mail_language(language)
    section = texts[kind]
    lines = [_fill(line, business=business, **values) for line in section["lines"][lang]]
    signoff = texts["signoff"][lang]
    subject = _fill(section["subject"][lang], **values)
    return Email(to=to, subject=subject, body="\n\n".join([*lines, signoff]) + "\n", html=to_html(lines, signoff), idempotency_key=key)


def compose_pending(business: str, day: int, to: str, language: str = "en", tenant_id: str = "") -> Email:
    """The reminder to a workspace that chose a plan but has not connected WhatsApp (job DM, owner decision 25 Oct 2026): nothing is charged and the trial has not begun; it begins the day WhatsApp is connected."""
    return _compose("pending", business, to, language, f"pending-{tenant_id}-{day}-{to}", day=str(day))


def compose_trial(business: str, day: int, to: str, language: str = "en", tenant_id: str = "") -> Email:
    """The reminder on day 11 and day 13 of the 14-day trial: how many days are left, that the plan then starts, and where to look or cancel."""
    left = {11: "3", 13: "1"}[day]
    words = _texts()["trial"]["days_left"][mail_language(language)][left]
    return _compose("trial", business, to, language, f"trial-{tenant_id}-{day}-{to}", days_left=words)


class BillingMailRepository(Protocol):
    def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...


class PendingMailRepository(Protocol):
    def pending_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def pending_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...


class TrialMailRepository(Protocol):
    def trial_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def trial_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...


class PostgrestBillingMailRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_billing_reminders_due", {"p_limit": limit})

    def mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self._rpc.object(token, "scheduler_billing_reminder_mark", {"p_tenant_id": str(tenant_id), "p_day": day})

    def pending_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_billing_pending_due", {"p_limit": limit})

    def pending_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self._rpc.object(token, "scheduler_billing_pending_mark", {"p_tenant_id": str(tenant_id), "p_day": day})

    def trial_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_billing_trial_due", {"p_limit": limit})

    def trial_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None:
        self._rpc.object(token, "scheduler_billing_trial_mark", {"p_tenant_id": str(tenant_id), "p_day": day})


class BillingReminders:
    """One pass of the worker: the reminders that are due, sent and marked."""

    def __init__(self, repository: BillingMailRepository, sender: EmailSender, *, limit: int = 50) -> None:
        self._repo, self._sender, self._limit = repository, sender, limit

    def run(self, token: str) -> int:
        sent = 0
        for item in self._repo.reminders_due(token, self._limit):
            try:
                tenant = uuid.UUID(str(item["tenant_id"]))
                day = int(item["day"])
                emails = [str(e) for e in item.get("emails") or [] if isinstance(e, str) and "@" in e]
                if day not in DAYS:
                    raise ValueError("unexpected reminder day")
                ok = bool(emails)
                for address in emails:
                    ok = self._sender.send(compose(str(item.get("tenant_name") or "your workspace"), day, str(item["delete_on"]), address)) and ok
                if ok:
                    self._repo.mark(token, tenant, day)   # an Owner with no address cannot be told; the day is left open, not marked
                    sent += 1
            except (KeyError, ValueError):
                logger.error("billing reminders: an unexpected item was skipped")
            except RepositoryError:
                raise
        return sent


class PendingReminders:
    """One pass of the worker: the reminders to workspaces still waiting for WhatsApp (30, 60 and 90 days after the plan was chosen), sent and marked like the others."""

    def __init__(self, repository: PendingMailRepository, sender: EmailSender, *, limit: int = 50) -> None:
        self._repo, self._sender, self._limit = repository, sender, limit

    def run(self, token: str) -> int:
        """The reminders to workspaces still waiting for WhatsApp (30, 60 and 90 days after the plan was chosen), sent and marked like the others."""
        sent = 0
        for item in self._repo.pending_due(token, self._limit):
            try:
                tenant = uuid.UUID(str(item["tenant_id"]))
                day = int(item["day"])
                emails = [str(e) for e in item.get("emails") or [] if isinstance(e, str) and "@" in e]
                if day not in PENDING_DAYS:
                    raise ValueError("unexpected reminder day")
                ok = bool(emails)
                for address in emails:
                    ok = self._sender.send(compose_pending(str(item.get("tenant_name") or "your workspace"), day, address, str(item.get("language") or "en"), str(tenant))) and ok
                if ok:
                    self._repo.pending_mark(token, tenant, day)
                    sent += 1
            except (KeyError, ValueError):
                logger.error("billing pending reminders: an unexpected item was skipped")
            except RepositoryError:
                raise
        return sent


class TrialReminders:
    """One pass of the worker: the reminders on day 11 and day 13 of the trial, sent and marked like the others (a failed send is not marked)."""

    def __init__(self, repository: TrialMailRepository, sender: EmailSender, *, limit: int = 50) -> None:
        self._repo, self._sender, self._limit = repository, sender, limit

    def run(self, token: str) -> int:
        sent = 0
        for item in self._repo.trial_due(token, self._limit):
            try:
                tenant = uuid.UUID(str(item["tenant_id"]))
                day = int(item["day"])
                emails = [str(e) for e in item.get("emails") or [] if isinstance(e, str) and "@" in e]
                if day not in TRIAL_DAYS:
                    raise ValueError("unexpected reminder day")
                ok = bool(emails)
                for address in emails:
                    ok = self._sender.send(compose_trial(str(item.get("tenant_name") or "your workspace"), day, address, str(item.get("language") or "en"), str(tenant))) and ok
                if ok:
                    self._repo.trial_mark(token, tenant, day)
                    sent += 1
            except (KeyError, ValueError):
                logger.error("billing trial reminders: an unexpected item was skipped")
            except RepositoryError:
                raise
        return sent
