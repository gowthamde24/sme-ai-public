"""The AI's own recording of a WhatsApp follow-up's outcome (job DM, C1 part), with the registered channel account's token (the same account that receives the webhooks).

After the webhook stored a customer's reply, `after_inbound` reads the reply with the cautious word list (`classify.py`) and, when a signal is clear, records the outcome. The database refuses it unless we really
wrote to this customer in the last 14 days (their reply to a follow-up, not a stranger's message), keeps ONE AI outcome per customer per conversation (24 hours) and never overwrites a person's correction.
Recording must never break the webhook: any failure is swallowed (logged by class only) and Meta is not asked to retry because of it."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.outcomes.classify import classify_reply
from app.outcomes.repository import OutcomesRepository
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.outcomes")


class OutcomeRecorder:
    def __init__(self, repository: OutcomesRepository) -> None:
        self._repo = repository

    def after_inbound(self, token: str, stored: dict[str, Any], text: str | None, sent_at: datetime | None) -> bool:
        """True when an outcome was recorded (or already there). `stored` is the webhook function's answer (`tenant_id`, `contact_id`, `lead_id`, `enquiry_id`)."""
        suggestion = classify_reply(text)
        if suggestion is None:
            return False
        try:
            tenant_id = uuid.UUID(str(stored["tenant_id"]))
            body = {
                "contact_id": uuid.UUID(str(stored["contact_id"])),
                "lead_id": uuid.UUID(str(stored["lead_id"])) if stored.get("lead_id") else None,
                "kind": "whatsapp_followup",
                "source_id": uuid.UUID(str(stored["enquiry_id"])),
                "outcome": suggestion.outcome,
                "category": suggestion.category,
                "reason": suggestion.reason,
                "occurred_at": min(sent_at or datetime.now(UTC), datetime.now(UTC)),
            }
            self._repo.record(token, tenant_id, body)
            return True
        except TokenRejected:
            raise   # the ingest signs in again and retries the whole event
        except (RepositoryError, KeyError, ValueError) as exc:
            logger.info("outcome not recorded (%s)", exc.__class__.__name__)
            return False
