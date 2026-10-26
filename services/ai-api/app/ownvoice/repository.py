"""The own voice behind an interface (Supabase PostgREST today; job DP part 5). Every call carries the CALLER's token; the functions are those of migration 20261130090300, which prove the role (the Owner,
with a second factor), check the sentence word for word and look at the two stored files themselves before they record a consent."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class VoiceExistsError(RepositoryError):
    """SM831: this workspace already has a live voice."""


class RecordingMissingError(RepositoryError):
    """SM832: a recording is missing from storage or is not audio."""


class SentenceMismatchError(RepositoryError):
    """SM833: the sentence is not the one to read."""


class OwnVoiceRepository(Protocol):
    def sentence(self, token: str, tenant_id: uuid.UUID, name: str) -> str: ...
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def private(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str: ...
    def begin(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def ready(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID, provider: str, provider_voice_id: str) -> dict[str, Any]: ...
    def failed(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]: ...
    def deleted(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestOwnVoiceRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM831": VoiceExistsError, "SM832": RecordingMissingError, "SM833": SentenceMismatchError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def sentence(self, token: str, tenant_id: uuid.UUID, name: str) -> str:
        result = self._rpc.call(token, "own_voice_sentence", {"p_tenant_id": str(tenant_id), "p_name": name})
        return str(result)

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "own_voice_get", {"p_tenant_id": str(tenant_id)})

    def private(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        result = self._rpc.call(token, "own_voice_private", {"p_tenant_id": str(tenant_id)})
        return result if isinstance(result, dict) else None

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        return str(self._rpc.call(token, "own_voice_ensure_bucket", {"p_tenant_id": str(tenant_id)}))

    def begin(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "own_voice_begin",
            {
                "p_tenant_id": str(tenant_id), "p_id": str(args["id"]), "p_name": args["name"], "p_sentence": args["sentence"], "p_sample_path": args["sample_path"],
                "p_sample_seconds": args["sample_seconds"], "p_consent_path": args["consent_path"], "p_consent_seconds": args["consent_seconds"],
            },
        )

    def ready(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID, provider: str, provider_voice_id: str) -> dict[str, Any]:
        return self._rpc.object(token, "own_voice_ready", {"p_tenant_id": str(tenant_id), "p_id": str(voice_id), "p_provider": provider, "p_provider_voice_id": provider_voice_id})

    def failed(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "own_voice_failed", {"p_tenant_id": str(tenant_id), "p_id": str(voice_id)})

    def deleted(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "own_voice_deleted", {"p_tenant_id": str(tenant_id), "p_id": str(voice_id)})
