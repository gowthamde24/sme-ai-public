"""Enquiry data access behind an interface (Supabase PostgREST today). Same discipline as the CRM
adapter: every call carries the CALLER's JWT and the public anon key, so RLS, column grants and
triggers decide; failures are classified by SQLSTATE only and data-layer text (which can hold the
enquiry) is never returned, logged or chained into an exception."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.repository import classify_error
from app.enquiries.models import EnquiryOut
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.enquiries.repository")

ENQUIRY_SELECT = ",".join(EnquiryOut.model_fields)


class EnquiriesRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID) -> EnquiryOut | None: ...


class PostgrestEnquiriesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(self, method: str, path: str, token: str, *, params: dict[str, str]) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("enquiries data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise classify_error(response.status_code, body)

    @staticmethod
    def _parse(row: Any) -> EnquiryOut:
        try:
            return EnquiryOut.model_validate(row)
        except (ValidationError, TypeError):
            logger.error("enquiries data layer returned a row that does not match EnquiryOut")
            raise UpstreamError("unexpected row shape") from None

    def get(self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID) -> EnquiryOut | None:
        rows = self._send(
            "GET",
            "/enquiries",
            token,
            params={
                "select": ENQUIRY_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{enquiry_id}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected row shape")
        return self._parse(rows[0]) if rows else None
