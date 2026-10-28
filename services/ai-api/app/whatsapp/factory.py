"""Builds the real WhatsApp adapter from settings, or refuses to start (OUTBOX_ADAPTER=whatsapp without a token is a mistake, not a fallback to the fake)."""

from __future__ import annotations

from typing import Any

from app.outbox.adapter import ChannelAdapter
from app.whatsapp.adapter import WhatsAppCloudAdapter, allow_list
from app.whatsapp.graph import GraphClient
from app.whatsapp.tokens import TokenResolver


def token_resolver(settings: Any) -> TokenResolver:
    default = settings.whatsapp_access_token.get_secret_value() if settings.whatsapp_access_token else None
    tokens = settings.whatsapp_access_tokens.get_secret_value() if settings.whatsapp_access_tokens else None
    return TokenResolver.from_settings(default, tokens)


def build_whatsapp_adapter(settings: Any) -> ChannelAdapter:
    if settings is None:
        raise ValueError("OUTBOX_ADAPTER=whatsapp needs the WHATSAPP_* settings")
    tokens = token_resolver(settings)
    if not tokens.any():
        raise ValueError("OUTBOX_ADAPTER=whatsapp needs WHATSAPP_ACCESS_TOKEN or WHATSAPP_ACCESS_TOKENS")
    if not settings.whatsapp_api_base.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        raise ValueError("WHATSAPP_API_BASE must be https (or a local fake server)")
    return WhatsAppCloudAdapter(GraphClient(settings.whatsapp_api_base, settings.whatsapp_graph_version), tokens, allow_list(settings.whatsapp_allowed_recipients))
