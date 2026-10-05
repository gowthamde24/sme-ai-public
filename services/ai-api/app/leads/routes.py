"""Lead review, import, ICP config, and export endpoints under /v1/tenants/{tenant_id}/...

Authorization order:
  1. Valid JWT (401)
  2. Membership of path tenant (404 if foreign/unknown)
  3. Role check (403)
  4. Target lead exists (404)
  5. PostgREST / Postgres RLS decides
"""

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CursorError, Page, decode_cursor, parse_uuid
from app.errors import ApiError, not_found
from app.leads.export import build_lead_labels_csv, build_lead_labels_json
from app.leads.models import (
    ExportFormat,
    ExportRequest,
    IcpConfigCreate,
    IcpConfigOut,
    ImportBatchReport,
    ImportBatchRequest,
    LeadLabelCreate,
    LeadLabelOut,
    ReviewQueueLeadOut,
)
from app.leads.review import score_inputs
from app.tenancy.models import Role

audit_log = logging.getLogger("app.leads.audit")

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
ADMIN_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN)

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(*ADMIN_PLUS))]
# ADR 0016: publishing a profile and exporting need a second factor from an Owner or Admin
AdminStrong = Annotated[TenantContext, Depends(require_tenant_role(*ADMIN_PLUS, strong=True))]


def _parse_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


# ----------------------------------------------------------------------------- ICP Configs


@router.post("/icp-configs", response_model=IcpConfigOut, status_code=201)
def publish_icp_config(
    payload: IcpConfigCreate,
    ctx: AdminStrong,
    runtime: RuntimeDep,
) -> IcpConfigOut:
    return runtime.leads.publish_icp_config(
        ctx.principal.token,
        ctx.tenant.id,
        payload.model_dump(),
    )


@router.get("/icp-configs", response_model=Page[IcpConfigOut])
def list_icp_configs(
    ctx: AnyMember,
    runtime: RuntimeDep,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None),
) -> Page[IcpConfigOut]:
    try:
        decoded = decode_cursor(cursor) if cursor else None
    except CursorError:
        raise ApiError(422, "invalid_cursor", "Invalid pagination cursor.") from None
    return runtime.leads.list_icp_configs(
        ctx.principal.token,
        ctx.tenant.id,
        limit=limit,
        cursor=decoded,
    )


@router.get("/icp-configs/active", response_model=IcpConfigOut)
def get_active_icp_config(
    ctx: AnyMember,
    runtime: RuntimeDep,
) -> IcpConfigOut:
    cfg = runtime.leads.get_active_icp_config(ctx.principal.token, ctx.tenant.id)
    if cfg is None:
        raise not_found()
    return cfg


@router.get("/icp-configs/{version_id}", response_model=IcpConfigOut)
def get_icp_config(
    version_id: str,
    ctx: AnyMember,
    runtime: RuntimeDep,
) -> IcpConfigOut:
    vid = _parse_id(version_id)
    cfg = runtime.leads.get_icp_config(ctx.principal.token, ctx.tenant.id, vid)
    if cfg is None:
        raise not_found()
    return cfg


# ----------------------------------------------------------------------------- Lead Import


@router.post("/leads/import/preview", response_model=ImportBatchReport, status_code=200)
def preview_lead_import(
    payload: ImportBatchRequest,
    ctx: SalesPlus,
    runtime: RuntimeDep,
) -> ImportBatchReport:
    rows = [r.model_dump(exclude_none=True) for r in payload.rows]
    return runtime.leads.import_leads(
        ctx.principal.token,
        ctx.tenant.id,
        payload.batch_id,
        rows,
        dry_run=True,
        label=payload.label,
    )


@router.post("/leads/import", response_model=ImportBatchReport, status_code=201)
def commit_lead_import(
    payload: ImportBatchRequest,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    response: Response,
) -> ImportBatchReport:
    rows = [r.model_dump(exclude_none=True) for r in payload.rows]
    report = runtime.leads.import_leads(
        ctx.principal.token,
        ctx.tenant.id,
        payload.batch_id,
        rows,
        dry_run=False,
        label=payload.label,
    )
    if report.replayed:
        response.status_code = 200
    return report


# ----------------------------------------------------------------------------- Review Queue


@router.get("/leads/review-queue", response_model=Page[ReviewQueueLeadOut])
def get_review_queue(
    ctx: AnyMember,
    runtime: RuntimeDep,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
    score_band: str | None = Query(default=None),
    blind: bool = Query(default=True),
    unreviewed: bool = Query(default=False),
) -> Page[ReviewQueueLeadOut]:
    """Blind review is the default: scores of leads the CALLER has not labelled are hidden, the
    order does not depend on any score, and a score band cannot be requested.
    `blind=false` is a
    deliberate opt-in, and every such request is logged (who, which tenant; nothing else)."""
    if blind and score_band is not None:
        raise ApiError(
            422,
            "score_band_requires_unblinded_view",
            "A score band can only be requested with blind=false.",
        )
    try:
        decoded = decode_cursor(cursor) if cursor else None
    except CursorError:
        raise ApiError(422, "invalid_cursor", "Invalid pagination cursor.") from None

    if not blind:
        audit_log.info(
            "non_blind_review_queue tenant=%s user=%s", ctx.tenant.id, ctx.principal.user_id
        )

    return runtime.leads.get_review_queue(
        ctx.principal.token,
        ctx.tenant.id,
        caller_id=ctx.principal.user_id,
        limit=limit,
        cursor=decoded,
        score_band=score_band,
        include_blind_scores=not blind,
        unreviewed_only=unreviewed,
    )


# ----------------------------------------------------------------------------- Lead Labels


@router.post("/leads/{lead_id}/labels", response_model=LeadLabelOut, status_code=201)
def create_lead_label(
    lead_id: str,
    payload: LeadLabelCreate,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    response: Response,
) -> LeadLabelOut:
    """Idempotent on the client's `id`: 201 the first time, 200 with the stored label for a retry of
    the same payload, 409 (one generic answer) for any other use of an id."""
    lid = _parse_id(lead_id)
    # Check lead exists in this tenant
    lead = runtime.crm.get_row(ctx.principal.token, "leads", ctx.tenant.id, lid)
    if lead is None:
        raise not_found()

    # Calculate score snapshot using active ICP config
    active_icp = runtime.leads.get_active_icp_config(ctx.principal.token, ctx.tenant.id)
    score_snapshot: dict[str, Any] | None = None
    icp_version_id: uuid.UUID | None = None

    if active_icp is not None:
        icp_version_id = active_icp.id
        cid = (
            getattr(lead, "company_id", None)
            if not isinstance(lead, dict)
            else lead.get("company_id")
        )
        company = (
            runtime.crm.get_row(ctx.principal.token, "companies", ctx.tenant.id, cid)
            if cid
            else None
        )
        ctid = (
            getattr(lead, "contact_id", None)
            if not isinstance(lead, dict)
            else lead.get("contact_id")
        )
        contact = (
            runtime.crm.get_row(ctx.principal.token, "contacts", ctx.tenant.id, ctid)
            if ctid
            else None
        )

        # The very inputs the review queue scores with (app.leads.review): claims, evidence,
        # ICP.
        claims = (
            runtime.crm.list_claims(ctx.principal.token, ctx.tenant.id, company_id=cid)
            if cid
            else []
        )
        # the same reader the review queue uses (evidence_for_scoring): unaccepted agent
        # evidence never counts
        evidence_items = runtime.leads.list_scoring_evidence(
            ctx.principal.token, ctx.tenant.id, lid
        )
        sc_res = score_inputs(active_icp.config, company, contact, claims, evidence_items)
        score_snapshot = sc_res.to_snapshot()

    label, created = runtime.leads.create_lead_label(
        ctx.principal.token,
        ctx.tenant.id,
        lid,
        payload.model_dump(mode="json"),
        score_snapshot,
        icp_version_id,
    )
    response.status_code = 201 if created else 200
    return label


@router.get("/leads/{lead_id}/labels", response_model=Page[LeadLabelOut])
def list_lead_labels(
    lead_id: str,
    ctx: AnyMember,
    runtime: RuntimeDep,
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),
) -> Page[LeadLabelOut]:
    lid = _parse_id(lead_id)
    lead = runtime.crm.get_row(ctx.principal.token, "leads", ctx.tenant.id, lid)
    if lead is None:
        raise not_found()

    try:
        decoded = decode_cursor(cursor) if cursor else None
    except CursorError:
        raise ApiError(422, "invalid_cursor", "Invalid pagination cursor.") from None

    return runtime.leads.list_lead_labels(
        ctx.principal.token,
        ctx.tenant.id,
        viewer_id=ctx.principal.user_id,
        lead_id=lid,
        limit=limit,
        cursor=decoded,
    )


# ----------------------------------------------------------------------------- Exports


@router.post("/exports")
def export_dataset(
    payload: ExportRequest,
    ctx: AdminStrong,
    runtime: RuntimeDep,
) -> Response:
    rows = runtime.leads.fetch_export_rows(ctx.principal.token, ctx.tenant.id, payload.kind)

    if payload.format == ExportFormat.CSV:
        content, row_count, content_sha256 = build_lead_labels_csv(rows)
        media_type = "text/csv; charset=utf-8"
        filename = "lead_labels.csv"
    else:
        content, row_count, content_sha256 = build_lead_labels_json(rows)
        media_type = "application/json; charset=utf-8"
        filename = "lead_labels.json"

    # Record export in data_exports
    runtime.leads.record_data_export(
        ctx.principal.token,
        ctx.tenant.id,
        payload.kind.value,
        payload.format.value,
        row_count,
        content_sha256,
    )

    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Sha256": content_sha256,
            "X-Export-Rows": str(row_count),
        },
    )
