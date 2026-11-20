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
    # W3: Embedded Signup. Public ids (not secrets); with both set the "Connect WhatsApp" step is available.
    app_id: str | None = None
    config_id: str | None = None
    embedded_version: str = "v5"   # the Embedded Signup version of the configuration (v4: featureType opt-in; v5: coexistence on by default)
    graph_version: str = "v25.0"
    auto_templates: bool = True   # after "Connect WhatsApp" worked, our templates go to that account for review (the owner's standing OK, 19 Nov 2026); WHATSAPP_AUTO_TEMPLATES=false is the kill switch
