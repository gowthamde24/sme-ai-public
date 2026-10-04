"""Leads and ICP data access behind an interface (Supabase PostgREST).

Carries the CALLER's JWT plus the public anon key for all requests.
Classifies errors by SQLSTATE only (no leaking of raw PostgREST error text).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.models import Page, encode_cursor
from app.crm.repository import (
    CLAIM_ORDER,
    CLAIM_SELECT,
    CLAIMS_FOR_SCORING,
    ConflictError,
    classify_error,
)
from app.leads.models import (
    ExportKind,
    ExportRecordOut,
    IcpConfigOut,
    ImportBatchReport,
    LeadLabelOut,
    ReviewQueueLeadOut,
)
from app.leads.review import MAX_EVIDENCE_INPUTS, hide_scores, score_inputs
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.leads.repository")

# What the evidence-quality factor of the score reads, for the review queue AND the label
# snapshot (ONE definition, like CLAIMS_FOR_SCORING): the evidence_for_scoring VIEW. Evidence
# written by an agent counts only once a human accepted a claim that cites it as support.
# Never the raw evidence_links table.
EVIDENCE_FOR_SCORING = "evidence_for_scoring"
EVIDENCE_SELECT = "lead_id,kind,url"
EVIDENCE_ORDER = "created_at.desc,link_id.desc"

_ICP_FIELDS = ",".join(IcpConfigOut.model_fields)
_LABEL_FIELDS = ",".join(LeadLabelOut.model_fields)
_QUEUE_LEAD_SELECT = (
    "id,tenant_id,status,source,created_at,company_id,contact_id,"
    "company:companies(id,name,city,region,country,industry,tags,type,website),"
    "contact:contacts!leads_tenant_id_contact_id_fkey(id,full_name,email,phone,job_title)"
)
# A band-filtered scan reads at most this many pages of leads per request.
MAX_SCAN_PAGES = 10


@dataclass
class _QueueContext:
    claims: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    evidence: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    own_labels: dict[str, LeadLabelOut] = field(default_factory=dict)


class LeadsRepository(Protocol):
    def publish_icp_config(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> IcpConfigOut: ...

    def list_icp_configs(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[IcpConfigOut]: ...

    def get_icp_config(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> IcpConfigOut | None: ...

    def get_active_icp_config(self, token: str, tenant_id: uuid.UUID) -> IcpConfigOut | None: ...

    def import_leads(
        self,
        token: str,
        tenant_id: uuid.UUID,
        batch_id: uuid.UUID,
        rows: list[dict[str, Any]],
        *,
        dry_run: bool,
        label: str | None,
    ) -> ImportBatchReport: ...

    def list_scoring_evidence(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> list[dict[str, Any]]: ...

    def create_lead_label(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        payload: dict[str, Any],
        score_snapshot: dict[str, Any] | None,
        icp_version_id: uuid.UUID | None,
    ) -> tuple[LeadLabelOut, bool]: ...

    def list_lead_labels(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        viewer_id: uuid.UUID,
        lead_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[LeadLabelOut]: ...

    def get_review_queue(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        caller_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        score_band: str | None,
        include_blind_scores: bool,
        unreviewed_only: bool = False,
    ) -> Page[ReviewQueueLeadOut]: ...

    def record_data_export(
        self,
        token: str,
        tenant_id: uuid.UUID,
        kind: str,
        export_format: str,
        row_count: int,
        content_sha256: str,
    ) -> ExportRecordOut: ...

    def fetch_export_rows(
        self, token: str, tenant_id: uuid.UUID, kind: ExportKind
    ) -> list[dict[str, Any]]: ...


class PostgrestLeadsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._url = rest_url.rstrip("/")
        self._anon = anon_key
        self._client = client or httpx.Client(timeout=20.0)

    def close(self) -> None:
        self._client.close()

    def _headers(self, token: str, **extra: str) -> dict[str, str]:
        return {
            "apikey": self._anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            **extra,
        }

    def _error(self, resp: httpx.Response) -> Exception:
        try:
            body = resp.json()
        except ValueError:
            body = None
        return classify_error(resp.status_code, body)

    # ------------------------------------------------------------------------- ICP Configs
    def publish_icp_config(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> IcpConfigOut:
        config_id = uuid.uuid4()
        body = {
            "id": str(config_id),
            "tenant_id": str(tenant_id),
            "engine": payload.get("engine", "icp-rules"),
            "schema_version": payload.get("schema_version", 1),
            "config": payload["config"],
        }
        resp = self._client.post(
            f"{self._url}/icp_config_versions",
            headers=self._headers(token, Prefer="return=representation"),
            json=body,
        )
        if resp.status_code != 201:
            raise self._error(resp)
        data = resp.json()
        if not data:
            raise UpstreamError("No representation returned by PostgREST")
        try:
            return IcpConfigOut.model_validate(data[0])
        except ValidationError as exc:
            logger.error("invalid ICP config representation: %s", exc)
            raise UpstreamError("Invalid representation returned") from exc

    def list_icp_configs(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[IcpConfigOut]:
        params: dict[str, str] = {
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
            "select": _ICP_FIELDS,
        }
        if cursor:
            created_at, cid = cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{cid}))"
            )

        resp = self._client.get(
            f"{self._url}/icp_config_versions",
            headers=self._headers(token),
            params=params,
        )
        if resp.status_code != 200:
            raise self._error(resp)

        rows = resp.json()
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        items = [IcpConfigOut.model_validate(r) for r in page_rows]

        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return Page(items=items, next_cursor=next_cursor)

    def get_icp_config(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> IcpConfigOut | None:
        resp = self._client.get(
            f"{self._url}/icp_config_versions",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{version_id}",
                "select": _ICP_FIELDS,
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        rows = resp.json()
        if not rows:
            return None
        return IcpConfigOut.model_validate(rows[0])

    def get_active_icp_config(self, token: str, tenant_id: uuid.UUID) -> IcpConfigOut | None:
        resp = self._client.get(
            f"{self._url}/icp_config_versions",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "order": "version_no.desc",
                "limit": "1",
                "select": _ICP_FIELDS,
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        rows = resp.json()
        if not rows:
            return None
        return IcpConfigOut.model_validate(rows[0])

    # ------------------------------------------------------------------------- Lead Import
    def import_leads(
        self,
        token: str,
        tenant_id: uuid.UUID,
        batch_id: uuid.UUID,
        rows: list[dict[str, Any]],
        *,
        dry_run: bool,
        label: str | None,
    ) -> ImportBatchReport:
        body: dict[str, Any] = {
            "p_tenant_id": str(tenant_id),
            "p_batch_id": str(batch_id),
            "p_rows": rows,
            "p_dry_run": dry_run,
        }
        if label is not None:
            body["p_label"] = label

        resp = self._client.post(
            f"{self._url}/rpc/import_lead_rows",
            headers=self._headers(token),
            json=body,
        )
        if resp.status_code != 200:
            raise self._error(resp)
        return ImportBatchReport.model_validate(resp.json())

    # ------------------------------------------------------------------------- scoring
    # evidence
    def list_scoring_evidence(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        """The evidence a lead's score is computed from: the same view, order and columns the
        queue uses."""
        resp = self._client.get(
            f"{self._url}/{EVIDENCE_FOR_SCORING}",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"eq.{lead_id}",
                "order": EVIDENCE_ORDER,
                "select": EVIDENCE_SELECT,
                "limit": str(MAX_EVIDENCE_INPUTS),
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        return [dict(row) for row in resp.json()]

    # ------------------------------------------------------------------------- Lead Labels
    def create_lead_label(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        payload: dict[str, Any],
        score_snapshot: dict[str, Any] | None,
        icp_version_id: uuid.UUID | None,
    ) -> tuple[LeadLabelOut, bool]:
        """Insert one label under the CLIENT's id. Returns (label, created).

        The id makes a retry harmless: if it is already used and THIS tenant's label
        with that id
        carries the same lead / label / reason, the stored label is returned with
        created=False.
        Every other use of the id (a different payload, or an id another tenant holds,
        which RLS
        hides from the lookup) raises the same ConflictError: nothing reveals which
        case it was."""
        score = score_snapshot.get("score") if score_snapshot else None
        score_max = score_snapshot.get("score_max_reachable") if score_snapshot else None

        body = {
            "id": str(payload["id"]),
            "tenant_id": str(tenant_id),
            "lead_id": str(lead_id),
            "label": payload["label"],
            "reason_code": payload.get("reason_code"),
            "icp_version_id": str(icp_version_id) if icp_version_id else None,
            "score": score,
            "score_max_reachable": score_max,
            "snapshot": score_snapshot,
        }
        resp = self._client.post(
            f"{self._url}/lead_labels",
            headers=self._headers(token, Prefer="return=representation"),
            json=body,
        )
        if resp.status_code == 201:
            data = resp.json()
            if not data:
                raise UpstreamError("No representation returned by PostgREST")
            return LeadLabelOut.model_validate(data[0]), True

        error = self._error(resp)
        if not isinstance(error, ConflictError):
            raise error
        existing = self._label_by_id(token, tenant_id, str(payload["id"]))
        if existing is not None and self._same_label(existing, lead_id, payload):
            return existing, False
        raise error

    def _label_by_id(self, token: str, tenant_id: uuid.UUID, label_id: str) -> LeadLabelOut | None:
        resp = self._client.get(
            f"{self._url}/lead_labels",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{label_id}",
                "select": _LABEL_FIELDS,
                "limit": "1",
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        rows = resp.json()
        return LeadLabelOut.model_validate(rows[0]) if rows else None

    @staticmethod
    def _same_label(existing: LeadLabelOut, lead_id: uuid.UUID, payload: dict[str, Any]) -> bool:
        return (
            existing.lead_id == lead_id
            and existing.label.value == payload["label"]
            and (existing.reason_code.value if existing.reason_code else None)
            == payload.get("reason_code")
        )

    def list_lead_labels(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        viewer_id: uuid.UUID,
        lead_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[LeadLabelOut]:
        """A lead's label history, newest first. Blind review applies here too: until the VIEWER
        has labelled this lead themselves, other reviewers' labels show their verdict
        but not the
        score, score ceiling or factor snapshot stored with them."""
        params: dict[str, str] = {
            "tenant_id": f"eq.{tenant_id}",
            "lead_id": f"eq.{lead_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
            "select": _LABEL_FIELDS,
        }
        if cursor:
            created_at, cid = cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{cid}))"
            )

        resp = self._client.get(
            f"{self._url}/lead_labels",
            headers=self._headers(token),
            params=params,
        )
        if resp.status_code != 200:
            raise self._error(resp)

        rows = resp.json()
        has_more = len(rows) > limit
        items = [LeadLabelOut.model_validate(r) for r in rows[:limit]]

        if items and not self._viewer_has_labelled(token, tenant_id, lead_id, viewer_id, items):
            items = [hide_scores(item) for item in items]

        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return Page(items=items, next_cursor=next_cursor)

    def _viewer_has_labelled(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        viewer_id: uuid.UUID,
        page: list[LeadLabelOut],
    ) -> bool:
        if any(item.created_by == viewer_id for item in page):
            return True
        resp = self._client.get(
            f"{self._url}/lead_labels",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"eq.{lead_id}",
                "created_by": f"eq.{viewer_id}",
                "select": "id",
                "limit": "1",
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        return bool(resp.json())

    # ------------------------------------------------------------------------- Review Queue
    def get_review_queue(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        caller_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        score_band: str | None,
        include_blind_scores: bool,
        unreviewed_only: bool = False,
    ) -> Page[ReviewQueueLeadOut]:
        """One page of the queue, always newest first by (created_at, id): the order is
        independent of every score.

        Blind review (include_blind_scores=False, the default): a lead's score, band
        and factor
        snapshot are shown only for leads the CALLER has labelled; another reviewer's label
        changes nothing for this caller, and a score band cannot be requested at all
        (filtering on
        a hidden value would reveal it). The non-blind view is a deliberate opt-in.
        """
        if score_band is not None and not include_blind_scores:
            raise ValueError("a score band can only be requested in a non-blind view")

        active_icp = self.get_active_icp_config(token, tenant_id)
        # Without a filter one extra row tells us whether another page exists. With a filter
        # some rows are dropped, so scan forward (bounded) until a full page and one more has
        # matched.
        filtered = score_band is not None or unreviewed_only
        page_size = max(2 * limit, 50) if filtered else limit + 1
        matched: list[ReviewQueueLeadOut] = []
        position = cursor
        scan_cursor: tuple[str, uuid.UUID] | None = None
        exhausted = False
        for _ in range(MAX_SCAN_PAGES):
            rows = self._lead_page(token, tenant_id, position, page_size)
            context = self._scoring_context(token, tenant_id, rows, caller_id)
            for row in rows:
                item = self._queue_item(row, context, active_icp, include_blind_scores)
                position = (row["created_at"], uuid.UUID(row["id"]))
                if (score_band is None or item.score_band == score_band) and (
                    not unreviewed_only or item.latest_label is None
                ):
                    matched.append(item)
                if len(matched) > limit:
                    break
            if len(matched) > limit or len(rows) < page_size:
                exhausted = len(matched) <= limit
                break
            scan_cursor = position
        else:
            exhausted = False

        if len(matched) > limit:
            items = matched[:limit]
            last = items[-1]
            return Page(items=items, next_cursor=encode_cursor(last.created_at, last.lead_id))
        if exhausted:
            return Page(items=matched, next_cursor=None)
        # scan budget spent with rows left: resume after the last row looked at
        resume = scan_cursor or cursor
        return Page(
            items=matched,
            next_cursor=(
                encode_cursor(datetime.fromisoformat(resume[0]), resume[1]) if resume else None
            ),
        )

    def _lead_page(
        self,
        token: str,
        tenant_id: uuid.UUID,
        position: tuple[str, uuid.UUID] | None,
        size: int,
    ) -> list[dict[str, Any]]:
        params: dict[str, str] = {
            "tenant_id": f"eq.{tenant_id}",
            "archived_at": "is.null",
            "order": "created_at.desc,id.desc",
            "limit": str(size),
            "select": _QUEUE_LEAD_SELECT,
        }
        if position:
            created_at, lid = position
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{lid}))"
            )
        resp = self._client.get(f"{self._url}/leads", headers=self._headers(token), params=params)
        if resp.status_code != 200:
            raise self._error(resp)
        rows: list[dict[str, Any]] = resp.json()
        return rows

    def _scoring_context(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_rows: list[dict[str, Any]],
        caller_id: uuid.UUID,
    ) -> _QueueContext:
        """Everything the score of these leads depends on, plus the CALLER's own labels. A failed
        read raises: scoring with some inputs missing would silently under-report a lead."""
        context = _QueueContext()
        if not lead_rows:
            return context
        company_ids = sorted({str(r["company_id"]) for r in lead_rows if r.get("company_id")})
        lead_ids = [str(r["id"]) for r in lead_rows]
        if company_ids:
            resp = self._client.get(
                f"{self._url}/{CLAIMS_FOR_SCORING}",
                headers=self._headers(token),
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "company_id": f"in.({','.join(company_ids)})",
                    # no archived_at filter: the view returns live claims only
                    "order": CLAIM_ORDER,
                    "select": CLAIM_SELECT,
                },
            )
            if resp.status_code != 200:
                raise self._error(resp)
            for claim in resp.json():
                context.claims.setdefault(str(claim["company_id"]), []).append(claim)

        resp = self._client.get(
            f"{self._url}/{EVIDENCE_FOR_SCORING}",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"in.({','.join(lead_ids)})",
                "order": EVIDENCE_ORDER,
                "select": EVIDENCE_SELECT,
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        for row in resp.json():
            if row.get("lead_id"):
                context.evidence.setdefault(str(row["lead_id"]), []).append(
                    {"kind": row.get("kind"), "url": row.get("url")}
                )

        # Only the caller's own labels: another reviewer's label must neither unblind a lead
        # for this caller nor appear (with its stored score) in their queue.
        resp = self._client.get(
            f"{self._url}/lead_labels",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "lead_id": f"in.({','.join(lead_ids)})",
                "created_by": f"eq.{caller_id}",
                "order": "created_at.desc,id.desc",
                "select": _LABEL_FIELDS,
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)
        for row in resp.json():
            lead_key = str(row["lead_id"])
            if lead_key not in context.own_labels:  # newest first: keep the newest
                context.own_labels[lead_key] = LeadLabelOut.model_validate(row)
        return context

    @staticmethod
    def _queue_item(
        row: dict[str, Any],
        context: _QueueContext,
        active_icp: IcpConfigOut | None,
        include_blind_scores: bool,
    ) -> ReviewQueueLeadOut:
        lead_key = str(row["id"])
        company = row.get("company") or {}
        contact = row.get("contact")
        own_label = context.own_labels.get(lead_key)
        result = (
            score_inputs(
                active_icp.config,
                company,
                contact,
                context.claims.get(str(row.get("company_id")), []),
                context.evidence.get(lead_key, []),
            )
            if active_icp
            else None
        )
        visible = result if (include_blind_scores or own_label is not None) else None
        return ReviewQueueLeadOut(
            lead_id=row["id"],
            status=row["status"],
            source=row.get("source"),
            created_at=row["created_at"],
            company=company,
            contact=contact,
            latest_label=own_label,
            score=visible.score if visible else None,
            score_max_reachable=visible.score_max_reachable if visible else None,
            score_band=visible.band if visible else None,
            snapshot=visible.to_snapshot() if visible else None,
        )

    # ------------------------------------------------------------------------- Exports
    def record_data_export(
        self,
        token: str,
        tenant_id: uuid.UUID,
        kind: str,
        export_format: str,
        row_count: int,
        content_sha256: str,
    ) -> ExportRecordOut:
        export_id = uuid.uuid4()
        body = {
            "id": str(export_id),
            "tenant_id": str(tenant_id),
            "kind": kind,
            "format": export_format,
            "row_count": row_count,
            "content_sha256": content_sha256,
        }
        resp = self._client.post(
            f"{self._url}/data_exports",
            headers=self._headers(token, Prefer="return=representation"),
            json=body,
        )
        if resp.status_code != 201:
            raise self._error(resp)
        data = resp.json()
        if not data:
            raise UpstreamError("No representation returned by PostgREST")
        return ExportRecordOut.model_validate(data[0])

    def fetch_export_rows(
        self, token: str, tenant_id: uuid.UUID, kind: ExportKind
    ) -> list[dict[str, Any]]:
        # Fetch newest labels per lead with company/lead metadata
        resp = self._client.get(
            f"{self._url}/lead_labels",
            headers=self._headers(token),
            params={
                "tenant_id": f"eq.{tenant_id}",
                "order": "created_at.desc",
                "select": (
                    "lead_id,label,reason_code,score,score_max_reachable,created_at,"
                    "lead:leads(source,company:companies(name,city))"
                ),
            },
        )
        if resp.status_code != 200:
            raise self._error(resp)

        rows = resp.json()
        seen_leads: set[str] = set()
        flat_rows: list[dict[str, Any]] = []

        for r in rows:
            lid = str(r["lead_id"])
            if lid in seen_leads:
                continue
            seen_leads.add(lid)

            lead = r.get("lead") or {}
            comp = lead.get("company") or {}

            score = r.get("score")
            score_max = r.get("score_max_reachable")
            band = "unscored"
            if score is not None:
                if score >= 80:
                    band = "priority"
                elif score >= 65:
                    band = "worth_reviewing"
                elif score >= 50:
                    band = "maybe"
                else:
                    band = "low_priority"

            flat_rows.append(
                {
                    "lead_id": lid,
                    "company_name": comp.get("name") or "",
                    "company_city": comp.get("city") or "",
                    "lead_source": lead.get("source") or "",
                    "label": r["label"],
                    "reason_code": r.get("reason_code") or "",
                    "score": score if score is not None else "",
                    "score_max_reachable": score_max if score_max is not None else "",
                    "score_band": band,
                    "created_at": r["created_at"],
                }
            )
        return flat_rows
