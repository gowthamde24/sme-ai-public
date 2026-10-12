"""Wires the WhatsApp feature from settings (job BR). Everything optional: with nothing set, the routes of a business still work against the database (the account page, templates, the inbox), the
webhook answers 503, and no message leaves (OUTBOX_ADAPTER stays `fake`)."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import Settings
from app.scheduler.session import PrincipalSession
from app.suppression.keys import KeyRing
from app.whatsapp.factory import token_resolver
from app.whatsapp.graph import GraphClient
from app.whatsapp.ingest import WhatsAppIngest
from app.whatsapp.repository import PostgrestWhatsAppRepository
from app.whatsapp.runtime import WhatsAppRuntime


def build_whatsapp(settings: Settings, config: Any, key_ring: KeyRing | None = None) -> WhatsAppRuntime:
    repository = PostgrestWhatsAppRepository(config.rest_url, config.anon_key)
    tokens = token_resolver(settings)
    ingest = None
    if settings.channel_agent_email and settings.channel_agent_password and key_ring is not None:
        session = PrincipalSession(
            f"{config.supabase_url}/auth/v1",
            config.anon_key,
            settings.channel_agent_email,
            settings.channel_agent_password.get_secret_value(),
            client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)),
        )
        ingest = WhatsAppIngest(repository, session, key_ring)
    return WhatsAppRuntime(
        repository=repository,
        ingest=ingest,
        app_secret=settings.whatsapp_app_secret.get_secret_value() if settings.whatsapp_app_secret else None,
        verify_token=settings.whatsapp_verify_token.get_secret_value() if settings.whatsapp_verify_token else None,
        graph=GraphClient(settings.whatsapp_api_base, settings.whatsapp_graph_version) if tokens.any() else None,
        tokens=tokens,
    )
