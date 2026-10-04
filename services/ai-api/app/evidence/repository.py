"""Evidence data access behind an interface (Supabase PostgREST today).

Same discipline as the CRM adapter (app/crm/repository.py): every call carries the CALLER's JWT and
the public anon key, so RLS, column grants and triggers decide. Failures are classified by SQLSTATE
only (shared `classify_error`); data-layer text (which can contain a URL or a snippet) is never
returned, logged, or chained into an exception.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.models import Page, encode_cursor
from app.crm.repository import ConflictError, NotFoundError, classify_error
from app.evidence.models import (
    HUMAN_PROVIDER,
    EvidenceLinkOut,
    EvidenceOut,
    TargetKind,
    derive_link_id,
)
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.evidence.repository")

_TARGET_COLUMN = {"company": "company_id", "lead": "lead_id"}
_EVIDENCE_FIELDS = ",".join(EvidenceOut.model_fields)
_LINK_FIELDS = ",".join(f for f in EvidenceLinkOut.model_fields if f != "evidence")
LINK_SELECT = f"{_LINK_FIELDS},evidence:evidence({_EVIDENCE_FIELDS})"
# !inner: a link whose evidence is archived is hidden together with it.
LINK_SELECT_INNER = f"{_LINK_FIELDS},evidence:evidence!inner({_EVIDENCE_FIELDS})"

_CONTENT_FIELDS = ("kind", "url", "reference", "snippet")
_DATE_FIELDS = ("published_at",)


class EvidenceRepository(Protocol):
    def list_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: TargetKind,
        target_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        include_archived: bool,
    ) -> Page[EvidenceLinkOut]: ...

    def create_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: TargetKind,
        target_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> tuple[EvidenceLinkOut, bool]: ...

    def get_link(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID
    ) -> EvidenceLinkOut | None: ...

    def set_link_archived(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, archived: bool
    ) -> EvidenceLinkOut: ...


def _same_instant(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return a is None and b is None
    try:
        left = a if isinstance(a, datetime) else datetime.fromisoformat(str(a))
        right = b if isinstance(b, datetime) else datetime.fromisoformat(str(b))
    except ValueError:
        return False
    return left == right


def retry_matches(payload: dict[str, Any], existing: EvidenceLinkOut) -> bool:
    """Idempotent-create check: is the stored evidence exactly what THIS request asked for?

    Compared: kind, url, reference, snippet (None when omitted), the provider the API sets, and the
    dates (retrieved_at only when the caller supplied one: otherwise it was the server's now()).
    """
    stored = existing.evidence
    if stored.provider != HUMAN_PROVIDER:
        return False
    for field in _CONTENT_FIELDS:
        value = payload.get(field)
        current = getattr(stored, field)
        current = current.value if hasattr(current, "value") else current
        if value != current:
            return False
    if not _same_instant(payload.get("published_at"), stored.published_at):
        return False
    return not (
        "retrieved_at" in payload
        and not _same_instant(payload["retrieved_at"], stored.retrieved_at)
    )


class PostgrestEvidenceRepository:
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
            # The text can include the URL: log the class only.
            logger.error("evidence data layer unreachable: %s", exc.__class__.__name__)
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
    def _parse(row: Any) -> EvidenceLinkOut:
        try:
            return EvidenceLinkOut.model_validate(row)
        except (ValidationError, TypeError):
            # A pydantic error prints the offending input, i.e. the row. Drop it.
            logger.error("evidence data layer returned a row that does not match EvidenceLinkOut")
            raise UpstreamError("unexpected row shape") from None

    # ------------------------------------------------------------------ reads
    def list_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: TargetKind,
        target_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        include_archived: bool,
    ) -> Page[EvidenceLinkOut]:
        params = {
            "select": LINK_SELECT_INNER,
            "tenant_id": f"eq.{tenant_id}",
            _TARGET_COLUMN[target_kind]: f"eq.{target_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),  # one extra row tells us whether another page exists
        }
        if not include_archived:
            params["archived_at"] = "is.null"
            params["evidence.archived_at"] = "is.null"
        if cursor is not None:
            created_at, row_id = cursor  # already validated by decode_cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id}))"
            )
        rows = self._send("GET", "/evidence_links", token, params=params)
        if not isinstance(rows, list):
            raise UpstreamError("unexpected list shape")
        items = [self._parse(row) for row in rows[:limit]]
        next_cursor = (
            encode_cursor(items[-1].created_at, items[-1].id) if len(rows) > limit else None
        )
        return Page[EvidenceLinkOut](items=items, next_cursor=next_cursor)

    def get_link(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID
    ) -> EvidenceLinkOut | None:
        rows = self._send(
            "GET",
            "/evidence_links",
            token,
            params={
                "select": LINK_SELECT,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{link_id}",
                "limit": "1",
            },
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected row shape")
        return self._parse(rows[0]) if rows else None

    # ------------------------------------------------------------------ writes
    def create_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: TargetKind,
        target_id: uuid.UUID,
        payload: dict[str, Any],
    ) -> tuple[EvidenceLinkOut, bool]:
        evidence_id = uuid.UUID(str(payload["id"]))
        link_id = derive_link_id(evidence_id, target_kind, target_id)
        args: dict[str, Any] = {
            "p_tenant_id": str(tenant_id),
            "p_evidence_id": str(evidence_id),
            "p_link_id": str(link_id),
            "p_target_kind": target_kind,
            "p_target_id": str(target_id),
            "p_kind": payload["kind"],
            "p_provider": HUMAN_PROVIDER,
        }
        for field in ("url", "reference", "snippet", "retrieved_at", "published_at"):
            if payload.get(field) is not None:
                args[f"p_{field}"] = payload[field]
        try:
            self._send("POST", "/rpc/create_evidence_with_link", token, json=args)
        except ConflictError:
            # The id is already used. If THIS tenant already holds this evidence, linked to this
            # target, with exactly this payload, it is a retry: return it. Everything else (a
            # different payload, a different target, or an id that belongs to another tenant and is
            # invisible to us) is the same generic conflict.
            existing = self.get_link(token, tenant_id, link_id)
            if (
                existing is not None
                and existing.evidence.id == evidence_id
                and retry_matches(payload, existing)
            ):
                return existing, False
            raise
        created = self.get_link(token, tenant_id, link_id)
        if created is None:
            raise UpstreamError("unexpected insert result")
        return created, True

    def set_link_archived(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, archived: bool
    ) -> EvidenceLinkOut:
        rows = self._send(
            "PATCH",
            "/evidence_links",
            token,
            params={"select": LINK_SELECT, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{link_id}"},
            json={"archived_at": datetime.now(UTC).isoformat() if archived else None},
            returning=True,
        )
        if not isinstance(rows, list):
            raise UpstreamError("unexpected update result")
        if not rows:
            raise NotFoundError("no row updated")
        return self._parse(rows[0])
