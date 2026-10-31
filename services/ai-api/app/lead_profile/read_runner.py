"""The worker's AI lead-reader step (owner decision, 31 Oct 2026): the WhatsApp leads that are new, or whose key fields are still empty, are read by a light model and the answer is stored with LOW confidence.
Carried by the registered scheduler account's token; the DATABASE decides who is read (real-data gate open, not a school, agents switched on, the day's cap, five reads a lead) and what is accepted
(an owner-fixed field and a better guess are kept). Counts only are logged: no name, no number, no word of a conversation."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from app.lead_profile.reader import LeadReader
from app.lead_profile.service import verified_fields
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.lead_profile.read_runner")
LIMIT = 3   # leads read in one tick (the worker ticks every minute)


class LeadReadRepository(Protocol):
    def pending(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def apply(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, str], messages: int) -> str: ...


class PostgrestLeadReadRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def pending(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_lead_reads_pending", {"p_limit": limit})

    def apply(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, str], messages: int) -> str:
        out = self._rpc.call(token, "scheduler_lead_read_apply", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_fields": fields, "p_confidence": dict.fromkeys(fields, "low"), "p_messages": messages})
        return out if isinstance(out, str) else "nothing"


@dataclass
class Result:
    seen: int = 0
    applied: int = 0
    nothing: int = 0
    skipped: int = 0
    failed: int = 0


class LeadReadRunner:
    def __init__(self, repository: LeadReadRepository, reader: LeadReader) -> None:
        self._repository, self._reader = repository, reader

    def run(self, token: str) -> Result:
        result = Result()
        for item in self._repository.pending(token, LIMIT):
            result.seen += 1
            try:
                self._one(token, item, result)
            except TokenRejected:
                raise
            except (RepositoryError, ValueError, KeyError, TypeError) as exc:
                result.failed += 1
                logger.warning("lead reader: one lead could not be handled (%s)", exc.__class__.__name__)
        if result.seen:
            logger.info("lead reader: seen=%d applied=%d nothing=%d skipped=%d failed=%d", result.seen, result.applied, result.nothing, result.skipped, result.failed)
        return result

    def _one(self, token: str, item: dict[str, Any], result: Result) -> None:
        text = str(item["text"])
        answer = self._reader.read(text)
        if answer is None:   # the model failed or gave nothing usable: nothing is recorded, the next tick tries again (a lead is read at most five times once it has been counted)
            result.failed += 1
            return
        fields = verified_fields(answer, text)
        outcome = self._repository.apply(token, uuid.UUID(str(item["tenant_id"])), uuid.UUID(str(item["lead_id"])), fields, int(item["messages"]))
        if outcome == "applied":
            result.applied += 1
        elif outcome == "skipped":
            result.skipped += 1
        else:
            result.nothing += 1
