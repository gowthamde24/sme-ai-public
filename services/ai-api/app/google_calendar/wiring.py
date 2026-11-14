"""Builds the Google Calendar service (API) and sync pass (worker) from settings. Anything missing: None, and the feature answers not_configured; the rest of the app is unaffected.

Needs: the OAuth client (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET) or, in development only, GOOGLE_CALENDAR_FAKE=true; WORKSPACE_SECRETS=gcp (or fake) for the token; the scheduler account
(SCHEDULER_EMAIL / SCHEDULER_PASSWORD) for the public doors and the worker; PUBLIC_BASE_URL (the callback and the push address); the web's address (PUBLIC_WEB_BASE_URL, else the first API_CORS_ORIGINS)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import Settings
from app.google_calendar.fake import FakeGoogle
from app.google_calendar.google import GoogleApi, HttpGoogle
from app.google_calendar.repository import GoogleCalendarRepository
from app.google_calendar.service import GoogleCalendarService
from app.google_calendar.state import StateSigner
from app.google_calendar.sync import GoogleCalendarSync
from app.google_calendar.vault import Vault
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore

logger = logging.getLogger("app.google_calendar.wiring")
FAKE_CLIENT_SECRET = b"fake-google-client-secret-for-local-development"   # the fake Google's state key (development only)


def _google(settings: Settings) -> tuple[GoogleApi, bytes] | None:
    cid = settings.google_oauth_client_id.get_secret_value().strip() if settings.google_oauth_client_id else ""
    secret = settings.google_oauth_client_secret.get_secret_value().strip() if settings.google_oauth_client_secret else ""
    if cid and secret:
        return HttpGoogle(cid, secret), secret.encode("utf-8")
    if settings.google_calendar_fake and settings.is_development:
        return FakeGoogle(), FAKE_CLIENT_SECRET
    return None


def _store(settings: Settings, shared: Any = None) -> tuple[SecretStore, bytes] | None:
    mode = (settings.workspace_secrets or "off").strip().lower()
    key = settings.suppression_hmac_key.get_secret_value().encode("utf-8") if settings.suppression_hmac_key else b""
    if shared is not None and getattr(shared, "store", None) is not None:
        return shared.store, key or b"local-fingerprint-key"
    if mode == "fake":
        return FakeSecretStore(), key or b"local-fingerprint-key"
    if mode == "gcp" and key:
        try:
            return GcpSecretStore(settings.workspace_secrets_project or ""), key
        except ValueError:
            return None
    return None


def _scheduler(settings: Settings, supabase_url: str, anon_key: str) -> Any:
    password = settings.scheduler_password.get_secret_value() if settings.scheduler_password else ""
    if not settings.scheduler_email or not password:
        return None
    from app.scheduler.session import PrincipalSession

    return PrincipalSession(f"{supabase_url}/auth/v1", anon_key, settings.scheduler_email, password, client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))


def _web_base(settings: Settings) -> str:
    explicit = (settings.public_web_base_url or "").strip().rstrip("/")
    if explicit:
        return explicit
    origins = [o.strip().rstrip("/") for o in (settings.api_cors_origins or "").split(",") if o.strip()]
    if origins:
        return origins[0]
    return "http://localhost:3000" if settings.is_development else ""


def _missing(**parts: object) -> list[str]:
    return [name for name, value in parts.items() if not value]


def build_google_calendar(settings: Settings, rest_url: str, supabase_url: str, anon_key: str, workspace_secrets: Any = None) -> GoogleCalendarService | None:
    google = _google(settings)
    store = _store(settings, workspace_secrets)
    scheduler = _scheduler(settings, supabase_url, anon_key)
    base = (settings.public_base_url or "").strip().rstrip("/")
    web = _web_base(settings)
    base_ok = base.startswith("https://") or (settings.is_development and base.startswith("http://"))
    missing = _missing(GOOGLE_OAUTH_CLIENT=google, WORKSPACE_SECRETS=store, SCHEDULER_ACCOUNT=scheduler, PUBLIC_BASE_URL=base_ok, PUBLIC_WEB_BASE_URL=web)
    if missing:
        if google is not None:   # only worth a line when someone meant to switch it on
            logger.warning("google calendar stays off: %s missing", ", ".join(missing))
        return None
    assert google is not None and store is not None  # noqa: S101
    return GoogleCalendarService(GoogleCalendarRepository(rest_url, anon_key), google[0], Vault(store[0], store[1]), StateSigner(google[1]), scheduler,
                                 public_base_url=base, web_base_url=web)


def build_google_calendar_sync(settings: Settings, rest_url: str, anon_key: str) -> GoogleCalendarSync | None:
    """The worker's pass (the worker signs in as the scheduler account itself)."""
    google = _google(settings)
    store = _store(settings)
    if google is None or store is None:
        if google is not None:
            logger.warning("google calendar sync stays off: WORKSPACE_SECRETS missing")
        return None
    return GoogleCalendarSync(GoogleCalendarRepository(rest_url, anon_key), google[0], Vault(store[0], store[1]), public_base_url=settings.public_base_url)
