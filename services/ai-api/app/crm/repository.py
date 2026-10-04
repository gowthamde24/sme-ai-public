"""CRM data access behind an interface (Supabase PostgREST today).

Every call carries the CALLER's JWT plus the public anon key, so Postgres RLS and the table
triggers decide what is visible and writable. There is no privileged credential here.

Error handling is deliberate. PostgREST errors carry `message`, `details` and `hint` copied from
Postgres, and those contain row data: a unique violation prints the e-mail address, a check
violation prints the failing row. They are read here ONLY to classify the failure (SQLSTATE and a
constraint name); the text is never returned, never logged, and never chained into an exception
that a traceback could print.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from app.crm.models import (
    CompanyOut,
    ContactOut,
    LeadOut,
    OpportunityOut,
    Page,
    ProductOut,
    encode_cursor,
)
from app.tenancy.repository import Forbidden, RepositoryError, TokenRejected, UpstreamError

logger = logging.getLogger("app.crm.repository")


# ----------------------------------------------------------------------------- errors
class NotFoundError(RepositoryError):
    """The row does not exist FOR THIS CALLER (absent, or in a tenant they cannot see)."""


class ConflictError(RepositoryError):
    """Generic conflict: the id is taken (by this tenant with a different payload, or by another
    tenant). The two cases must stay indistinguishable."""


class DuplicateValueError(RepositoryError):
    """A per-tenant unique value (e-mail, SKU) is already used inside the caller's own tenant."""

    def __init__(self, field: str) -> None:
        super().__init__(field)
        self.field = field


class InvalidReferenceError(RepositoryError):
    """A referenced company / contact / lead / owner is missing OR belongs to another tenant."""


class InvalidValueError(RepositoryError):
    pass


class InvalidTransitionError(RepositoryError):
    """SM001: won / lost are terminal."""


class ContactSuppressedError(RepositoryError):
    """SM002: consent cannot be granted while the contact is suppressed."""


# ----------------------------------------------------------------------------- entities
@dataclass(frozen=True)
class EntitySpec:
    table: str
    out: type[BaseModel]

    @property
    def select(self) -> str:
        return ",".join(self.out.model_fields)


ENTITIES: dict[str, EntitySpec] = {
    "companies": EntitySpec("companies", CompanyOut),
    "contacts": EntitySpec("contacts", ContactOut),
    "products": EntitySpec("products", ProductOut),
    "leads": EntitySpec("leads", LeadOut),
    "opportunities": EntitySpec("opportunities", OpportunityOut),
}


class CrmRepository(Protocol):
    def list_rows(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        q: str | None,
        include_archived: bool,
    ) -> Page[Any]: ...

    def get_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID
    ) -> Any | None: ...

    def create_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> tuple[Any, bool]: ...

    def update_row(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        row_id: uuid.UUID,
        changes: dict[str, Any],
    ) -> Any: ...

    def set_archived(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID, archived: bool
    ) -> Any: ...

    def consent_rpc(self, token: str, function: str, args: dict[str, Any]) -> uuid.UUID | None: ...

    def list_claims(
        self, token: str, tenant_id: uuid.UUID, *, company_id: uuid.UUID
    ) -> list[dict[str, Any]]: ...


# What a claim read returns and in which order: ONE definition, used by every reader that feeds the
# ICP score (this repository for the label snapshot, the review queue for the reviewer's view).
# What scoring may read is the claims_for_scoring VIEW (ADR 0013, decision 5): live manual and
# import claims, and agent claims only once a human accepted them. Never the raw claims table:
# the review queue and the label snapshot both use this one source.
CLAIMS_FOR_SCORING = "claims_for_scoring"
CLAIM_SELECT = "id,company_id,predicate,value,confidence"
CLAIM_ORDER = "created_at.desc,id.desc"
CLAIMS_PER_COMPANY = 200


# ----------------------------------------------------------------------------- classification
_CONSTRAINT = re.compile(r'constraint "([A-Za-z0-9_]+)"')
_UNIQUE_FIELDS = {"contacts_tenant_email_key": "email", "products_tenant_id_sku_key": "sku"}
_VALUE_CODES = {"22023", "22P02", "22001", "22003", "22007", "22008", "23502", "22P05"}


def classify_error(status: int, body: Any) -> Exception:
    """Turn a PostgREST error into one of our exceptions. Reads text only to classify it."""
    code = ""
    message = ""
    if isinstance(body, dict):
        code = str(body.get("code", ""))
        message = str(body.get("message", ""))
    constraint_match = _CONSTRAINT.search(message)
    constraint = constraint_match.group(1) if constraint_match else ""

    # Safe to log: a SQLSTATE and a schema identifier (no values).
    logger.info(
        "crm data layer refused: http=%s sqlstate=%s constraint=%s",
        status,
        code or "-",
        constraint or "-",
    )

    if status == 401 or code.startswith("PGRST30"):
        return TokenRejected(code or "401")
    if code == "42501":
        return Forbidden(code)
    if code == "23505":
        field = _UNIQUE_FIELDS.get(constraint)
        return DuplicateValueError(field) if field else ConflictError(code)
    if code == "23503":
        return InvalidReferenceError(code)
    if code == "P0002":
        return NotFoundError(code)
    if code == "SM001":  # dedicated SQLSTATEs: nothing here ever matches message text
        return InvalidTransitionError(code)
    if code == "SM002":
        return ContactSuppressedError(code)
    if code == "23514":
        return InvalidValueError(code)
    if code in _VALUE_CODES:
        return InvalidValueError(code)
    logger.warning(
        "crm data layer returned an unexpected error: http=%s sqlstate=%s", status, code or "-"
    )
    return UpstreamError(f"unexpected data-layer response ({status})")


def like_pattern(q: str) -> str:
    """A substring pattern for PostgREST's ilike with every LIKE metacharacter neutralised."""
    cleaned = "".join(ch for ch in q.strip() if ch.isprintable() and ch != "*")
    escaped = cleaned.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"ilike.*{escaped}*"


def payload_matches(payload: dict[str, Any], row: dict[str, Any]) -> bool:
    """Idempotent-create check: does the stored row carry exactly what this request asked for?"""
    return all(
        row.get(key) == value for key, value in payload.items() if key not in ("id", "tenant_id")
    )


# ----------------------------------------------------------------------------- implementation
class PostgrestCrmRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _headers(self, token: str, *, returning: bool = False) -> dict[str, str]:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if returning:
            headers["Prefer"] = "return=representation"
        return headers

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
        try:
            response = self._client.request(
                method,
                path,
                params=params,
                json=json,
                headers=self._headers(token, returning=returning),
            )
        except httpx.HTTPError as exc:
            # The text can include the URL (and so a search term): log the class only.
            logger.error("crm data layer unreachable: %s", exc.__class__.__name__)
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
    def _parse(spec: EntitySpec, row: Any) -> Any:
        try:
            return spec.out.model_validate(row)
        except (ValidationError, TypeError):
            # A pydantic error prints the offending input, i.e. the row. Drop it.
            logger.error("crm data layer returned a row that does not match %s", spec.out.__name__)
            raise UpstreamError("unexpected row shape") from None

    # ------------------------------------------------------------------ reads
    def list_rows(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        q: str | None,
        include_archived: bool,
    ) -> Page[Any]:
        spec = ENTITIES[entity]
        params = {
            "select": spec.select,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),  # one extra row tells us whether another page exists
        }
        if not include_archived:
            params["archived_at"] = "is.null"
        if cursor is not None:
            created_at, row_id = cursor  # already validated by decode_cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id}))"
            )
        if q and entity == "companies":
            params["name"] = like_pattern(q)

        rows = self._send("GET", f"/{spec.table}", token, params=params)
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        items = [self._parse(spec, row) for row in rows[:limit]]
        next_cursor = (
            encode_cursor(items[-1].created_at, items[-1].id) if len(rows) > limit else None
        )
        return Page[Any](items=items, next_cursor=next_cursor)

    def get_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID
    ) -> Any | None:
        spec = ENTITIES[entity]
        rows = self._send(
            "GET",
            f"/{spec.table}",
            token,
            params={
                "select": spec.select,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{row_id}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected row shape")
        return self._parse(spec, rows[0]) if rows else None

    # ------------------------------------------------------------------ writes
    def create_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> tuple[Any, bool]:
        spec = ENTITIES[entity]
        body = {**payload, "tenant_id": str(tenant_id)}
        try:
            rows = self._send(
                "POST",
                f"/{spec.table}",
                token,
                params={"select": spec.select},
                json=body,
                returning=True,
            )
        except (ConflictError, DuplicateValueError):
            # The id is already used (Postgres may report the primary key or a per-tenant unique
            # value such as the e-mail first, so both are checked). If THIS tenant already holds a
            # row with exactly this payload, it is a retry: return it. Everything else (a different
            # payload, or an id that belongs to another tenant and is invisible to us) is the same
            # generic conflict.
            existing = self._send(
                "GET",
                f"/{spec.table}",
                token,
                params={
                    "select": spec.select,
                    "tenant_id": f"eq.{tenant_id}",
                    "id": f"eq.{payload['id']}",
                    "limit": "1",
                },
            )
            if isinstance(existing, list) and existing and payload_matches(payload, existing[0]):
                return self._parse(spec, existing[0]), False
            raise
        if not isinstance(rows, list) or len(rows) != 1:
            raise UpstreamError("unexpected insert result")
        return self._parse(spec, rows[0]), True

    def list_claims(
        self, token: str, tenant_id: uuid.UUID, *, company_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        """The company's live (non-archived) claims, newest first. The caller's JWT only: RLS
        decides what is visible; the tenant filter is belt and braces."""
        rows = self._send(
            "GET",
            f"/{CLAIMS_FOR_SCORING}",
            token,
            params={
                "select": CLAIM_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "company_id": f"eq.{company_id}",
                # no archived_at filter: the view only returns live claims (and has no such column)
                "order": CLAIM_ORDER,
                "limit": str(CLAIMS_PER_COMPANY),
            },
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected claims shape")
        return [dict(row) for row in rows]

    def update_row(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        row_id: uuid.UUID,
        changes: dict[str, Any],
    ) -> Any:
        spec = ENTITIES[entity]
        rows = self._send(
            "PATCH",
            f"/{spec.table}",
            token,
            params={"select": spec.select, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{row_id}"},
            json=changes,
            returning=True,
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected update result")
        if not rows:
            raise NotFoundError("no row updated")
        return self._parse(spec, rows[0])

    def set_archived(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID, archived: bool
    ) -> Any:
        return self.update_row(
            token,
            entity,
            tenant_id,
            row_id,
            {"archived_at": datetime.now(UTC).isoformat() if archived else None},
        )

    def consent_rpc(self, token: str, function: str, args: dict[str, Any]) -> uuid.UUID | None:
        if function not in {"record_consent", "suppress_contact", "lift_suppression"}:
            raise ValueError("unknown consent function")
        result = self._send("POST", f"/rpc/{function}", token, json=args)
        if result is None:
            return None
        try:
            return uuid.UUID(str(result))
        except ValueError:
            raise UpstreamError("unexpected rpc result") from None
