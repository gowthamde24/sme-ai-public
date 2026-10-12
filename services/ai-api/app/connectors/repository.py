"""The connectors' data access behind an interface (Supabase PostgREST today). A person's calls carry THEIR token (row-level checks and the role checks in the functions decide); the webhook calls carry the
registered worker account's token (job AW). Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.connectors.errors import SQLSTATE_KIND, ConnectorRefused
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.connectors.repository")


class ConnectorsRepository(Protocol):
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


class PostgrestConnectorsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {"apikey": self._anon_key, "Authorization": f"Bearer {token}", "Accept": "application/json"}
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("connectors: data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
            code = body.get("code") if isinstance(body, dict) else None
        except ValueError:
            code = None
        kind = SQLSTATE_KIND.get(code) if isinstance(code, str) else None
        if kind is not None:
            raise ConnectorRefused(kind)
        logger.error("connectors: data layer refused %s: http=%s", function, response.status_code)
        raise UpstreamError("unexpected data layer answer")


def tenant_args(tenant_id: uuid.UUID, **kw: Any) -> dict[str, Any]:
    return {"p_tenant_id": str(tenant_id), **{f"p_{k}": v for k, v in kw.items()}}
