"""What the routes and the worker pass share: the repository, the place the signing secrets live (Secret Manager through the workspace-secrets store: `sme-ws-<workspace>-whsec-<endpoint>`) and the
address check (with an injectable resolver, for the tests)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid

from app.webhooks_out import ssrf
from app.webhooks_out.repository import WebhooksRepository
from app.workspace_secrets import SecretStore

EVENTS = ("call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome")
EVENT_WORDS = {
    "call.completed": "A call ended and was answered: its outcome, summary, what was captured, duration and cost.",
    "call.missed": "A call that nobody answered (an outgoing call with no answer, busy or voicemail, or an incoming call that was missed).",
    "lead.created": "A new lead.",
    "lead.updated": "A lead changed status, source, owner or contact, or was archived.",
    "job.outcome": "The outcome of a call or follow-up was recorded or corrected.",
}


def secret_name(tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> str:
    return f"sme-ws-{tenant_id}-whsec-{endpoint_id}"


class WebhooksOut:
    def __init__(self, repo: WebhooksRepository, store: SecretStore | None, *, resolver: ssrf.Resolver = ssrf.system_resolver) -> None:
        self.repo = repo
        self.store = store
        self.resolver = resolver

    def validate_url(self, url: str) -> None:
        ssrf.validate(url, self.resolver)
