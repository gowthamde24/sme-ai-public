"""Builds the lead sources from settings (job DR / A2). Everything optional is off by default. The registered worker account (the same SCHEDULER_EMAIL / SCHEDULER_PASSWORD the webhooks use) is
how the public doors reach the database; without it the doors answer "not available". A provider that is named without what it needs stops the process at start."""

from __future__ import annotations

import httpx

from app.config import ConfigurationError, Settings
from app.lead_sources.dnd import DndLookup, FakeDnd
from app.lead_sources.meta import FakeMetaFetcher, GraphLeadFetcher, MetaLeadFetcher
from app.lead_sources.repository import PostgrestLeadSourcesRepository
from app.lead_sources.resend_inbound import ResendInbound, ResendMailFetcher
from app.lead_sources.service import LeadSourcesService
from app.lead_sources.sheets import HttpSheetFetcher
from app.scheduler.session import PrincipalSession
from app.suppression.keys import KeyRing


def build_lead_sources(settings: Settings, rest_url: str, auth_url: str, anon_key: str, key_ring: KeyRing | None) -> LeadSourcesService:
    dnd: DndLookup | None = None
    if settings.lead_dnd_provider == "fake":
        if not settings.is_development:
            raise ConfigurationError("LEAD_DND_PROVIDER=fake is for development only")
        dnd = FakeDnd()
    elif settings.lead_dnd_provider != "off":
        raise ConfigurationError("LEAD_DND_PROVIDER must be off or fake")
    meta: MetaLeadFetcher | None = None
    app_secret = settings.meta_app_secret.get_secret_value() if settings.meta_app_secret else None
    if settings.meta_lead_provider == "fake":
        if not settings.is_development:
            raise ConfigurationError("META_LEAD_PROVIDER=fake is for development only")
        meta, app_secret = FakeMetaFetcher(), app_secret or "development-meta-secret"
    elif settings.meta_lead_provider == "graph":
        token = settings.meta_page_token.get_secret_value() if settings.meta_page_token else ""
        if not app_secret or not token:
            raise ConfigurationError("META_APP_SECRET and META_PAGE_TOKEN are required for META_LEAD_PROVIDER=graph")
        meta = GraphLeadFetcher(token)
    elif settings.meta_lead_provider != "off":
        raise ConfigurationError("META_LEAD_PROVIDER must be off, fake or graph")
    receiver: PrincipalSession | None = None
    if settings.scheduler_email and settings.scheduler_password and settings.scheduler_password.get_secret_value():
        receiver = PrincipalSession(auth_url, anon_key, settings.scheduler_email, settings.scheduler_password.get_secret_value(), client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))
    resend: ResendInbound | None = None
    leads_key = settings.lead_resend_api_key.get_secret_value() if settings.lead_resend_api_key else ""
    signing = settings.lead_resend_webhook_secret.get_secret_value() if settings.lead_resend_webhook_secret else ""
    if bool(leads_key) != bool(signing):
        raise ConfigurationError("LEAD_RESEND_API_KEY and LEAD_RESEND_WEBHOOK_SECRET are set together or not at all")
    if leads_key and signing:
        resend = ResendInbound(signing, ResendMailFetcher(leads_key))
    base = (settings.public_base_url or "").strip().rstrip("/") or None
    return LeadSourcesService(
        PostgrestLeadSourcesRepository(rest_url, anon_key),
        sheets=HttpSheetFetcher(),
        dnd=dnd,
        key_ring=key_ring,
        receiver=receiver,
        meta=meta,
        meta_app_secret=app_secret,
        resend=resend,
        inbound_domain=settings.lead_inbound_domain,
        inbound_secret=settings.lead_inbound_secret.get_secret_value() if settings.lead_inbound_secret else None,
        public_base_url=base,
        service_account_email=settings.google_sheets_service_account_email,
        indiamart_available=settings.indiamart_provider != "off",
    )
