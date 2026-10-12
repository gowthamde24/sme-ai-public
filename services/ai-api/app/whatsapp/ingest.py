"""Handing a webhook notification to the database (job BR, ADR 0076).

The API verified the signature; here each event becomes ONE call of a channel-principal function, with the channel principal's own token (the account `CHANNEL_AGENT_EMAIL`, registered by the operator,
no workspace, no table). What the webhook says is UNTRUSTED content: it is stored as the customer's words (an enquiry), cleaned of control characters and capped, and never obeyed: an inbound message
cannot approve, send, change a price or switch anything, whatever it says.

An opt-out ("STOP", and the same in Hindi, Telugu, Kannada) suppresses the contact in the same call that stores the message. The number's suppression key (an HMAC with the API's key; the key never
reaches the database) is made here. A transient failure of the data layer raises (the route answers 500 and Meta tries again, days if need be); everything is idempotent on the WhatsApp message id."""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.suppression.keys import PHONE, KeyRing
from app.tenancy.repository import TokenRejected
from app.whatsapp import optout
from app.whatsapp.repository import WhatsAppRepository
from app.whatsapp.webhook import Event, Inbound, Status

logger = logging.getLogger("app.whatsapp.ingest")

TEXT_MAX = 4000
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​  ‪-‮⁦-⁩﻿]")


class TokenSource(Protocol):
    def token(self) -> str: ...
    def invalidate(self) -> None: ...


def clean_text(text: str | None) -> str | None:
    """Control characters, direction overrides and zero-width characters out (a message must not be able to hide or reorder what a person reads), NFC, trimmed, capped."""
    if text is None:
        return None
    cleaned = _CONTROL.sub("", unicodedata.normalize("NFC", text)).strip()
    return cleaned[:TEXT_MAX] or None


@dataclass
class IngestResult:
    stored: int = 0
    optouts: int = 0
    statuses: int = 0
    duplicates: int = 0
    ignored: int = 0  # unknown number, gate closed, unknown message
    outcomes: dict[str, int] = field(default_factory=dict)

    def count(self, outcome: str) -> None:
        self.outcomes[outcome] = self.outcomes.get(outcome, 0) + 1


class WhatsAppIngest:
    def __init__(self, repository: WhatsAppRepository, session: TokenSource, key_ring: KeyRing) -> None:
        self._repository = repository
        self._session = session
        self._keys = key_ring

    def handle(self, events: list[Event]) -> IngestResult:
        result = IngestResult()
        for event in events:
            try:
                self._one(event, result)
            except TokenRejected:
                self._session.invalidate()
                self._one(event, result)  # once more with a fresh sign-in; a second refusal raises
        logger.info("whatsapp webhook handled: stored=%d optouts=%d statuses=%d duplicates=%d ignored=%d", result.stored, result.optouts, result.statuses, result.duplicates, result.ignored)
        return result

    def _one(self, event: Event, result: IngestResult) -> None:
        token = self._session.token()
        if isinstance(event, Inbound):
            self._inbound(token, event, result)
        elif isinstance(event, Status):
            self._status(token, event, result)

    def _inbound(self, token: str, event: Inbound, result: IngestResult) -> None:
        digits = "".join(ch for ch in event.sender if ch.isdigit())
        phone_key = self._keys.key_for(PHONE, "+" + digits)
        if phone_key is None:
            result.ignored += 1
            result.count("bad_number")
            return
        text = clean_text(event.text)
        answer: dict[str, Any] = self._repository.ingest_inbound(
            token,
            {
                "p_phone_number_id": event.phone_number_id,
                "p_wamid": event.wamid,
                "p_from": digits,
                "p_profile_name": clean_text(event.name),
                "p_kind": event.kind if re.fullmatch(r"[a-z_]{2,30}", event.kind) else "unsupported",
                "p_text": text,
                "p_sent_at": event.sent_at.isoformat() if event.sent_at else None,
                "p_phone_hmac": phone_key,
                "p_hmac_version": self._keys.current.version,
                "p_optout": optout.is_optout(text),
            },
        )
        outcome = str(answer.get("outcome"))
        result.count(outcome)
        if outcome == "stored":
            result.stored += 1
            if answer.get("optout"):
                result.optouts += 1
        elif outcome == "duplicate":
            result.duplicates += 1
        else:
            result.ignored += 1

    def _status(self, token: str, event: Status, result: IngestResult) -> None:
        answer = self._repository.ingest_status(
            token,
            {
                "p_phone_number_id": event.phone_number_id,
                "p_wamid": event.wamid,
                "p_status": event.status,
                "p_at": event.at.isoformat() if event.at else None,
                "p_error_code": event.error_code,
                "p_callback": event.callback,
            },
        )
        outcome = str(answer.get("outcome"))
        result.count(outcome)
        if outcome == "recorded":
            result.statuses += 1
        elif outcome == "duplicate":
            result.duplicates += 1
        else:
            result.ignored += 1
