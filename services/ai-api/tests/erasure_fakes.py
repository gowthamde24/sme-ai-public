"""In-memory stand-in for the HTTP side of erasure (the real database rules, RLS and the three
functions are proved in pgTAP and in tests/integration/test_erasure_direct_postgrest.py)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from app.crm.models import Page
from app.crm.repository import ConflictError
from app.erasure.models import DataPolicyOut, ErasureRequestOut, ErasureResultOut
from app.tenancy.repository import Forbidden

NOW = dt.datetime(2026, 10, 5, 12, 0, tzinfo=dt.UTC)
NOTE = "Names are matched only when a whole field equals the name."


def result(request_id: uuid.UUID, **over: Any) -> ErasureResultOut:
    base: dict[str, Any] = {
        "request_id": request_id,
        "scope": "contact",
        "status": "executed",
        "dry_run": False,
        "counts": {"contacts.full_name": 1, "contacts.email": 1},
        "review": [],
        "review_truncated": False,
        "exports_logged": 0,
        "note": NOTE,
        "replayed": False,
    }
    return ErasureResultOut.model_validate({**base, **over})


class FakeErasureRepository:
    def __init__(self) -> None:
        self.tokens_seen: list[str] = []
        self.calls: list[str] = []
        self.rows: dict[uuid.UUID, tuple[uuid.UUID, ErasureRequestOut]] = {}
        self.dry_runs: list[bool] = []
        self.request_error: Exception | None = None
        self.execute_error: Exception | None = None
        self.cancel_error: Exception | None = None
        self.open_gates: set[uuid.UUID] = set()

    def _seen(self, token: str, call: str) -> None:
        self.tokens_seen.append(token)
        self.calls.append(call)

    def seed(self, tenant_id: uuid.UUID, request_id: uuid.UUID, **over: Any) -> ErasureRequestOut:
        base: dict[str, Any] = {
            "id": request_id,
            "scope": "contact",
            "subject_id": uuid.UUID(int=0xC0),
            "status": "pending",
            "requested_by": uuid.UUID(int=0x1001),
            "created_at": NOW,
            "execute_after": NOW,
            "executed_by": None,
            "executed_at": None,
            "cancelled_by": None,
            "cancelled_at": None,
            "result": None,
        }
        row = ErasureRequestOut.model_validate({**base, **over})
        self.rows[request_id] = (tenant_id, row)
        return row

    def request(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        request_id: uuid.UUID,
        scope: str,
        subject_id: uuid.UUID | None,
    ) -> bool:
        self._seen(token, "request")
        if self.request_error is not None:
            raise self.request_error
        existing = self.rows.get(request_id)
        if existing is not None:
            tenant, row = existing
            if tenant == tenant_id and row.scope == scope and row.subject_id == subject_id:
                return True
            raise ConflictError("23505")
        self.seed(
            tenant_id,
            request_id,
            scope=scope,
            subject_id=subject_id,
            execute_after=NOW + dt.timedelta(hours=24) if scope == "tenant" else NOW,
        )
        return False

    def get(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> ErasureRequestOut | None:
        self._seen(token, "get")
        found = self.rows.get(request_id)
        return found[1] if found is not None and found[0] == tenant_id else None

    def list(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[ErasureRequestOut]:
        self._seen(token, "list")
        mine = [row for tenant, row in self.rows.values() if tenant == tenant_id]
        return Page[ErasureRequestOut](items=mine[:limit], next_cursor=None)

    def execute(self, token: str, request_id: uuid.UUID, *, dry_run: bool) -> ErasureResultOut:
        self._seen(token, "execute")
        self.dry_runs.append(dry_run)
        if self.execute_error is not None:
            raise self.execute_error
        found = self.rows.get(request_id)
        if found is None:
            raise Forbidden("42501")
        tenant, row = found
        if not dry_run:
            out = result(request_id, scope=row.scope)
            self.rows[request_id] = (
                tenant,
                row.model_copy(update={"status": "executed", "result": out}),
            )
            return out
        return result(request_id, scope=row.scope, status="dry_run", dry_run=True)

    def cancel(self, token: str, request_id: uuid.UUID) -> bool:
        self._seen(token, "cancel")
        if self.cancel_error is not None:
            raise self.cancel_error
        tenant, row = self.rows[request_id]
        replayed = row.status == "cancelled"
        self.rows[request_id] = (tenant, row.model_copy(update={"status": "cancelled"}))
        return replayed

    def data_policy(self, token: str, tenant_id: uuid.UUID) -> DataPolicyOut:
        self._seen(token, "data_policy")
        return DataPolicyOut(real_data_allowed=tenant_id in self.open_gates)
