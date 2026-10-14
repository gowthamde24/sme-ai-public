"""The scheduler's data access behind an interface (Supabase PostgREST today). Two kinds of caller use it, each with its OWN token:

  * the WORKER, signed in as its registered principal (see auth.py): the `scheduler_*` functions that start with the principal check. The principal belongs to no workspace, so row-level security
    shows it nothing; its only power is to call those functions, and each re-checks the two switches (the global outbox switch and the business's own automatic sending) itself.
  * an Owner or Admin, with their own token, for the settings and the status card (`scheduler_settings_get/set`, `scheduler_status`).

`claim_due` and `mark` have the same shape as the outbox repository's, so the outbox's own dispatch loop (app.outbox.service.dispatch_due) runs unchanged on top of this class: one code path
hands a message to the channel, whoever asks. Failures are classified by SQLSTATE only; data-layer text is never returned or logged. The one place a phone number crosses this module is the answer of
`scheduler_claim_due` (the adapter needs it); it is handed on in memory and never logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.scheduler.repository")


class SchedulerRepository(Protocol):
    # the worker's calls (the principal's token)
    def tenants(self, token: str) -> list[uuid.UUID]: ...
    def heartbeat(self, token: str, interval_seconds: int, errors: int) -> None: ...
    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def due_reminders(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def queue_reminder(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def mark_no_shows(self, token: str, tenant_id: uuid.UUID) -> int: ...
    def campaign_run(self, token: str, tenant_id: uuid.UUID) -> dict[str, int]: ...
    def record(self, token: str, tenant_id: uuid.UUID, counts: dict[str, int]) -> None: ...

    # the Owner's and Admin's calls (their own token)
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set_settings(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]: ...
    def get_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestSchedulerRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("scheduler data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._call(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def _array(self, token: str, function: str, args: dict[str, Any]) -> list[Any]:
        result = self._call(token, function, args)
        if not isinstance(result, list):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ the worker
    def tenants(self, token: str) -> list[uuid.UUID]:
        try:
            return [uuid.UUID(str(t)) for t in self._array(token, "scheduler_tenants", {})]
        except ValueError:
            raise UpstreamError("unexpected function result") from None

    def heartbeat(self, token: str, interval_seconds: int, errors: int) -> None:
        self._call(
            token,
            "scheduler_heartbeat",
            {"p_interval_seconds": interval_seconds, "p_errors": errors},
        )

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        rows = self._array(
            token, "scheduler_claim_due", {"p_tenant_id": str(tenant_id), "p_limit": limit}
        )
        return [r for r in rows if isinstance(r, dict)]

    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "scheduler_mark", args)

    def due_reminders(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        rows = self._array(token, "scheduler_due_reminders", {"p_tenant_id": str(tenant_id)})
        return [r for r in rows if isinstance(r, dict)]

    def queue_reminder(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "scheduler_queue_reminder", args)

    def mark_no_shows(self, token: str, tenant_id: uuid.UUID) -> int:
        marked = self._object(token, "scheduler_mark_no_shows", {"p_tenant_id": str(tenant_id)})
        value = marked.get("marked")
        if not isinstance(value, int):
            raise UpstreamError("unexpected function result")
        return value

    def campaign_run(self, token: str, tenant_id: uuid.UUID) -> dict[str, int]:
        """Job CP: hand the approved campaign steps that are due to the outbox (the database decides everything: both switches, the module, the approval, each person's consent and STOP), then the call list. Counts only."""
        out = self._object(token, "scheduler_campaign_run", {"p_tenant_id": str(tenant_id), "p_limit": 50})
        counts = {k: out.get(k) for k in ("queued", "held", "blocked", "skipped", "errors", "calls", "done")}
        if not all(isinstance(v, int) for v in counts.values()):
            raise UpstreamError("unexpected function result")
        return {k: int(v) for k, v in counts.items() if isinstance(v, int)}

    def record(self, token: str, tenant_id: uuid.UUID, counts: dict[str, int]) -> None:
        self._call(
            token,
            "scheduler_record",
            {
                "p_tenant_id": str(tenant_id),
                "p_sent": counts["sent"],
                "p_failed": counts["failed"],
                "p_reminders": counts["reminders"],
                "p_no_shows": counts["no_shows"],
                "p_errors": counts["errors"],
            },
        )

    # ------------------------------------------------------------------ the Owner's and Admin's
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "scheduler_settings_get", {"p_tenant_id": str(tenant_id)})

    def set_settings(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]:
        return self._object(
            token, "scheduler_settings_set", {"p_tenant_id": str(tenant_id), **args}
        )

    def get_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "scheduler_status", {"p_tenant_id": str(tenant_id)})
