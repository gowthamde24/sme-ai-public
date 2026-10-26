"""The e-mails of the DPDP doors (job DQ part 4): the grievance goes to the privacy inbox and is acknowledged to the person, a waitlist entry goes to the hello inbox, and a workspace about to be erased is warned
48 hours before. Plain text plus simple HTML, through the one e-mail sender of the app (fake in tests and locally, Resend on staging). The inbox addresses come from the environment (PRIVACY_EMAIL, HELLO_EMAIL), never from code.

Every send is marked only after it went; a failed send is offered again at the next tick. A grievance's words go ONLY to the privacy inbox (the person is told the reference, the date and nothing else)."""

from __future__ import annotations

import json
import logging
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.billing.mail import Email, EmailSender, mail_language, to_html
from app.dpdp.repository import DpdpRepository
from app.integrations.ratelimit import SlidingWindow
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.dpdp.mail")
DATA = Path(__file__).resolve().parent / "data" / "mail.json"
PERSON_LANGUAGES = ("en", "te", "hi", "kn")
ANSWER_DAYS = 30


@lru_cache(maxsize=1)
def _texts() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(DATA.read_text(encoding="utf-8"))
    return loaded


def _fill(text: str, **values: str) -> str:
    out = text
    for key, value in values.items():
        out = out.replace("{" + key + "}", value)
    return out


def _lang(value: object) -> str:
    return str(value) if value in PERSON_LANGUAGES else "en"


def _compose(section: str, to: str, language: str, key: str, **values: str) -> Email:
    texts = _texts()
    lang = _lang(language)
    block = texts[section]
    subjects = block["subject"]
    lines_by_lang = block["lines"]
    lang = lang if lang in lines_by_lang else "en"
    lines = [_fill(line, **values) for line in lines_by_lang[lang]]
    signoff = texts["signoff"][lang]
    return Email(to=to, subject=_fill(subjects[lang], **values), body="\n\n".join([*lines, signoff]) + "\n", html=to_html(lines, signoff), idempotency_key=key)


def compose_grievance_ack(item: dict[str, Any], to: str) -> Email:
    return _compose("grievance_ack", to, str(item.get("language") or "en"), f"grievance-ack-{item['id']}", reference=str(item["reference"]), due=str(item["due_on"]), days=str(ANSWER_DAYS))


def compose_grievance_inbox(item: dict[str, Any], to: str) -> Email:
    lines = [
        f"Reference: {item['reference']}",
        f"Kind: {item['kind']}",
        f"Received: {item['received_at']}   Answer due: {item['due_on']}",
        f"Name: {item['name']}",
        f"Contact: {item['contact']}",
        f"Language: {item.get('language') or '-'}",
        "",
        str(item.get("details") or "(no details)"),
    ]
    body = "\n".join(lines)
    html_lines = [line for line in lines if line]
    return Email(to=to, subject=f"Privacy request {item['reference']} ({item['kind']})", body=body + "\n", html=to_html(html_lines, "Stack19 privacy desk"), idempotency_key=f"grievance-inbox-{item['id']}")


def compose_waitlist_inbox(item: dict[str, Any], to: str) -> Email:
    lines = [
        f"Name: {item['name']}",
        f"Business: {item['business_type']} in {item['city']}",
        f"Phone: {item.get('phone') or '-'}",
        f"E-mail: {item.get('email') or '-'}",
        f"Language: {item['language']}",
        f"Agreed to marketing: {'yes' if item.get('marketing_opt_in') else 'no'}",
        f"Joined: {item['created_at']}",
    ]
    return Email(to=to, subject=f"Waitlist: {item['name']} ({item['business_type']}, {item['city']})", body="\n".join(lines) + "\n", html=to_html(lines, "Stack19 waitlist"), idempotency_key=f"waitlist-{item['id']}")


def compose_lapse_warning(business: str, erase_on: str, to: str, language: str = "en", tenant_id: str = "") -> Email:
    return _compose("lapse_warning", to, mail_language(language), f"lapse-warning-{tenant_id}-{erase_on}-{to}", business=business, date=erase_on)


class IntakeMail:
    """One pass of the worker: e-mail what the two public doors stored."""

    def __init__(self, repository: DpdpRepository, sender: EmailSender, privacy_inbox: str | None, hello_inbox: str | None, *, limit: int = 20) -> None:
        self._repo, self._sender, self._privacy, self._hello, self._limit = repository, sender, privacy_inbox, hello_inbox, limit

    def run(self, token: str) -> int:
        sent = 0
        offered = self._repo.intake_due(token, self._limit)
        for item in offered.get("grievances") or []:
            try:
                item_id = uuid.UUID(str(item["id"]))
                if item.get("need_inbox") and self._privacy:
                    if self._sender.send(compose_grievance_inbox(item, self._privacy)):
                        self._repo.intake_mark(token, "grievance", item_id, "inbox")
                        sent += 1
                if item.get("need_ack") and "@" in str(item.get("contact")):
                    if self._sender.send(compose_grievance_ack(item, str(item["contact"]))):
                        self._repo.intake_mark(token, "grievance", item_id, "ack")
                        sent += 1
            except (KeyError, ValueError):
                logger.error("dpdp mail: an unexpected grievance item was skipped")
        for item in offered.get("waitlist") or []:
            try:
                if self._hello and self._sender.send(compose_waitlist_inbox(item, self._hello)):
                    self._repo.intake_mark(token, "waitlist", uuid.UUID(str(item["id"])), "inbox")
                    sent += 1
            except (KeyError, ValueError):
                logger.error("dpdp mail: an unexpected waitlist item was skipped")
        return sent


class LapseErasure:
    """One pass of the worker: warn the Owners of a lapsed workspace 48 hours before its erasure, then (the database re-checks everything) erase it. A workspace with no Owner address is never marked warned, so it is never erased."""

    def __init__(self, repository: DpdpRepository, sender: EmailSender, *, limit: int = 20) -> None:
        self._repo, self._sender, self._limit = repository, sender, limit
        self.warned = 0
        self.erased = 0

    def run(self, token: str) -> int:
        due = self._repo.lapse_due(token, self._limit)
        done = 0
        for item in due.get("warn") or []:
            try:
                tenant = uuid.UUID(str(item["tenant_id"]))
                emails = [str(e) for e in item.get("emails") or [] if isinstance(e, str) and "@" in e]
                ok = bool(emails)
                for address in emails:
                    ok = self._sender.send(compose_lapse_warning(str(item.get("tenant_name") or "your workspace"), str(item["erase_on"]), address, str(item.get("language") or "en"), str(tenant))) and ok
                if ok:
                    self._repo.lapse_warned(token, tenant)
                    self.warned += 1
                    done += 1
            except (KeyError, ValueError):
                logger.error("lapse erasure: an unexpected warning item was skipped")
        for item in due.get("erase") or []:
            try:
                self._repo.lapse_erase(token, uuid.UUID(str(item["tenant_id"])))
                self.erased += 1
                done += 1
            except (KeyError, ValueError):
                logger.error("lapse erasure: an unexpected erase item was skipped")
            except RepositoryError:
                logger.error("lapse erasure: the database refused an erasure")   # not erased; offered again only if it is still due
        return done


class DpdpJobs:
    """The worker's DPDP steps in one place: the intake e-mails, the lapse warnings and erasures, and (once an hour) the purge of old logs."""

    def __init__(self, intake: IntakeMail | None, lapse: LapseErasure | None, repository: DpdpRepository, *, purge_window: SlidingWindow | None = None) -> None:
        self._intake, self._lapse, self._repo = intake, lapse, repository
        self._purge_window = purge_window or SlidingWindow(1, 3600.0)

    def run(self, token: str) -> None:
        if self._intake is not None:
            self._intake.run(token)
        if self._lapse is not None:
            self._lapse.run(token)
        if self._purge_window.allow("purge"):
            counts = self._repo.purge_logs(token)
            if any(int(v) for v in counts.values()):
                logger.info("dpdp purge: audit_events=%s public_grievances=%s waitlist=%s", counts.get("audit_events"), counts.get("public_grievances"), counts.get("waitlist"))
