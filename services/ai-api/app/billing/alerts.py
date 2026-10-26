"""Running out before the month ends: the alerts and the close of the period (night 4, job DS part E2, docs/contracts/topups.md).

At 80 and 100 percent of the call minutes or the business messages the Owner is told, once per kind, level and period, on two channels: an e-mail (the one sender of the app: fake locally, Resend on staging)
and a WhatsApp message to the owner (FAKE: recorded and logged as one constant line; the owner's own number and the template are for the day telephony and the platform's gates exist). Each channel is marked
after it went, so a retry never sends twice; a failed send is not marked and is offered again at the next tick. The database decides what is due (only while the platform's billing switch is on, never for an
exempt workspace, the 80 percent alert is dropped once the 100 percent one exists). The words contain a business name, a date and a count: no customer, no amount.

The same pass also asks the database to close the period that just ended (one overage invoice, capped at the Owner's monthly cap)."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol

from app.billing.mail import Email, EmailSender, _fill, _texts, mail_language, to_html
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing.alerts")


class AlertRepository(Protocol):
    def alerts_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def alert_mark(self, token: str, tenant_id: uuid.UUID, kind: str, level: int, period_start: date, channel: str) -> None: ...
    def topup_tick(self, token: str, limit: int) -> dict[str, Any]: ...


class OwnerWhatsApp(Protocol):
    name: str

    def send(self, tenant_id: str, text: str) -> bool: ...


class FakeOwnerWhatsApp:
    """Sends nothing. Keeps what it was asked to send (tests, a local look). One constant line in the log: no text, no name."""

    name = "fake"

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, tenant_id: str, text: str) -> bool:
        self.sent.append((tenant_id, text))
        logger.info("usage alert (fake WhatsApp to the owner): one message not sent anywhere")
        return True


def _parts(business: str, kind: str, level: int, projected: str | None, queued: int, language: str) -> tuple[str, list[str]]:
    section = _texts()["usage"]
    lang = mail_language(language)
    what = section["what"][lang][kind]
    runout = _fill(section["runout"][lang], date=projected) if projected and level == 80 else ""
    queue = _fill(section["queue"][lang], n=str(queued)) if queued > 0 and kind == "call_minutes" and level == 100 else ""
    block = section["low" if level == 80 else "empty"]
    subject = _fill(block["subject"][lang], what=what)
    lines = [_fill(line, business=business, what=what, runout=runout, queue=queue) for line in block["lines"][lang]]
    return subject, lines


def compose_usage_alert(business: str, kind: str, level: int, projected: str | None, queued: int, to: str, language: str = "en", key: str = "") -> Email:
    """The e-mail for one alert. `projected` is the India date (yyyy-mm-dd) the allowance runs out at this period's pace, `queued` the calls waiting for minutes."""
    subject, lines = _parts(business, kind, level, projected, queued, language)
    signoff = _texts()["signoff"][mail_language(language)]
    return Email(to=to, subject=subject, body="\n\n".join([*lines, signoff]) + "\n", html=to_html(lines, signoff), idempotency_key=key or None)


def compose_usage_whatsapp(business: str, kind: str, level: int, projected: str | None, queued: int, language: str = "en") -> str:
    """The same words as one short message to the owner."""
    _, lines = _parts(business, kind, level, projected, queued, language)
    return " ".join(line for line in lines[1:])


@dataclass
class AlertTally:
    closed_invoices: int = 0
    emails: int = 0
    whatsapp: int = 0
    skipped: int = 0
    notes: list[str] = field(default_factory=list)


class UsageAlerts:
    def __init__(self, repository: AlertRepository, sender: EmailSender, whatsapp: OwnerWhatsApp, *, limit: int = 50) -> None:
        self._repo, self._sender, self._whatsapp, self._limit = repository, sender, whatsapp, limit

    def run(self, token: str) -> AlertTally:
        tally = AlertTally()
        tally.closed_invoices = int(self._repo.topup_tick(token, self._limit).get("invoices") or 0)
        for item in self._repo.alerts_due(token, self._limit):
            try:
                tenant = uuid.UUID(str(item["tenant_id"]))
                kind, level = str(item["kind"]), int(item["level"])
                period = date.fromisoformat(str(item["period_start"]))
                business = str(item.get("tenant_name") or "your workspace")
                projected = str(item["projected_run_out_on"]) if item.get("projected_run_out_on") else None
                queued = int(item.get("queued") or 0)
                language = str(item.get("language") or "en")
                if kind not in ("call_minutes", "whatsapp_messages") or level not in (80, 100):
                    raise ValueError("unexpected alert")
                for channel in item.get("channels") or []:
                    if channel == "email":
                        addresses = [str(e) for e in item.get("emails") or [] if isinstance(e, str) and "@" in e]
                        ok = bool(addresses)
                        for address in addresses:
                            ok = self._sender.send(compose_usage_alert(business, kind, level, projected, queued, address, language, f"usage-{tenant}-{kind}-{level}-{period}-{address}")) and ok
                        if ok:
                            self._repo.alert_mark(token, tenant, kind, level, period, "email")
                            tally.emails += 1
                        else:
                            tally.skipped += 1   # an Owner with no address cannot be told: left open, not marked
                    elif channel == "whatsapp":
                        if self._whatsapp.send(str(tenant), compose_usage_whatsapp(business, kind, level, projected, queued, language)):
                            self._repo.alert_mark(token, tenant, kind, level, period, "whatsapp")
                            tally.whatsapp += 1
                        else:
                            tally.skipped += 1
            except (KeyError, ValueError):
                logger.error("usage alerts: an unexpected item was skipped")
            except RepositoryError:
                raise
        return tally
