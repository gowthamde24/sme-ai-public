"""The worker's Google Calendar pass (one per scheduler tick, app/scheduler/worker.py), as the registered scheduler account.

For every link (public.scheduler_gcal_links):
  1. the workspace was erased after the link was made -> disconnect it (revoke at Google, stop the channel, delete the secret, forget our rows; events in their calendar stay);
  2. a fresh access token (a refresh token Google refuses -> the link is `needs_reconnect`, and the worker leaves it alone from then on: never a loop);
  3. WRITE: the appointments whose event must be written, changed or deleted (the visits' own `updated_at` is newer than the last push, or a push failed and its back-off passed). The visits module is
     not touched: this pass FINDS the changes. Idempotent: the event id is ours and fixed (s19 + the visit id), a body equal to the last one pushed is not sent again;
  4. the push channel (events.watch) is opened or renewed a day before it expires (only while "block busy" is on);
  5. READ: the busy times of the next 60 days (freebusy.query), minus the events WE wrote, replace the business's busy blocks; due every 30 minutes, or a minute after a push notification.
A failure is a closed code word on the link or the event (backed off in the database); nothing from Google is logged."""

# ruff: noqa: E501

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import uuid
from collections.abc import Callable
from typing import Any
from zoneinfo import ZoneInfo

from app.google_calendar.google import GoogleApi, GoogleError, event_times, parse_time
from app.google_calendar.repository import GoogleCalendarRepository
from app.google_calendar.vault import Vault
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.google_calendar.sync")

IST = ZoneInfo("Asia/Kolkata")
WINDOW = dt.timedelta(days=60)
CHANNEL_TTL_S = 7 * 24 * 3600
MAX_EVENT_GETS = 20          # events.get of our own events per busy refresh (the rest use the times we wrote)
PUSH_PATH = "/v1/integrations/google-calendar/push"
# a phone number or an e-mail address never reaches Google, even when someone typed one into the purpose (bounded patterns)
_PHONE = re.compile(r"\+?\d[\d ().-]{5,18}\d")
_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@]{1,255}")
STOP_WORK = ("revoked", "rate_limited", "unavailable")


def scrub(text: str) -> str:
    out = _EMAIL.sub("[hidden]", _PHONE.sub("[hidden]", text))
    return re.sub(r"[ \t]{2,40}", " ", out).strip()


def person_label(full_name: Any) -> str | None:
    """ "Priya Sharma" -> "Priya S."; one word stays as it is; nothing (or an erased record) -> None."""
    if not isinstance(full_name, str):
        return None
    words = [w for w in scrub(full_name).replace("[hidden]", "").split() if w]
    if not words:
        return None
    first = words[0][:40]
    return f"{first} {words[-1][0].upper()}." if len(words) > 1 else first


def event_id_for(visit_id: uuid.UUID) -> str:
    return "s19" + visit_id.hex   # base32hex letters (a-v) and digits only, as Google asks of a chosen id


def _when(raw: Any) -> dict[str, str]:
    value = parse_time(raw)
    if value is None:
        raise ValueError("no time")
    return {"dateTime": value.astimezone(IST).isoformat(), "timeZone": "Asia/Kolkata"}


def event_body(visit: dict[str, Any]) -> dict[str, Any]:
    """The event we write: the title names the person by first name and last initial ("Appointment" when the person was erased); the description holds ONLY the purpose and the party size."""
    label = person_label(visit.get("person_name"))
    lines = []
    purpose = visit.get("purpose")
    if isinstance(purpose, str) and purpose and not purpose.startswith("erased:"):
        cleaned = scrub(purpose)[:200]
        if cleaned:
            lines.append(f"Purpose: {cleaned}")
    lines.append(f"Party size: {int(visit.get('party_size') or 1)}")
    return {
        "summary": f"Appointment: {label}" if label else "Appointment",
        "description": "\n".join(lines),
        "start": _when(visit.get("starts_at")),
        "end": _when(visit.get("ends_at")),
        "status": "confirmed",
        "transparency": "opaque",
        "reminders": {"useDefault": True},
        "extendedProperties": {"private": {"stack19_visit_id": str(visit["visit_id"])}},
    }


def body_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def is_ours(event: dict[str, Any] | None, visit_id: uuid.UUID | str) -> bool:
    private = ((event or {}).get("extendedProperties") or {}).get("private") or {}
    return isinstance(private, dict) and private.get("stack19_visit_id") == str(visit_id)


def subtract(busy: list[tuple[dt.datetime, dt.datetime]], ours: list[tuple[dt.datetime, dt.datetime]]) -> list[tuple[dt.datetime, dt.datetime]]:
    """Busy blocks minus our own events' spans. (Google merges overlapping busy times: where one of ours overlaps a foreign event, the overlap is lost; the visit itself still holds that slot.)"""
    out: list[tuple[dt.datetime, dt.datetime]] = []
    cuts = sorted(ours)
    for start, end in sorted(busy):
        pieces = [(start, end)]
        for cs, ce in cuts:
            nxt: list[tuple[dt.datetime, dt.datetime]] = []
            for ps, pe in pieces:
                if ce <= ps or cs >= pe:
                    nxt.append((ps, pe))
                    continue
                if cs > ps:
                    nxt.append((ps, cs))
                if ce < pe:
                    nxt.append((ce, pe))
            pieces = nxt
        out.extend(p for p in pieces if p[1] - p[0] >= dt.timedelta(minutes=1))
    return out


def forget_at_google(google: GoogleApi, vault: Vault, secret_name: str, channel_id: Any, resource_id: Any) -> None:
    """Disconnect, Google's side and our copy of the secret: stop the channel, revoke the token, delete the secret. Google's refusals are tolerated (the token may be revoked already);
    a secret store that cannot delete raises SecretStoreError (nothing is forgotten in the database then, so it can be tried again)."""
    secret = vault.get(secret_name)
    if secret is not None:
        if channel_id and resource_id:
            try:
                google.stop_channel(google.access_token(secret.refresh_token), str(channel_id), str(resource_id))
            except GoogleError as exc:
                logger.info("google calendar: channel not stopped: %s", exc.code)
        try:
            google.revoke(secret.refresh_token)
        except GoogleError as exc:
            logger.info("google calendar: token not revoked: %s", exc.code)
    vault.delete(secret_name)


class GoogleCalendarSync:
    def __init__(self, repo: GoogleCalendarRepository, google: GoogleApi, vault: Vault, *, public_base_url: str | None, clock: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC)) -> None:
        self._repo = repo
        self._google = google
        self._vault = vault
        base = (public_base_url or "").rstrip("/")
        self._push_address = base + PUSH_PATH if base.startswith("https://") else None
        self._clock = clock

    def run(self, token: str) -> dict[str, int]:
        counts = {"links": 0, "events": 0, "busy": 0, "channels": 0, "erased": 0}
        for link in self._repo.links(token):
            counts["links"] += 1
            try:
                self._link(token, link, counts)
            except TokenRejected:
                raise
            except Exception as exc:   # one link never stops the others (a secret store that did not answer included: tried again next tick)
                logger.error("google calendar link pass crashed: %s", exc.__class__.__name__)
        return counts

    def _link(self, token: str, link: dict[str, Any], counts: dict[str, int]) -> None:
        tenant = uuid.UUID(str(link["tenant_id"]))
        name = str(link["secret_name"])
        if link.get("erase"):
            forget_at_google(self._google, self._vault, name, link.get("channel_id"), link.get("channel_resource_id"))
            self._repo.scheduler_disconnect(token, tenant)
            counts["erased"] += 1
            return
        if link.get("status") != "connected" or not (link.get("events_due") or link.get("busy_due") or link.get("channel_due")):
            return
        secret = self._vault.get(name)
        if secret is None:
            self._repo.link_failed(token, tenant, "token", "secret_missing", True)
            return
        try:
            access = self._google.access_token(secret.refresh_token)
        except GoogleError as exc:
            self._repo.link_failed(token, tenant, "token", exc.code, exc.code == "revoked")
            return
        if link.get("events_due"):
            if not self._events(token, tenant, access, bool(link.get("email_unknown")), counts):
                return
        if link.get("channel_due"):
            self._channel(token, tenant, access, secret.channel_token, link, counts)
        if link.get("busy_due"):
            self._busy(token, tenant, access, counts)

    # ---- 3. write our appointments
    def _events(self, token: str, tenant: uuid.UUID, access: str, email_unknown: bool, counts: dict[str, int]) -> bool:
        """False when the link must stop for this tick (the token was refused, Google is busy or down)."""
        for visit in self._repo.visits_due(token, tenant):
            visit_id = uuid.UUID(str(visit["visit_id"]))
            eid = str(visit.get("event_id") or event_id_for(visit_id))
            try:
                state, digest, organizer = self._push(access, visit, visit_id, eid)
            except GoogleError as exc:
                if exc.code == "revoked":
                    self._repo.link_failed(token, tenant, "token", "revoked", True)
                    return False
                self._repo.event_failed(token, tenant, visit_id, eid, exc.code)
                if exc.code in STOP_WORK:
                    return False
                continue
            except ValueError:
                self._repo.event_failed(token, tenant, visit_id, eid, "bad_visit")
                continue
            self._repo.event_done(token, tenant, visit_id, eid, state, digest, str(visit["visit_updated_at"]))
            counts["events"] += 1
            if email_unknown and organizer:
                try:
                    self._repo.set_email(token, tenant, organizer)
                    email_unknown = False
                except Exception as exc:
                    logger.info("google calendar: address not kept: %s", exc.__class__.__name__)
        return True

    def _push(self, access: str, visit: dict[str, Any], visit_id: uuid.UUID, eid: str) -> tuple[str, str | None, str | None]:
        g = self._google
        known = visit.get("event_state")   # None: no event link yet; pending: a write that may or may not have reached Google; written
        if visit.get("status") == "cancelled":
            if known is not None:
                found = g.get_event(access, eid)
                if found is not None and found.get("status") != "cancelled":
                    if not is_ours(found, visit_id):
                        raise GoogleError("not_ours")
                    g.delete_event(access, eid)
            return "deleted", None, None
        body = event_body(visit)
        digest = body_hash(body)
        if known == "written" and visit.get("last_pushed_hash") == digest:
            return "written", digest, None
        saved: dict[str, Any]
        if known is None:
            try:
                saved = g.insert_event(access, eid, body)
            except GoogleError as exc:
                if exc.code != "conflict":
                    raise
                saved = self._patch_ours(access, visit_id, eid, body)
        else:
            saved = self._patch_ours(access, visit_id, eid, body)
        organizer = (saved.get("organizer") or {}).get("email") if isinstance(saved, dict) else None
        return "written", digest, organizer if isinstance(organizer, str) else None

    def _patch_ours(self, access: str, visit_id: uuid.UUID, eid: str, body: dict[str, Any]) -> dict[str, Any]:
        found = self._google.get_event(access, eid)
        if found is None:
            return self._google.insert_event(access, eid, body)
        if not is_ours(found, visit_id):
            raise GoogleError("not_ours")   # an event we did not make is never edited
        return self._google.patch_event(access, eid, body)

    # ---- 4. the push channel
    def _channel(self, token: str, tenant: uuid.UUID, access: str, channel_token: str, link: dict[str, Any], counts: dict[str, int]) -> None:
        if self._push_address is None:
            self._repo.link_failed(token, tenant, "channel", "no_public_address", False)
            return
        channel_id = uuid.uuid4()
        try:
            opened = self._google.watch(access, str(channel_id), channel_token, self._push_address, CHANNEL_TTL_S)
        except GoogleError as exc:
            self._repo.link_failed(token, tenant, "channel", exc.code if exc.code != "revoked" else "revoked", exc.code == "revoked")
            return
        res = self._repo.channel_set(token, tenant, channel_id, opened.resource_id, opened.expires_at)
        counts["channels"] += 1
        stop = res.get("stop_channel") if isinstance(res, dict) else None
        if isinstance(stop, dict) and stop.get("channel_id") and stop.get("channel_resource_id"):
            try:
                self._google.stop_channel(access, str(stop["channel_id"]), str(stop["channel_resource_id"]))
            except GoogleError as exc:
                logger.info("google calendar: old channel not stopped: %s", exc.code)

    # ---- 5. busy times
    def _busy(self, token: str, tenant: uuid.UUID, access: str, counts: dict[str, int]) -> None:
        now = self._clock()
        try:
            busy = self._google.freebusy(access, now, now + WINDOW)
            spans: list[tuple[dt.datetime, dt.datetime]] = []
            gets = 0
            for own in self._repo.own_events(token, tenant):
                wrote = (parse_time(own.get("starts_at")), parse_time(own.get("ends_at")))
                if not own.get("current") and gets < MAX_EVENT_GETS:
                    gets += 1
                    found = self._google.get_event(access, str(own["event_id"]))   # events.get of OUR event only
                    if found is None or found.get("status") == "cancelled" or not is_ours(found, str(own["visit_id"])):
                        continue
                    times = event_times(found)
                    if times:
                        spans.append(times)
                        continue
                if wrote[0] and wrote[1]:
                    spans.append((wrote[0], wrote[1]))
        except GoogleError as exc:
            self._repo.link_failed(token, tenant, "busy" if exc.code != "revoked" else "token", exc.code, exc.code == "revoked")
            return
        self._repo.busy_replace(token, tenant, subtract(busy, spans))
        counts["busy"] += 1
