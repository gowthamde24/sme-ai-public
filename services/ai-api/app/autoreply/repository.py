"""The worker's three calls for the automatic WhatsApp reply (job DY): the registered scheduler account's token, the database decides everything it hands out and accepts."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient


class AutoReplyRepository(Protocol):
    def pending(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def submit(self, token: str, enquiry_id: uuid.UUID, text: str, language: str, gloss_en: str | None, hold: bool) -> dict[str, Any]: ...
    def skip(self, token: str, enquiry_id: uuid.UUID, note: str) -> dict[str, Any]: ...


class PostgrestAutoReplyRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def pending(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_auto_reply_pending", {"p_limit": limit})

    def submit(self, token: str, enquiry_id: uuid.UUID, text: str, language: str, gloss_en: str | None, hold: bool) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_auto_reply_submit", {"p_enquiry_id": str(enquiry_id), "p_text": text, "p_language": language, "p_gloss_en": gloss_en, "p_hold": hold})

    def skip(self, token: str, enquiry_id: uuid.UUID, note: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_auto_reply_skip", {"p_enquiry_id": str(enquiry_id), "p_note": note})


class AutoReplySwitch(Protocol):
    """The Owner's switch (any member reads it): public.auto_reply_get / auto_reply_set."""

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]: ...


class PostgrestAutoReplySwitch:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "auto_reply_get", {"p_tenant_id": str(tenant_id)})

    def set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        return self._rpc.object(token, "auto_reply_set", {"p_tenant_id": str(tenant_id), "p_enabled": enabled})
