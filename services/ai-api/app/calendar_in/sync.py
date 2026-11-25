"""The worker's Outlook pass (one per scheduler tick, app/scheduler/worker.py), as the registered scheduler account; the same shape as app/google_calendar/sync.py, thinner:

  1. a fresh access token from the refresh token in the vault (Microsoft answers a NEW refresh token each time: it is stored at once; a grant that no longer works marks the link needs_reconnect and the
     worker leaves it alone from then on: never a loop);
  2. WRITE (setting write_events): the appointments whose Outlook event must be written, changed or deleted. The event carries our transactionId (s19 + the visit id), so a retried create cannot make a
     second event; a body equal to the last one pushed is not sent again. Only events WE made (their ids are in our table) are ever changed or deleted;
  3. READ (setting block_busy): the busy times of the next 60 days from calendarView, minus the events we wrote, replace the business's Outlook busy blocks (they stop customers booking those times).
     showAs busy, oof or tentative count; free and workingElsewhere do not.
A failure is a closed code word (backed off in the database); nothing from Microsoft is logged."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import uuid
from collections.abc import Callable
from typing import Any

from app.calendar_in.microsoft import BUSY_STATES, MicrosoftApi, MicrosoftError
from app.calendar_in.repository import CalendarInRepository
from app.connector_vault import ConnectorVault
from app.google_calendar.google import parse_time
from app.google_calendar.sync import person_label, scrub
from app.tenancy.repository import TokenRejected
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.calendar_in.sync")

WINDOW = dt.timedelta(days=60)
KIND = "outlook"
STOP_WORK = ("revoked", "rate_limited", "unavailable")


def txn_id_for(visit_id: uuid.UUID) -> str:
    return "s19" + visit_id.hex


def _when(raw: Any) -> dict[str, str]:
    value = parse_time(raw)
    if value is None:
        raise ValueError("no time")
    return {"dateTime": value.astimezone(dt.UTC).strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}


def event_body(visit: dict[str, Any]) -> dict[str, Any]:
    """The event we write: the subject names the person by first name and last initial ("Appointment" when the person was erased); the body holds ONLY the purpose and the party size (never a number or an address)."""
    label = person_label(visit.get("person_name"))
    lines = []
    purpose = visit.get("purpose")
    if isinstance(purpose, str) and purpose and not purpose.startswith("erased:"):
        cleaned = scrub(purpose)[:200]
        if cleaned:
            lines.append(f"Purpose: {cleaned}")
    lines.append(f"Party size: {int(visit.get('party_size') or 1)}")
    return {"subject": f"Appointment: {label}" if label else "Appointment", "body": {"contentType": "text", "content": "\n".join(lines)},
            "start": _when(visit.get("starts_at")), "end": _when(visit.get("ends_at")), "showAs": "busy", "isReminderOn": True}


def body_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def subtract_ours(busy: list[tuple[dt.datetime, dt.datetime, str]], own_ids: set[str]) -> list[tuple[dt.datetime, dt.datetime]]:
    return [(s, e) for s, e, eid in busy if eid not in own_ids]


class OutlookSync:
    def __init__(self, repo: CalendarInRepository, ms: MicrosoftApi, vault: ConnectorVault, *, clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC)) -> None:
        self._repo, self._ms, self._vault, self._clock = repo, ms, vault, clock

    def run(self, token: str) -> dict[str, int]:
        counts = {"links": 0, "events": 0, "busy": 0}
        for link in self._repo.outlook_links(token):
            counts["links"] += 1
            try:
                self._link(token, link, counts)
            except TokenRejected:
                raise
            except SecretStoreError:
                logger.error("outlook link pass: the key store did not answer")
            except Exception as exc:   # one link never stops the others
                logger.error("outlook link pass crashed: %s", exc.__class__.__name__)
        return counts

    def _access(self, token: str, tenant: uuid.UUID) -> str | None:
        secret = self._vault.get(tenant, KIND)
        if secret is None or not isinstance(secret.get("refresh_token"), str):
            self._repo.link_failed(token, tenant, "token", "secret_missing", True)
            return None
        try:
            grant = self._ms.refresh(secret["refresh_token"])
        except MicrosoftError as exc:
            self._repo.link_failed(token, tenant, "token", exc.code, exc.code == "revoked")
            return None
        if grant.refresh_token != secret["refresh_token"]:
            self._vault.put(tenant, KIND, {"refresh_token": grant.refresh_token})   # Microsoft rotates it: the new one replaces the old at once
        return grant.access_token

    def _link(self, token: str, link: dict[str, Any], counts: dict[str, int]) -> None:
        tenant = uuid.UUID(str(link["tenant_id"]))
        if link.get("status") != "connected" or not (link.get("events_due") or link.get("busy_due")):
            return
        access = self._access(token, tenant)
        if access is None:
            return
        if link.get("events_due") and not self._events(token, tenant, access, counts):
            return
        if link.get("busy_due"):
            self._busy(token, tenant, access, counts)

    def _events(self, token: str, tenant: uuid.UUID, access: str, counts: dict[str, int]) -> bool:
        for visit in self._repo.visits_due(token, tenant):
            visit_id = uuid.UUID(str(visit["visit_id"]))
            try:
                state, event_id, digest = self._push(access, visit, visit_id)
            except MicrosoftError as exc:
                if exc.code == "revoked":
                    self._repo.link_failed(token, tenant, "token", "revoked", True)
                    return False
                self._repo.event_failed(token, tenant, visit_id, exc.code)
                if exc.code in STOP_WORK:
                    return False
                continue
            except ValueError:
                self._repo.event_failed(token, tenant, visit_id, "bad_visit")
                continue
            self._repo.event_done(token, tenant, visit_id, event_id, state, digest, str(visit["visit_updated_at"]))
            counts["events"] += 1
        return True

    def _push(self, access: str, visit: dict[str, Any], visit_id: uuid.UUID) -> tuple[str, str | None, str | None]:
        known = visit.get("event_state")
        event_id = visit.get("event_id") if isinstance(visit.get("event_id"), str) else None
        if visit.get("status") == "cancelled":
            if event_id:
                self._ms.delete_event(access, event_id)   # only an event whose id is in OUR table
            return "deleted", event_id, None
        body = event_body(visit)
        digest = body_hash(body)
        if known == "written" and event_id and visit.get("last_pushed_hash") == digest:
            return "written", event_id, digest
        if event_id and known in ("written", "pending"):
            try:
                self._ms.patch_event(access, event_id, body)
                return "written", event_id, digest
            except MicrosoftError as exc:
                if exc.code != "not_found":   # the owner deleted it in Outlook: it is written anew
                    raise
        return "written", self._ms.create_event(access, txn_id_for(visit_id), body), digest

    def _busy(self, token: str, tenant: uuid.UUID, access: str, counts: dict[str, int]) -> None:
        now = self._clock()
        try:
            events = self._ms.calendar_view(access, now, now + WINDOW)
        except MicrosoftError as exc:
            self._repo.link_failed(token, tenant, "busy" if exc.code != "revoked" else "token", exc.code, exc.code == "revoked")
            return
        own = {str(x["event_id"]) for x in self._repo.own_events(token, tenant) if x.get("event_id")}
        spans = subtract_ours([(e.starts_at, e.ends_at, e.event_id) for e in events if e.show_as in BUSY_STATES], own)
        self._repo.busy_replace(token, tenant, merge(spans))
        counts["busy"] += 1


def merge(spans: list[tuple[dt.datetime, dt.datetime]]) -> list[tuple[dt.datetime, dt.datetime]]:
    out: list[tuple[dt.datetime, dt.datetime]] = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out
