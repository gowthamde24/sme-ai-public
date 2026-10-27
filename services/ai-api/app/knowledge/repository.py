"""The knowledge base behind an interface (Supabase PostgREST today; job DR / A1). Every call carries the CALLER's token; the functions are those of migration 20261204090100."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.knowledge.errors import KnowledgeLimitError
from app.rpc_base import RpcClient


class KnowledgeRepository(Protocol):
    def source_add(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def source_text(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]: ...
    def source_discard(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]: ...
    def facts_replace(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, facts: list[dict[str, Any]]) -> list[dict[str, Any]]: ...
    def fact_add(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, kind: str, text: str) -> dict[str, Any]: ...
    def fact_edit(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, text: str, kind: str | None) -> dict[str, Any]: ...
    def fact_decide(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, decision: str) -> dict[str, Any]: ...
    def facts(self, token: str, tenant_id: uuid.UUID, status: str | None, source_id: uuid.UUID | None, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def approved(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...


class PostgrestKnowledgeRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"53400": KnowledgeLimitError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def source_add(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_source_add", {"p_tenant_id": str(tenant_id), **args})

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "knowledge_sources_list", {"p_tenant_id": str(tenant_id)})

    def source_text(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_source_text", {"p_tenant_id": str(tenant_id), "p_id": str(source_id)})

    def source_discard(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_source_discard", {"p_tenant_id": str(tenant_id), "p_id": str(source_id)})

    def facts_replace(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, facts: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._rpc.array(token, "knowledge_facts_draft_replace", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_facts": facts})

    def fact_add(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, kind: str, text: str) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_fact_add", {"p_tenant_id": str(tenant_id), "p_id": str(fact_id), "p_kind": kind, "p_text": text})

    def fact_edit(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, text: str, kind: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_fact_edit", {"p_tenant_id": str(tenant_id), "p_id": str(fact_id), "p_text": text, "p_kind": kind})

    def fact_decide(self, token: str, tenant_id: uuid.UUID, fact_id: uuid.UUID, decision: str) -> dict[str, Any]:
        return self._rpc.object(token, "knowledge_fact_decide", {"p_tenant_id": str(tenant_id), "p_id": str(fact_id), "p_decision": decision})

    def facts(self, token: str, tenant_id: uuid.UUID, status: str | None, source_id: uuid.UUID | None, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        args: dict[str, Any] = {"p_tenant_id": str(tenant_id), "p_status": status, "p_source_id": str(source_id) if source_id else None, "p_limit": limit}
        if after is not None:
            args.update({"p_after_at": after[0].isoformat(), "p_after_id": str(after[1])})
        return self._rpc.array(token, "knowledge_facts_list", args)

    def approved(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "knowledge_facts_approved", {"p_tenant_id": str(tenant_id)})
