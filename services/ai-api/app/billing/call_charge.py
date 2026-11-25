"""Charging a finished call to the wallet (migration 20261231991700; API switch BILLING_CHARGE_CALLS, off at deploy).

The price is the database's (`pricing_charge_call`: 30-second blocks rounded up, nothing for an unanswered call, one rate in and out, tests and billing-exempt workspaces free, one row per call so a repeat is a replay).
This module only carries the call's id and its answered seconds to it, as the phone server's own system account, and never lets a failure break the call (the worker's reconcile pass charges what was missed)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.rpc_base import RpcClient

log = logging.getLogger("app.billing.call_charge")


class CallCharger:
    def __init__(self, rpc: RpcClient, system_token: Any) -> None:
        self._rpc, self._token = rpc, system_token   # system_token: a callable giving the scheduler account's token

    def charge(self, tenant_id: uuid.UUID, call_id: uuid.UUID, seconds: int, *, answered: bool = True) -> dict[str, Any] | None:
        """The charge (or its replay); None when it could not be made (logged by class only)."""
        try:
            out = self._rpc.call(self._token(), "pricing_charge_call", {"p_tenant_id": str(tenant_id), "p_call_id": str(call_id), "p_seconds": max(0, int(seconds)), "p_answered": answered})
            return out if isinstance(out, dict) else None
        except Exception as exc:  # noqa: BLE001 - never breaks a call
            log.warning("call charge failed: %s", exc.__class__.__name__)
            return None

    def uncharged(self, limit: int = 50) -> list[dict[str, Any]]:
        out = self._rpc.call(self._token(), "pricing_uncharged_calls", {"p_limit": limit})
        return [x for x in out if isinstance(x, dict)] if isinstance(out, list) else []

    def reconcile(self, limit: int = 50) -> int:
        """The worker's pass: charge every ended, answered call that has no charge row. Returns how many were charged now."""
        done = 0
        for item in self.uncharged(limit):
            try:
                result = self.charge(uuid.UUID(str(item["tenant_id"])), uuid.UUID(str(item["call_id"])), int(item["seconds"]))
            except (KeyError, ValueError, TypeError):
                continue
            if result is not None and result.get("replayed") is False:
                done += 1
        if done:
            log.warning("call charges reconciled: %d call(s) had no charge at their end", done)   # staff see this in the logs: a call end that failed to charge is a bug worth a look
        return done
