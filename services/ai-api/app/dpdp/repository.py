"""The DPDP data access behind an interface (Supabase PostgREST today; job DQ part 4). The person's calls carry THEIR token; the two public doors carry only the public key (the functions are open to it and hold
their own caps); the worker's calls carry the registered scheduler's token. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.privacy.errors import PrivacyRateError, PrivacyStateError
from app.rpc_base import RpcClient


class DpdpRepository(Protocol):
    # the person
    def consents(self, token: str) -> dict[str, Any]: ...
    def set_marketing(self, token: str, given: bool, via: str, notice_version: str) -> dict[str, Any]: ...
    def profile_get(self, token: str) -> dict[str, Any]: ...
    def profile_set(self, token: str, display_name: str) -> dict[str, Any]: ...
    def lapse_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    # the public doors (the public key)
    def grievance_submit(self, args: dict[str, Any]) -> dict[str, Any]: ...
    def waitlist_join(self, args: dict[str, Any]) -> dict[str, Any]: ...
    # the worker (the scheduler's token)
    def intake_due(self, token: str, limit: int) -> dict[str, Any]: ...
    def intake_mark(self, token: str, kind: str, item_id: uuid.UUID, what: str) -> None: ...
    def lapse_due(self, token: str, limit: int) -> dict[str, Any]: ...
    def lapse_warned(self, token: str, tenant_id: uuid.UUID) -> None: ...
    def lapse_erase(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def purge_logs(self, token: str) -> dict[str, Any]: ...


class PostgrestDpdpRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._rpc = RpcClient(rest_url, anon_key, {"SM613": PrivacyStateError, "SM614": PrivacyRateError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def consents(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "consents_mine", {})

    def set_marketing(self, token: str, given: bool, via: str, notice_version: str) -> dict[str, Any]:
        return self._rpc.object(token, "consent_set_marketing", {"p_given": given, "p_via": via, "p_notice_version": notice_version})

    def profile_get(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "profile_get", {})

    def profile_set(self, token: str, display_name: str) -> dict[str, Any]:
        return self._rpc.object(token, "profile_set", {"p_display_name": display_name})

    def lapse_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lapse_erasure_status", {"p_tenant_id": str(tenant_id)})

    def grievance_submit(self, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(self._anon_key, "public_grievance_submit", args)

    def waitlist_join(self, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(self._anon_key, "waitlist_join", args)

    def intake_due(self, token: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_public_intake_due", {"p_limit": limit})

    def intake_mark(self, token: str, kind: str, item_id: uuid.UUID, what: str) -> None:
        self._rpc.call(token, "scheduler_public_intake_mark", {"p_kind": kind, "p_id": str(item_id), "p_what": what})

    def lapse_due(self, token: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_lapse_due", {"p_limit": limit})

    def lapse_warned(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "scheduler_lapse_warned", {"p_tenant_id": str(tenant_id)})

    def lapse_erase(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_lapse_erase", {"p_tenant_id": str(tenant_id)})

    def purge_logs(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "privacy_worker_purge_logs", {})
