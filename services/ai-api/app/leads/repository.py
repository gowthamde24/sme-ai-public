"""Leads and ICP data access behind an interface (Supabase PostgREST).

Carries the CALLER's JWT plus the public anon key for all requests.
Classifies errors by SQLSTATE only (no leaking of raw PostgREST error text).
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx
from pydantic import ValidationError

from app.crm.models import Page, encode_cursor
from app.crm.repository import (
    CLAIM_ORDER,
    CLAIM_SELECT,
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
from app.leads.review import score_inputs
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.leads.repository")

_ICP_FIELDS = ",".join(IcpConfigOut.model_fields)
_LABEL_FIELDS = ",".join(LeadLabelOut.model_fields)


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

    def create_lead_label(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        payload: dict[str, Any],
        score_snapshot: dict[str, Any] | None,
        icp_version_id: uuid.UUID | None,
    ) -> LeadLabelOut: ...

    def list_lead_labels(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        lead_id: uuid.UUID | None,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[LeadLabelOut]: ...

    def get_review_queue(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        score_band: str | None,
        include_blind_scores: bool,
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

    # ------------------------------------------------------------------------- Lead Labels
    def create_lead_label(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        payload: dict[str, Any],
        score_snapshot: dict[str, Any] | None,
        icp_version_id: uuid.UUID | None,
    ) -> LeadLabelOut:
        label_id = uuid.uuid4()
        score = score_snapshot.get("score") if score_snapshot else None
        score_max = score_snapshot.get("score_max_reachable") if score_snapshot else None

        body = {
            "id": str(label_id),
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
        if resp.status_code != 201:
            raise self._error(resp)
        data = resp.json()
        if not data:
            raise UpstreamError("No representation returned by PostgREST")
        return LeadLabelOut.model_validate(data[0])

    def list_lead_labels(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        lead_id: uuid.UUID | None,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[LeadLabelOut]:
        params: dict[str, str] = {
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
            "select": _LABEL_FIELDS,
        }
        if lead_id:
            params["lead_id"] = f"eq.{lead_id}"
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
        page_rows = rows[:limit]
        items = [LeadLabelOut.model_validate(r) for r in page_rows]

        next_cursor = None
        if has_more and items:
            last = items[-1]
            next_cursor = encode_cursor(last.created_at, last.id)

        return Page(items=items, next_cursor=next_cursor)

    # ------------------------------------------------------------------------- Review Queue
    def get_review_queue(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        score_band: str | None,
        include_blind_scores: bool,
    ) -> Page[ReviewQueueLeadOut]:
        lead_select = (
            "id,tenant_id,status,source,created_at,company_id,contact_id,"
            "company:companies(id,name,city,region,country,industry,tags,type,website),"
            "contact:contacts!leads_tenant_id_contact_id_fkey(id,full_name,email,phone,job_title)"
        )
        params: dict[str, str] = {
            "tenant_id": f"eq.{tenant_id}",
            "archived_at": "is.null",
            "order": "created_at.desc,id.desc",
            "limit": str(limit * 2),  # overfetch to allow post-scoring band filtering
            "select": lead_select,
        }
        if cursor:
            created_at, lid = cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{lid}))"
            )

        resp = self._client.get(
            f"{self._url}/leads",
            headers=self._headers(token),
            params=params,
        )
        if resp.status_code != 200:
            raise self._error(resp)

        lead_rows = resp.json()
        if not lead_rows:
            return Page(items=[], next_cursor=None)

        # 1. Fetch active ICP config
        active_icp = self.get_active_icp_config(token, tenant_id)

        # 2. Fetch newest claims for companies
        comp_ids = list({r["company_id"] for r in lead_rows if r.get("company_id")})
        claims_by_company: dict[str, list[dict[str, Any]]] = {}
        if comp_ids:
            cresp = self._client.get(
                f"{self._url}/claims",
                headers=self._headers(token),
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "company_id": f"in.({','.join(str(cid) for cid in comp_ids)})",
                    "archived_at": "is.null",
                    "order": CLAIM_ORDER,
                    "select": CLAIM_SELECT,
                },
            )
            if cresp.status_code == 200:
                for c in cresp.json():
                    cid = c.get("company_id")
                    if cid:
                        claims_by_company.setdefault(str(cid), []).append(c)

        # 3. Fetch evidence links for leads
        lead_ids = [r["id"] for r in lead_rows]
        evidence_by_lead: dict[str, list[dict[str, Any]]] = {}
        if lead_ids:
            eresp = self._client.get(
                f"{self._url}/evidence_links",
                headers=self._headers(token),
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "lead_id": f"in.({','.join(str(lid) for lid in lead_ids)})",
                    "archived_at": "is.null",
                    "order": "created_at.desc,id.desc",
                    "select": "lead_id,evidence:evidence(kind,url)",
                },
            )
            if eresp.status_code == 200:
                for el in eresp.json():
                    lid = el.get("lead_id")
                    ev = el.get("evidence")
                    if lid and ev:
                        evidence_by_lead.setdefault(str(lid), []).append(ev)

        # 4. Fetch latest labels for these leads
        labels_by_lead: dict[str, LeadLabelOut] = {}
        if lead_ids:
            lresp = self._client.get(
                f"{self._url}/lead_labels",
                headers=self._headers(token),
                params={
                    "tenant_id": f"eq.{tenant_id}",
                    "lead_id": f"in.({','.join(str(lid) for lid in lead_ids)})",
                    "order": "created_at.desc",
                    "select": _LABEL_FIELDS,
                },
            )
            if lresp.status_code == 200:
                for row in lresp.json():
                    lid = row.get("lead_id")
                    if lid and str(lid) not in labels_by_lead:
                        try:
                            labels_by_lead[str(lid)] = LeadLabelOut.model_validate(row)
                        except ValidationError:
                            pass

        # 5. Score and filter leads
        queue_items: list[ReviewQueueLeadOut] = []
        for r in lead_rows:
            lid = r["id"]
            company = r.get("company") or {}
            contact = r.get("contact")
            comp_claims = claims_by_company.get(str(r.get("company_id")), [])
            lead_evidence = evidence_by_lead.get(str(lid), [])

            score_val = None
            max_reachable = None
            band_val = None
            snap_val = None

            if active_icp:
                sc_res = score_inputs(
                    active_icp.config, company, contact, comp_claims, lead_evidence
                )
                score_val = sc_res.score
                max_reachable = sc_res.score_max_reachable
                band_val = sc_res.band
                snap_val = sc_res.to_snapshot()

            if score_band and band_val != score_band:
                continue

            latest_lbl = labels_by_lead.get(str(lid))

            # Blind scoring: if not include_blind_scores and lead is unlabeled, hide score
            visible_score = score_val if (include_blind_scores or latest_lbl is not None) else None
            visible_max = (
                max_reachable if (include_blind_scores or latest_lbl is not None) else None
            )
            visible_band = band_val if (include_blind_scores or latest_lbl is not None) else None
            visible_snap = snap_val if (include_blind_scores or latest_lbl is not None) else None

            queue_items.append(
                ReviewQueueLeadOut(
                    lead_id=r["id"],
                    status=r["status"],
                    source=r.get("source"),
                    created_at=r["created_at"],
                    company=company,
                    contact=contact,
                    latest_label=latest_lbl,
                    score=visible_score,
                    score_max_reachable=visible_max,
                    score_band=visible_band,
                    snapshot=visible_snap,
                )
            )
            if len(queue_items) == limit:
                break

        has_more = len(queue_items) == limit and len(lead_rows) > limit
        next_cursor = None
        if has_more and queue_items:
            last = queue_items[-1]
            next_cursor = encode_cursor(last.created_at, last.lead_id)

        return Page(items=queue_items, next_cursor=next_cursor)

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

