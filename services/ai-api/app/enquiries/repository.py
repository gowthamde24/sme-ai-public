"""Enquiry data access behind an interface (Supabase PostgREST today). Same discipline as the CRM adapter: every call carries the
CALLER's JWT and the public anon key, so RLS, column grants and triggers decide; failures are classified by SQLSTATE only and
data-layer text (which can hold the enquiry) is never returned, logged or chained into an exception.

Writes to a requirement go through the SECURITY DEFINER functions (decide / add / confirm / discard): the tables have no client write
grant. An enquiry itself is inserted directly under RLS (the database refuses text that still holds a contact detail)."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.repository import ConflictError, NotFoundError, classify_error
from app.enquiries.models import EnquiryOut
from app.tenancy.repository import RepositoryError, UpstreamError

logger = logging.getLogger("app.enquiries.repository")

ENQUIRY_SELECT = ",".join(EnquiryOut.model_fields)
REQUIREMENT_SELECT = "id,status,created_via,agent_run_id,confirmed_by,confirmed_at,created_at"
FIELD_SELECT = (
    "id,line_no,field_key,value_code,value_int,value_date,value_text,basis,certainty,state,conflict,"
    "created_via,quote,quote_start,quote_end,decided_by,decided_at"
)


class RequirementConfirmedError(RepositoryError):
    """SM208: the enquiry already has a confirmed requirement; a human discards it first."""


class RequirementNotDraftError(RepositoryError):
    """SM209: the requirement is no longer a draft."""


class NotConfirmableError(RepositoryError):
    """SM210: no line has a saree type AND a quantity that a person confirmed or corrected."""


_STATES: dict[str, type[RepositoryError]] = {
    "SM208": RequirementConfirmedError,
    "SM209": RequirementNotDraftError,
    "SM210": NotConfirmableError,
}


class EnquiriesRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID) -> EnquiryOut | None: ...

    def list_for_lead(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[EnquiryOut]: ...

    def create(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> tuple[EnquiryOut, bool]: ...

    def get_requirement(
        self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]: ...

    def get_field(
        self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID
    ) -> dict[str, Any] | None:
        """The field's key, line and its requirement's enquiry (what a decision needs), or None."""
        ...

    def requirement_exists(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> bool: ...

    def decide(
        self, token: str, field_id: uuid.UUID, decision: str, value: dict[str, Any]
    ) -> dict[str, Any]: ...

    def add_field(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...

    def confirm(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]: ...

    def discard(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestEnquiriesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
        returning: bool = False,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if returning:
            headers["Prefer"] = "return=representation"
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
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
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in _STATES:
            logger.info("enquiries data layer refused: sqlstate=%s", code)
            return _STATES[code](code)
        if code == "42501" and status == 403 and isinstance(body, dict):
            # the definer functions answer a generic 42501 for an unknown id, a foreign id and a role that may not act: one answer
            if body.get("message") == "requirement action not permitted":
                return NotFoundError(code)
        return classify_error(status, body)

    @staticmethod
    def _enquiry(row: Any) -> EnquiryOut:
        try:
            return EnquiryOut.model_validate(row)
        except (ValidationError, TypeError):
            logger.error("enquiries data layer returned a row that does not match EnquiryOut")
            raise UpstreamError("unexpected row shape") from None

    def _rows(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._send("GET", path, token, params=params)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise UpstreamError("unexpected list shape")
        return rows

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._send("POST", f"/rpc/{function}", token, json=args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ enquiries
    def get(self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID) -> EnquiryOut | None:
        rows = self._rows(
            "/enquiries",
            token,
            {
                "select": ENQUIRY_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{enquiry_id}",
                "limit": "1",
            },
        )
        return self._enquiry(rows[0]) if rows else None

    def list_for_lead(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[EnquiryOut]:
        rows = self._rows(
            "/enquiries",
            token,
            {
                "select": ENQUIRY_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"eq.{lead_id}",
                "archived_at": "is.null",
                "order": "created_at.desc,id.desc",
                "limit": str(limit),
            },
        )
        return [self._enquiry(r) for r in rows]

    def create(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> tuple[EnquiryOut, bool]:
        """Insert under the caller's rights. An id that is already used is a REPLAY only when the stored enquiry is the same lead,
        channel, time, subject and text; anything else is a conflict (the answer never says whose row it is)."""
        row = {**payload, "tenant_id": str(tenant_id)}
        try:
            created = self._send(
                "POST",
                "/enquiries",
                token,
                params={"select": ENQUIRY_SELECT},
                json=row,
                returning=True,
            )
        except ConflictError:
            existing = self.get(token, tenant_id, uuid.UUID(str(payload["id"])))
            if existing is not None and _same_enquiry(existing, payload):
                return existing, True
            raise
        if not isinstance(created, list) or len(created) != 1:
            raise UpstreamError("unexpected create result")
        return self._enquiry(created[0]), False

    # ------------------------------------------------------------------ requirements
    def get_requirement(
        self, token: str, tenant_id: uuid.UUID, enquiry_id: uuid.UUID
    ) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        reqs = self._rows(
            "/requirements",
            token,
            {
                "select": REQUIREMENT_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "enquiry_id": f"eq.{enquiry_id}",
                "status": "in.(draft,confirmed)",
                "limit": "1",
            },
        )
        if not reqs:
            return None, []
        fields = self._rows(
            "/requirement_fields",
            token,
            {
                "select": FIELD_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "requirement_id": f"eq.{reqs[0]['id']}",
                "order": "line_no.asc.nullsfirst,field_key.asc",
                "limit": "100",
            },
        )
        return reqs[0], fields

    def get_field(
        self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID
    ) -> dict[str, Any] | None:
        rows = self._rows(
            "/requirement_fields",
            token,
            {
                "select": "id,line_no,field_key,requirement:requirements!inner(id,enquiry_id,status)",
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{field_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def requirement_exists(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> bool:
        rows = self._rows(
            "/requirements",
            token,
            {
                "select": "id",
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{requirement_id}",
                "limit": "1",
            },
        )
        return bool(rows)

    def decide(
        self, token: str, field_id: uuid.UUID, decision: str, value: dict[str, Any]
    ) -> dict[str, Any]:
        return self._rpc(
            token,
            "decide_requirement_field",
            {
                "p_field_id": str(field_id),
                "p_decision": decision,
                **{f"p_{k}": v for k, v in value.items()},
            },
        )

    def add_field(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "add_requirement_field", args)

    def confirm(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc(token, "confirm_requirement", {"p_requirement_id": str(requirement_id)})

    def discard(self, token: str, requirement_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc(token, "discard_requirement", {"p_requirement_id": str(requirement_id)})


def _instant(value: Any) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    return parsed.astimezone(UTC)


def _same_enquiry(existing: EnquiryOut, payload: dict[str, Any]) -> bool:
    return (
        str(existing.lead_id) == str(payload["lead_id"])
        and existing.channel == payload["channel"]
        and _instant(existing.received_at) == _instant(payload["received_at"])
        and existing.subject == payload.get("subject")
        and existing.body == payload["body"]
    )
