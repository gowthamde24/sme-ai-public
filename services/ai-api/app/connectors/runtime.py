"""What the connectors need at run time, wired from settings (job BZ). Everything is optional: a connector whose provider is not named is simply absent (its routes answer "not available")."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.connectors.calls import CallBridge
from app.connectors.indiamart import LeadSource
from app.connectors.payments import PaymentProvider
from app.connectors.repository import ConnectorsRepository
from app.scheduler.session import PrincipalSession


@dataclass(frozen=True)
class Connectors:
    repo: ConnectorsRepository
    tenant_id: uuid.UUID | None = None  # the ONE workspace the installation's credentials belong to
    leads: LeadSource | None = field(default=None, repr=False)
    payments: PaymentProvider | None = field(default=None, repr=False)
    calls: CallBridge | None = field(default=None, repr=False)
    receiver: PrincipalSession | None = field(default=None, repr=False)  # the registered worker account the webhooks act as
    agent_number: str | None = field(default=None, repr=False)  # the shop's own phone, rung first
    webhook_token: str | None = field(default=None, repr=False)
    public_base_url: str | None = None
    reply_language: str = "en"

    def enabled(self) -> dict[str, bool]:
        return {"indiamart": self.leads is not None, "payments": self.payments is not None, "calls": self.calls is not None}
