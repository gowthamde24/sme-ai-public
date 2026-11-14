"""What the API's routes do (routes.py): the Owner's connect / settings / disconnect, everyone's status, the OAuth callback and Google's push notification (the two public doors act as the registered
scheduler account). Tokens never leave this module except into Secret Manager (vault.py) and to Google."""

# ruff: noqa: E501

from __future__ import annotations

import hmac
import logging
import urllib.parse
import uuid
from typing import Any, Protocol

from app.google_calendar.google import SCOPES, GoogleApi, GoogleError
from app.google_calendar.repository import GoogleCalendarRepository, LinkStateError
from app.google_calendar.state import StateSigner, code_challenge
from app.google_calendar.sync import forget_at_google
from app.google_calendar.vault import LinkSecret, Vault
from app.tenancy.repository import Forbidden

logger = logging.getLogger("app.google_calendar.service")

CALLBACK_PATH = "/v1/integrations/google-calendar/callback"


class TokenSource(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


class GoogleCalendarService:
    def __init__(self, repo: GoogleCalendarRepository, google: GoogleApi, vault: Vault, signer: StateSigner, scheduler: TokenSource, *, public_base_url: str, web_base_url: str) -> None:
        self.repo = repo
        self.google = google
        self.vault = vault
        self.signer = signer
        self.scheduler = scheduler
        self.redirect_uri = public_base_url.rstrip("/") + CALLBACK_PATH
        self._web = web_base_url.rstrip("/")

    def __repr__(self) -> str:
        return "GoogleCalendarService(<configured>)"

    # ---- the people's side
    def status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"configured": True, **self.repo.status(token, tenant_id)}

    def connect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        started = self.repo.connect_start(token, tenant_id)   # Owner, second factor: the database checks both
        nonce, member = uuid.UUID(str(started["nonce"])), uuid.UUID(str(started["member_id"]))
        state = self.signer.sign(tenant_id, member, nonce)
        url = self.google.authorize_url(state=state, code_challenge=code_challenge(self.signer.code_verifier(nonce)), redirect_uri=self.redirect_uri)
        return {"authorize_url": url, "expires_at": started.get("expires_at")}

    def _access_for(self, secret_name: str) -> str | None:
        secret = self.vault.get(secret_name)
        if secret is None:
            return None
        return self.google.access_token(secret.refresh_token)

    def _stop(self, token: str, tenant_id: uuid.UUID, stop: Any) -> None:
        """Best effort: a channel Google keeps sending to is ignored by the push door anyway (it is no longer ours)."""
        if not isinstance(stop, dict) or not stop.get("channel_id") or not stop.get("channel_resource_id"):
            return
        try:
            access = self._access_for(str(self.repo.ref(token, tenant_id)["secret_name"]))
            if access:
                self.google.stop_channel(access, str(stop["channel_id"]), str(stop["channel_resource_id"]))
        except Exception as exc:   # noqa: BLE001 - only the class (or Google's closed code) is logged
            logger.info("google calendar: channel not stopped: %s", getattr(exc, "code", exc.__class__.__name__))

    def settings(self, token: str, tenant_id: uuid.UUID, write_events: bool, block_busy: bool) -> dict[str, Any]:
        result = self.repo.settings_set(token, tenant_id, write_events, block_busy)
        self._stop(token, tenant_id, result.pop("stop_channel", None))
        return {"configured": True, **result}

    def sync_now(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        result = self.repo.sync_now(token, tenant_id)
        return {"configured": True, **result}

    def disconnect(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """Revoke at Google, stop the channel, delete OUR copy of the token; then the database forgets the link, the busy blocks and the event links. Events already in the calendar stay."""
        ref = self.repo.ref(token, tenant_id)
        forget_at_google(self.google, self.vault, str(ref["secret_name"]), ref.get("channel_id"), ref.get("channel_resource_id"))
        done = self.repo.disconnect(token, tenant_id)
        return {"configured": True, **self.repo.status(token, tenant_id), "disconnected": bool(done.get("disconnected")), "events_kept": True}

    # ---- the OAuth callback (public: Google sends the browser here)
    def back(self, tenant_id: uuid.UUID | None, result: str) -> str:
        page = f"/app/tenants/{tenant_id}/integrations/google-calendar" if tenant_id else "/app"
        return self._web + page + "?" + urllib.parse.urlencode({"google_calendar": result})

    def callback(self, code: str | None, state: str | None, error: str | None) -> str:
        """The address the browser is sent to afterwards, with a closed result word: connected, denied, expired, missing_scope, error, invalid."""
        parsed = self.signer.verify(state or "")
        if parsed is None:
            return self.back(None, "invalid")
        sched = self.scheduler.token()
        try:
            used = self.repo.state_use(sched, parsed.nonce, parsed.tenant_id, parsed.member_id)
        except (LinkStateError, Forbidden):
            return self.back(parsed.tenant_id, "expired")
        if error or not code:
            return self.back(parsed.tenant_id, "denied")
        try:
            grant = self.google.exchange_code(code, self.signer.code_verifier(parsed.nonce), self.redirect_uri)
        except GoogleError as exc:
            logger.info("google calendar: code not exchanged: %s", exc.code)
            return self.back(parsed.tenant_id, "error")
        if not set(SCOPES) <= grant.scopes:   # the person unticked a permission on Google's screen: nothing is kept
            try:
                self.google.revoke(grant.refresh_token)
            except GoogleError:
                pass
            return self.back(parsed.tenant_id, "missing_scope")
        name = str(used["secret_name"])
        old = self.vault.get(name)
        if old is not None and not hmac.compare_digest(old.refresh_token, grant.refresh_token):
            try:
                self.google.revoke(old.refresh_token)   # a reconnect: the grant it replaces is withdrawn at Google too
            except GoogleError as exc:
                logger.info("google calendar: old token not revoked: %s", exc.code)
        self.vault.put(name, LinkSecret(grant.refresh_token, self.vault.new_channel_token()))
        linked = self.repo.connected(sched, parsed.tenant_id, parsed.member_id, self.vault.fingerprint(parsed.tenant_id, grant.refresh_token))
        stop = linked.get("stop_channel")
        if isinstance(stop, dict) and stop.get("channel_id") and stop.get("channel_resource_id"):
            try:
                self.google.stop_channel(grant.access_token, str(stop["channel_id"]), str(stop["channel_resource_id"]))
            except GoogleError as exc:
                logger.info("google calendar: old channel not stopped: %s", exc.code)
        logger.info("google calendar connected")
        return self.back(parsed.tenant_id, "connected")

    # ---- Google's push notification (public: Google calls it; no body, only headers)
    def push(self, channel_id: str | None, channel_token: str | None, resource_id: str | None, resource_state: str | None) -> str:
        """A closed outcome word (for the log line): sync, accepted, unknown, mismatch, malformed. Every outcome is answered the same way to Google."""
        if resource_state == "sync":
            return "sync"   # the channel's first message: acknowledged, nothing to do
        try:
            cid = uuid.UUID(str(channel_id or ""))
        except ValueError:
            return "malformed"
        if not channel_token or not resource_id or len(channel_token) > 256 or len(resource_id) > 256:
            return "malformed"
        sched = self.scheduler.token()
        found = self.repo.channel_lookup(sched, cid)
        if not found:
            return "unknown"
        secret = self.vault.get(str(found["secret_name"]), cached=True)
        token_ok = secret is not None and hmac.compare_digest(secret.channel_token.encode(), channel_token.encode())
        resource_ok = hmac.compare_digest(str(found.get("channel_resource_id") or "").encode(), resource_id.encode())
        if not (token_ok and resource_ok):
            return "mismatch"
        self.repo.busy_request(sched, uuid.UUID(str(found["tenant_id"])))
        return "accepted"
