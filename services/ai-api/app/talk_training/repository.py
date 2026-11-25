"""The database side of "How I talk to customers" (migration 20261231150000): every call carries the caller's token; the database decides who (Owner saves with a second factor, Owner and Admin read)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import httpx

from app.errors import ApiError
from app.opening import greeting
from app.rpc_base import RpcClient


class PostgrestTalkTraining:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, client=client)

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "talk_training_get", {"p_tenant_id": str(tenant_id)})
        return got if isinstance(got, dict) else None

    def save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        """The one door every writer uses (the training screen, "how I speak", the jobs page). The lawyer's written opinion (25 Nov 2026): the greeting may stop saying it is an AI only after the Owner accepted the written
        undertaking, which the SERVER keeps in the document (`ai_off_undertaking`: when and who). A value sent by the client for that key is ignored (a client cannot give itself the undertaking); a NEW "off" without it is
        refused (409 ai_undertaking_required); an "off" already stored without it is dropped (it was never in force: the greeting reads it as ON)."""
        stored = self.get(token, tenant_id)
        stored_doc: dict[str, Any] = stored["doc"] if isinstance(stored, dict) and isinstance(stored.get("doc"), dict) else {}
        undertaking = stored_doc.get(greeting.UNDERTAKING_KEY) if greeting.has_undertaking(stored_doc) else None
        doc = {k: v for k, v in doc.items() if k != greeting.UNDERTAKING_KEY}
        if undertaking is not None:
            doc[greeting.UNDERTAKING_KEY] = undertaking
        elif greeting.disclosure_off_in(doc):
            if greeting.disclosure_off_in(stored_doc) and {k: doc.get(k) for k in ("say_ai_when_greeting", "say_ai_by_job")} == {k: stored_doc.get(k) for k in ("say_ai_when_greeting", "say_ai_by_job")}:
                doc["say_ai_when_greeting"] = None if doc.get("say_ai_when_greeting") is False else doc.get("say_ai_when_greeting")
                doc["say_ai_by_job"] = {j: w for j, w in dict(doc.get("say_ai_by_job") or {}).items() if w != "off"}
            else:
                raise ApiError(409, "ai_undertaking_required", "To stop saying it is an AI assistant, first accept the written undertaking.")
        return self._rpc.object(token, "talk_training_save", {"p_tenant_id": str(tenant_id), "p_doc": doc})

    def save_undertaking(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any], by: str, at: str, version: str) -> dict[str, Any]:
        """Stores the Owner's acceptance in the document (the only writer of the key)."""
        doc = {**doc, greeting.UNDERTAKING_KEY: {"at": at, "by": by, "version": version}}
        return self._rpc.object(token, "talk_training_save", {"p_tenant_id": str(tenant_id), "p_doc": doc})

    def reset(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "talk_training_reset", {"p_tenant_id": str(tenant_id)})

    def for_call(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        got = self._rpc.call(token, "talk_training_for_call", {"p_tenant_id": str(tenant_id)})
        return got if isinstance(got, dict) else None
