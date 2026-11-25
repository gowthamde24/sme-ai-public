"""Builds the calendars-in service (API) and the Outlook pass (worker) from settings. None unless CALENDAR_IN=on (the kill switch: every route answers 404 and the worker does nothing).

Needs: WORKSPACE_SECRETS (the keys live in the workspace-secrets store), the scheduler account (SCHEDULER_EMAIL / SCHEDULER_PASSWORD: the webhook door, the OAuth callback and the worker act as it) and
PUBLIC_BASE_URL (the address the vendors post to and Microsoft sends the browser back to). Outlook also needs the Microsoft OAuth app the Stack19 owner registers (MICROSOFT_OAUTH_CLIENT_ID and _SECRET):
without it Calendly and Cal.com work and the Outlook card says "Needs setup by us"."""

# ruff: noqa: E501

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.calendar_in.microsoft import HttpMicrosoft, MicrosoftApi
from app.calendar_in.repository import PostgrestCalendarInRepository
from app.calendar_in.service import CalendarInService
from app.calendar_in.sync import OutlookSync
from app.calendar_in.vendors import HttpCalendly
from app.config import Settings
from app.connector_vault import ConnectorVault
from app.google_calendar.state import StateSigner
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore

logger = logging.getLogger("app.calendar_in.wiring")


def _microsoft(settings: Settings) -> tuple[MicrosoftApi, bytes] | None:
    cid = settings.microsoft_oauth_client_id.get_secret_value().strip() if settings.microsoft_oauth_client_id else ""
    secret = settings.microsoft_oauth_client_secret.get_secret_value().strip() if settings.microsoft_oauth_client_secret else ""
    if cid and secret:
        return HttpMicrosoft(cid, secret), b"outlook|" + secret.encode("utf-8")
    return None


def _store(settings: Settings, shared: Any = None) -> SecretStore | None:
    if shared is not None and getattr(shared, "store", None) is not None:
        return shared.store  # type: ignore[no-any-return]
    mode = (settings.workspace_secrets or "off").strip().lower()
    if mode == "fake" and settings.is_development:
        return FakeSecretStore()
    if mode == "gcp":
        try:
            return GcpSecretStore(settings.workspace_secrets_project or "")
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


def build_calendar_in(settings: Settings, rest_url: str, supabase_url: str, anon_key: str, workspace_secrets: Any = None) -> CalendarInService | None:
    if settings.calendar_in != "on":
        return None
    store, scheduler = _store(settings, workspace_secrets), _scheduler(settings, supabase_url, anon_key)
    base, web = (settings.public_base_url or "").strip().rstrip("/"), _web_base(settings)
    missing = [n for n, v in (("WORKSPACE_SECRETS", store), ("SCHEDULER_ACCOUNT", scheduler), ("PUBLIC_BASE_URL", base), ("PUBLIC_WEB_BASE_URL", web)) if not v]
    if missing:
        logger.warning("CALENDAR_IN is on but stays off: %s missing", ", ".join(missing))
        return None
    assert store is not None  # noqa: S101
    ms = _microsoft(settings)
    return CalendarInService(PostgrestCalendarInRepository(rest_url, anon_key), ConnectorVault(store), scheduler, calendly=HttpCalendly(), microsoft=ms[0] if ms else None,
                             signer=StateSigner(ms[1]) if ms else None, public_base_url=base, web_base_url=web)


def build_outlook_sync(settings: Settings, rest_url: str, anon_key: str, workspace_secrets: Any = None) -> OutlookSync | None:
    """The worker's pass (the worker signs in as the scheduler account itself)."""
    if settings.calendar_in != "on":
        return None
    ms, store = _microsoft(settings), _store(settings, workspace_secrets)
    if ms is None or store is None:
        return None
    return OutlookSync(PostgrestCalendarInRepository(rest_url, anon_key), ms[0], ConnectorVault(store))
