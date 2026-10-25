"""Plans and billing behind an interface (Supabase PostgREST today; job DI, ADR 0092). Every call carries the CALLER's token; the functions are SECURITY DEFINER functions of migration 20261127090200 that prove the
role (and, for what changes the subscription, the second factor) first. The two calls that only the registered CHANNEL account may make (`record_usage`, `apply_event`) are checked by the database the same way."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.billing.errors import NothingToCancelError, PlanUnknownError, TrialAlreadyStartedError
from app.rpc_base import RpcClient


class BillingRepository(Protocol):
    def plans(self, token: str) -> dict[str, Any]: ...
    def billing(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def check_usage(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]: ...
    def subscription_ref(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def start_trial(self, token: str, tenant_id: uuid.UUID, plan_id: str, provider: str, provider_ref: str) -> dict[str, Any]: ...
    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def record_usage(self, token: str, tenant_id: uuid.UUID, kind: str, ref_id: uuid.UUID, units: int) -> dict[str, Any]: ...
    def apply_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None, at: datetime) -> dict[str, Any]: ...
    def trial_clocks_due(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def trial_clock_mark(self, token: str, tenant_id: uuid.UUID) -> None: ...


class PostgrestBillingRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM821": PlanUnknownError, "SM822": TrialAlreadyStartedError, "SM823": NothingToCancelError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def plans(self, token: str) -> dict[str, Any]:
        return self._rpc.object(token, "billing_plans", {})

    def billing(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "billing_get", {"p_tenant_id": str(tenant_id)})

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "billing_usage_get", {"p_tenant_id": str(tenant_id)})

    def access(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "billing_access", {"p_tenant_id": str(tenant_id)})

    def check_usage(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        return self._rpc.object(token, "billing_check_usage", {"p_tenant_id": str(tenant_id), "p_kind": kind})

    def subscription_ref(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        result = self._rpc.call(token, "billing_subscription_ref", {"p_tenant_id": str(tenant_id)})
        return result if isinstance(result, dict) else None

    def start_trial(self, token: str, tenant_id: uuid.UUID, plan_id: str, provider: str, provider_ref: str) -> dict[str, Any]:
        return self._rpc.object(token, "billing_start_trial", {"p_tenant_id": str(tenant_id), "p_plan_id": plan_id, "p_provider": provider, "p_provider_ref": provider_ref})

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "billing_cancel", {"p_tenant_id": str(tenant_id)})

    def record_usage(self, token: str, tenant_id: uuid.UUID, kind: str, ref_id: uuid.UUID, units: int) -> dict[str, Any]:
        return self._rpc.object(token, "billing_record_usage", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_ref_id": str(ref_id), "p_units": units})

    def apply_event(self, token: str, tenant_id: uuid.UUID, event_id: str, kind: str, amount_paise: int | None, at: datetime) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "billing_apply_event",
            {"p_tenant_id": str(tenant_id), "p_event_id": event_id, "p_kind": kind, "p_amount_paise": amount_paise, "p_at": at.isoformat()},
        )

    def trial_clocks_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        result = self._rpc.call(token, "scheduler_billing_trial_clocks_due", {"p_limit": limit})
        return [r for r in result if isinstance(r, dict)] if isinstance(result, list) else []

    def trial_clock_mark(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "scheduler_billing_trial_clock_mark", {"p_tenant_id": str(tenant_id)})
