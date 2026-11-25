"""What the routes do (routes.py): connect, settings and disconnect for Calendly and Cal.com, the Outlook connect and its OAuth callback, the vendors' webhook door (a booking becomes a lead and a visit),
and the booking link the assistant may say. Keys and tokens go only into the connector vault (Secret Manager) and to the vendor they belong to; the database keeps a hash of the door's address, the last
four characters and settings. Nothing here logs a body, a name, a number or an address."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import secrets
import time
import urllib.parse
import uuid
from collections.abc import Callable
from typing import Any, Protocol

from app.calendar_in import bookings
from app.calendar_in.bookings import Booking
from app.calendar_in.links import booking_link_fact, clean_link
from app.calendar_in.microsoft import SCOPES, MicrosoftApi, MicrosoftError
from app.calendar_in.repository import CalendarInRepository, LinkStateError, NotConnectedError
from app.calendar_in.sync import KIND as OUTLOOK
from app.calendar_in.vendors import CalendlyApi, VendorError
from app.connector_vault import ConnectorVault, tail
from app.errors import ApiError
from app.google_calendar.state import StateSigner, code_challenge
from app.tenancy.repository import Forbidden
from app.workspace_secrets import SecretStoreError

logger = logging.getLogger("app.calendar_in.service")

KINDS = ("calendly", "calcom", "outlook")
NAMES = {"calendly": "Calendly", "calcom": "Cal.com", "outlook": "Outlook"}
CALLBACK_PATH = "/v1/calendars/outlook/callback"
HOOK_PATH = "/v1/webhooks/calendars"
MAX_BODY = 64 * 1024
SIGNATURE_HEADER = {"calendly": "calendly-webhook-signature", "calcom": "x-cal-signature-256"}

NOT_CONNECTED = (409, "calendar_not_connected", "This calendar is not connected.")
NEEDS_SETUP = (409, "calendar_needs_setup", "This connection needs a step from us first. We will tell you when it is ready.")
LINK_INVALID = (422, "calendar_link_invalid", "Use the https address of your own Calendly or Cal.com booking page.")
KEY_REFUSED = (422, "calendar_key_refused", "Calendly did not accept that key. Make a new personal access token and paste it.")
PLAN_REFUSED = (422, "calendar_plan_refused", "Calendly does not allow webhooks on this account. Check the plan and your role in Calendly.")
VENDOR_DOWN = (502, "calendar_vendor_unavailable", "The calendar service did not answer. Try again in a moment.")
SECRETS_DOWN = (503, "calendar_secret_unavailable", "The key store did not answer. Try again in a moment.")
NO_ADDRESS = (503, "calendar_no_public_address", "This system has no public address yet, so a calendar cannot send bookings here.")
TRY_LATER = (429, "calendar_try_later", "Too many connection attempts. Try again in a few minutes.")
NEEDS_RECONNECT = (409, "calendar_needs_reconnect", "Connect Outlook again: Microsoft no longer accepts the old permission.")


class TokenSource(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


class LeadBridge(Protocol):
    """The lead intake as this module needs it: a lead address (a webhook source) per connection, made once at connect with the person's token, and a lead sent to it."""

    def create_source(self, token: str, tenant_id: uuid.UUID, label: str) -> str: ...
    def receive(self, secret: str, row: dict[str, Any]) -> str: ...


class IntakeBridge:
    """The real bridge: the LeadSourcesService of the runtime (app/lead_sources/service.py). The database still decides consent, do-not-call, hours and caps."""

    def __init__(self, lead_sources: Any) -> None:
        self._svc = lead_sources

    def create_source(self, token: str, tenant_id: uuid.UUID, label: str) -> str:
        from app.lead_sources.models import SourceCreate

        out, _created = self._svc.source_create(token, tenant_id, SourceCreate(source_id=uuid.uuid4(), kind="webhook", label=label))
        url = str((out.get("secret") or {}).get("url") or "")
        return url.rsplit("/", 1)[-1]

    def receive(self, secret: str, row: dict[str, Any]) -> str:
        return str(self._svc._live(secret, [row]))   # noqa: SLF001 - the one door every source uses


def hook_hash(path_token: str) -> str:
    return hashlib.sha256(path_token.encode("utf-8")).hexdigest()


def external_lead_id(kind: str, external_id: str) -> str:
    return "cal:" + hashlib.sha256(f"{kind}|{external_id}".encode()).hexdigest()[:32]


class CalendarInService:
    def __init__(self, repo: CalendarInRepository, vault: ConnectorVault, scheduler: TokenSource, *, calendly: CalendlyApi, microsoft: MicrosoftApi | None, signer: StateSigner | None,
                 public_base_url: str, web_base_url: str, leads: LeadBridge | None = None, clock: Callable[[], float] = time.time) -> None:
        self.repo, self.vault, self.scheduler = repo, vault, scheduler
        self.calendly, self.microsoft, self.signer = calendly, microsoft, signer
        self.base = public_base_url.rstrip("/")
        self._web = web_base_url.rstrip("/")
        self.leads = leads
        self._clock = clock
        self.redirect_uri = self.base + CALLBACK_PATH

    def __repr__(self) -> str:
        return "CalendarInService(<configured>)"

    def with_leads(self, lead_sources: Any) -> CalendarInService:
        """The runtime's lead intake, bound at the first request (the service is built before it is known here)."""
        if self.leads is None and lead_sources is not None:
            self.leads = IntakeBridge(lead_sources)
        return self

    # ---- the cards
    def connections(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        rows = {str(r.get("kind")): r for r in self.repo.connections(token, tenant_id)}
        items = []
        for kind in KINDS:
            row = rows.get(kind)
            if row is None:
                items.append({"kind": kind, "name": NAMES[kind], "state": "needs_setup" if kind == "outlook" and self.microsoft is None else "not_connected", "label": None, "last4": None,
                              "booking_link": None, "share_link": False, "consent_question": None, "write_events": None, "block_busy": None, "health": None, "last_event_at": None,
                              "last_synced_at": None, "last_error_code": None, "counts_30d": {"booked": 0, "cancelled": 0, "needs_person": 0}})
                continue
            health = "needs_reconnect" if row.get("status") == "needs_reconnect" else ("attention" if row.get("last_error_code") else "ok")
            items.append({"kind": kind, "name": NAMES[kind], "state": "connected", **{k: row.get(k) for k in ("label", "last4", "booking_link", "share_link", "consent_question", "write_events", "block_busy", "last_event_at", "last_synced_at", "last_error_code", "counts_30d")}, "health": health})
        return {"items": items}

    def needs_person(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"items": self.repo.needs_person(token, tenant_id, 20)}

    def _hook_url(self, path_token: str, kind: str) -> str:
        if not (self.base.startswith("https://") or (self.base.startswith("http://localhost") and "localhost" in self.base)):
            raise ApiError(*NO_ADDRESS)
        return f"{self.base}{HOOK_PATH}/{kind}/{path_token}"

    def _lead_secret(self, token: str, tenant_id: uuid.UUID, kind: str, existing: dict[str, Any] | None) -> str:
        if existing and isinstance(existing.get("lead_secret"), str):
            return str(existing["lead_secret"])
        if self.leads is None:
            raise ApiError(*NEEDS_SETUP)
        return self.leads.create_source(token, tenant_id, f"{NAMES[kind]} bookings")

    # ---- Calendly: we make the webhook subscription with the owner's personal access token
    def connect_calendly(self, token: str, tenant_id: uuid.UUID, access_token: str, booking_link: str | None) -> dict[str, Any]:
        link = clean_link("calendly", booking_link) if (booking_link or "").strip() else None
        if (booking_link or "").strip() and link is None:
            raise ApiError(*LINK_INVALID)
        old_ref = self._old_ref(token, tenant_id, "calendly")
        path_token, key = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        try:
            user = self.calendly.me(access_token)
            ref = self.calendly.subscribe(access_token, self._hook_url(path_token, "calendly"), user, key)
        except VendorError as exc:
            raise (ApiError(*PLAN_REFUSED) if exc.code == "plan" else ApiError(*KEY_REFUSED) if exc.code == "refused" else ApiError(*VENDOR_DOWN)) from None
        existing = self.vault.get(tenant_id, "calendly")
        try:
            lead_secret = self._lead_secret(token, tenant_id, "calendly", existing)
            self.vault.put(tenant_id, "calendly", {"pat": access_token, "signing_key": key, "lead_secret": lead_secret})
            row = self.repo.save(token, tenant_id, "calendly", "Calendly", tail(access_token) or None, link or clean_link("calendly", user.scheduling_url), hook_hash(path_token), ref)
        except (SecretStoreError, ValueError):
            self._quiet_unsubscribe(access_token, ref)
            raise ApiError(*SECRETS_DOWN) from None
        except Exception:
            self._quiet_unsubscribe(access_token, ref)
            raise
        if old_ref and existing and isinstance(existing.get("pat"), str):
            self._quiet_unsubscribe(str(existing["pat"]), old_ref)   # the subscription this one replaces
        return {"connection": row}

    def _old_ref(self, token: str, tenant_id: uuid.UUID, kind: str) -> str | None:
        try:
            ref = self.repo.ref(token, tenant_id, kind).get("hook_ref")
        except NotConnectedError:
            return None
        return ref if isinstance(ref, str) else None

    def _quiet_unsubscribe(self, access_token: str, ref: str) -> None:
        try:
            self.calendly.unsubscribe(access_token, ref)
        except VendorError as exc:
            logger.info("calendly: subscription not removed: %s", exc.code)

    # ---- Cal.com: the owner pastes our address and the secret into Cal.com (Settings, Developer, Webhooks)
    def connect_calcom(self, token: str, tenant_id: uuid.UUID, booking_link: str | None, label: str | None) -> dict[str, Any]:
        link = clean_link("calcom", booking_link) if (booking_link or "").strip() else None
        if (booking_link or "").strip() and link is None:
            raise ApiError(*LINK_INVALID)
        path_token, secret = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        url = self._hook_url(path_token, "calcom")
        try:
            existing = self.vault.get(tenant_id, "calcom")
            lead_secret = self._lead_secret(token, tenant_id, "calcom", existing)
            self.vault.put(tenant_id, "calcom", {"secret": secret, "lead_secret": lead_secret})
        except (SecretStoreError, ValueError):
            raise ApiError(*SECRETS_DOWN) from None
        row = self.repo.save(token, tenant_id, "calcom", (label or "Cal.com").strip()[:80] or "Cal.com", tail(secret) or None, link, hook_hash(path_token), None)
        return {"connection": row, "setup": {"webhook_url": url, "secret": secret, "triggers": ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"],
                                             "steps": ["In Cal.com open Settings, Developer, Webhooks and choose New.", "Paste the address as the subscriber URL.", "Tick Booking created, Booking cancelled and Booking rescheduled.",
                                                       "Paste the secret into the Secret field. It is shown only now; connect again to make a new one.", "Save, then book a test time on your page."]}}

    def settings(self, token: str, tenant_id: uuid.UUID, kind: str, *, booking_link: str | None, share_link: bool | None, write_events: bool | None, block_busy: bool | None, consent_question: str | None) -> dict[str, Any]:
        link: str | None = None
        if booking_link is not None:
            link = clean_link(kind, booking_link) if booking_link.strip() else ""
            if link is None:
                raise ApiError(*LINK_INVALID)
        return {"connection": self.repo.settings(token, tenant_id, kind, link, share_link, write_events, block_busy, consent_question)}

    def disconnect(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        ref = self.repo.ref(token, tenant_id, kind)
        secret = self.vault.get(tenant_id, kind)
        if kind == "calendly" and secret and isinstance(secret.get("pat"), str) and isinstance(ref.get("hook_ref"), str):
            self._quiet_unsubscribe(str(secret["pat"]), str(ref["hook_ref"]))
        done = self.repo.disconnect(token, tenant_id, kind)   # the database first: the door stops answering at once
        try:
            self.vault.delete(tenant_id, kind)
        except SecretStoreError:
            logger.warning("calendar: the key store could not delete a key")
        return {"disconnected": bool(done.get("disconnected")), "events_kept": kind == "outlook"}

    # ---- Outlook
    def outlook_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        if self.microsoft is None or self.signer is None:
            raise ApiError(*NEEDS_SETUP)
        started = self.repo.outlook_start(token, tenant_id)
        nonce, member = uuid.UUID(str(started["nonce"])), uuid.UUID(str(started["member_id"]))
        state = self.signer.sign(tenant_id, member, nonce)
        url = self.microsoft.authorize_url(state=state, code_challenge=code_challenge(self.signer.code_verifier(nonce)), redirect_uri=self.redirect_uri)
        return {"authorize_url": url, "expires_at": started.get("expires_at")}

    def back(self, tenant_id: uuid.UUID | None, result: str) -> str:
        page = f"/app/tenants/{tenant_id}/connectors" if tenant_id else "/app"
        return self._web + page + "?" + urllib.parse.urlencode({"calendar_outlook": result})

    def outlook_callback(self, code: str | None, state: str | None, error: str | None) -> str:
        """The address the browser is sent to afterwards, with a closed result word: connected, denied, expired, missing_scope, error, invalid, needs_setup."""
        if self.microsoft is None or self.signer is None:
            return self.back(None, "needs_setup")
        parsed = self.signer.verify(state or "")
        if parsed is None:
            return self.back(None, "invalid")
        sched = self.scheduler.token()
        try:
            self.repo.state_use(sched, parsed.nonce, parsed.tenant_id, parsed.member_id)
        except (LinkStateError, Forbidden):
            return self.back(parsed.tenant_id, "expired")
        if error or not code:
            return self.back(parsed.tenant_id, "denied")
        try:
            grant = self.microsoft.exchange_code(code, self.signer.code_verifier(parsed.nonce), self.redirect_uri)
        except MicrosoftError as exc:
            logger.info("outlook: code not exchanged: %s", exc.code)
            return self.back(parsed.tenant_id, "error")
        if not {s.rsplit("/", 1)[-1].lower() for s in SCOPES} <= {s.rsplit("/", 1)[-1].lower() for s in grant.scopes}:
            return self.back(parsed.tenant_id, "missing_scope")   # nothing is kept
        try:
            self.vault.put(parsed.tenant_id, OUTLOOK, {"refresh_token": grant.refresh_token})
        except (SecretStoreError, ValueError):
            return self.back(parsed.tenant_id, "error")
        self.repo.outlook_connected(sched, parsed.tenant_id, parsed.member_id, tail(grant.refresh_token) or None)
        logger.info("outlook connected")
        return self.back(parsed.tenant_id, "connected")

    # ---- the vendors' webhook door (public)
    def receive(self, kind: str, path_token: str, raw: bytes, headers: dict[str, str]) -> str:
        """A closed outcome word for the log (booked, cancelled, needs_person, duplicate, ignored, bad_signature, unknown, malformed, unavailable). The route answers 200 for everything understood, ignored or
        repeated, 401 for a signature that does not check, 404 for an address we do not know, 503 when OUR side failed (so the vendor retries)."""
        if kind not in SIGNATURE_HEADER or not 20 <= len(path_token) <= 80:
            return "unknown"
        sched = self.scheduler.token()
        door = self.repo.hook(sched, hook_hash(path_token))
        if not door or door.get("kind") != kind:
            return "unknown"
        tenant = uuid.UUID(str(door["tenant_id"]))
        secret = self.vault.get(tenant, kind)
        key = (secret or {}).get("signing_key" if kind == "calendly" else "secret")
        if not isinstance(key, str):
            return "unavailable"
        header = headers.get(SIGNATURE_HEADER[kind])
        ok = bookings.verify_calendly(raw, header, key, now=self._clock()) if kind == "calendly" else bookings.verify_calcom(raw, header, key)
        if not ok:
            return "bad_signature"
        question = door.get("consent_question") if isinstance(door.get("consent_question"), str) else None
        booking = bookings.parse(kind, raw, question)
        if booking is None:
            return "ignored"
        return self._apply(sched, tenant, booking, (secret or {}).get("lead_secret"))

    def _apply(self, sched: str, tenant: uuid.UUID, b: Booking, lead_secret: Any) -> str:
        if b.action == "cancelled":
            done = self.repo.booking_cancel(sched, tenant, b.kind, b.external_id, b.starts_at, b.ends_at)
            return "duplicate" if done.get("replayed") else "cancelled"
        if b.replaces:   # moved on the vendor's page: the old booking goes first
            self.repo.booking_cancel(sched, tenant, b.kind, b.replaces, None, None)
        if isinstance(lead_secret, str) and self.leads is not None and (b.phone or b.email):
            row: dict[str, Any] = {"external_id": external_lead_id(b.kind, b.external_id)}
            for k, v in (("name", b.name), ("phone", b.phone), ("email", b.email), ("message", f"Booked: {b.purpose}" if b.purpose else "Booked a time on the booking page")):
                if v:
                    row[k] = v
            if b.consent_text and b.consent_at:
                row.update({"consent": "yes", "consent_text": b.consent_text, "consent_at": b.consent_at, "consent_form": f"{NAMES[b.kind]} booking form"})
            try:
                self.leads.receive(lead_secret, row)
            except ApiError as exc:
                if exc.status_code == 429:
                    return "unavailable"   # the intake is busy: the vendor retries
                logger.info("calendar: the lead was not stored (%s)", exc.status_code)
        done = self.repo.booking_apply(sched, tenant, b.kind, b.external_id, b.phone, b.email, b.starts_at, b.ends_at, b.purpose)
        if done.get("replayed"):
            return "duplicate"
        return "booked" if done.get("state") == "booked" else "needs_person"

    # ---- what the assistant may say
    def booking_link(self, tenant_id: uuid.UUID) -> dict[str, str] | None:
        """The booking-link fact for the fact pack (None unless the owner turned "share my booking link" on and saved an address)."""
        got = self.repo.booking_link(self.scheduler.token(), tenant_id)
        if not got or not isinstance(got.get("url"), str):
            return None
        return booking_link_fact(str(got["url"]), str(got.get("kind") or "calendly"))
