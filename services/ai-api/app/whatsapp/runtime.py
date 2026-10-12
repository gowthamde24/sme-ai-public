"""What the WhatsApp feature needs at run time, in one object (job BR). Secrets are fields that never appear in a repr or a log line."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.whatsapp.graph import GraphClient
from app.whatsapp.ingest import WhatsAppIngest
from app.whatsapp.repository import WhatsAppRepository
from app.whatsapp.tokens import TokenResolver


@dataclass(frozen=True)
class WhatsAppRuntime:
    repository: WhatsAppRepository
    # None until CHANNEL_AGENT_EMAIL / CHANNEL_AGENT_PASSWORD are set: the webhook then answers "not configured"
    ingest: WhatsAppIngest | None = None
    app_secret: str | None = field(default=None, repr=False)
    verify_token: str | None = field(default=None, repr=False)
    # None until a token is set: asking Meta to review a template then answers "not configured"
    graph: GraphClient | None = None
    tokens: TokenResolver = field(default_factory=TokenResolver, repr=False)
