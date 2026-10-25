"""The e-mails of a workspace that went read-only (job DI, owner decision 25 Oct 2026): at day 1, 30, 60 and 83 of read-only the Owners are told, in plain words, that the workspace is read-only, what still works,
and the day the data will be deleted. Only a FAKE sender exists (it sends nothing anywhere: it keeps the message in memory and logs one constant line); a real one (SMTP) is a later job and needs the owner's
written approval (ADR 0017). No amount, no customer, no child and no business data is in a message: the business's name, a date and a count of days.

The worker asks the database which reminders are due (only while the platform's billing switch is on), sends each through the sender, and marks it. A mark that fails after a send means the same reminder is
offered again on the next tick: with a real sender that would be a duplicate e-mail, so the order is: send, mark, and a failed send is NOT marked."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.billing.mail")
DAYS = (1, 30, 60, 83)
PENDING_DAYS = (30, 60, 90)


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    body: str = field(repr=False)


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


def build_sender(name: str) -> EmailSender:
    """BILLING_EMAIL_SENDER: only `fake` exists. Anything else stops the process at start."""
    if name == "fake":
        return FakeEmailSender()
    raise ValueError("BILLING_EMAIL_SENDER must be 'fake' (no real sender exists yet)")


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


def compose_pending(business: str, day: int, to: str) -> Email:
    """The reminder to a workspace that chose a plan but has not connected WhatsApp (job DM, owner decision 25 Oct 2026): nothing is charged and the trial has not begun; it begins the day WhatsApp is connected."""
    subject = "Connect your WhatsApp to start your free trial"
    body = (
        f"Workspace: {business}\n\nYou chose a plan {day} days ago, but your WhatsApp is not connected yet. Your free trial has not started and nothing has been charged: the 14 days begin on the day your WhatsApp is connected.\n\n"
        "Until then you can set up your catalogue, your customers and your AI assistant, but messages, AI calls and campaigns stay off. Open Settings in the app to connect your WhatsApp.\n"
    )
    return Email(to=to, subject=subject, body=body)


class BillingMailRepository(Protocol):
    def reminders_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...
    def pending_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def pending_mark(self, token: str, tenant_id: uuid.UUID, day: int) -> None: ...


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

    def run_pending(self, token: str) -> int:
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
                    ok = self._sender.send(compose_pending(str(item.get("tenant_name") or "your workspace"), day, address)) and ok
                if ok:
                    self._repo.pending_mark(token, tenant, day)
                    sent += 1
            except (KeyError, ValueError):
                logger.error("billing pending reminders: an unexpected item was skipped")
            except RepositoryError:
                raise
        return sent
