"""One small client for the SECURITY DEFINER functions of Supabase PostgREST (job BY). Every call carries the CALLER's JWT and the public key, so the database decides who may do what. Failures are classified
by SQLSTATE only (`errors` maps a code to an exception class); data-layer text is never returned or logged."""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

import httpx

from app.crm.repository import NotFoundError, classify_error
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError

logger = logging.getLogger("app.rpc")


class RpcClient:
    def __init__(self, rest_url: str, anon_key: str, errors: Mapping[str, type[RepositoryError]] | None = None, *, client: httpx.Client | None = None, timeout: float = 20.0) -> None:
        self._anon_key = anon_key
        self._errors = dict(errors or {})
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(timeout, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def _classify(self, status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in self._errors:
            return self._errors[code](code)
        if code == "SM306":
            return MfaRequired(code)
        if code == "23503":
            return NotFoundError(code)
        return classify_error(status, body)

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {"apikey": self._anon_key, "Accept": "application/json", "Authorization": f"Bearer {token}"}
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("data layer unreachable: %s", exc.__class__.__name__)
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

    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self.call(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def array(self, token: str, function: str, args: dict[str, Any]) -> list[dict[str, Any]]:
        result = self.call(token, function, args)
        if not isinstance(result, list):
            raise UpstreamError("unexpected function result")
        return [r for r in result if isinstance(r, dict)]
