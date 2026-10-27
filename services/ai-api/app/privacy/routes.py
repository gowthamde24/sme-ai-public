"""Privacy rights (job BN, ADR 0075): the person's own data and the workspace's data, deletion, retention and grievances.

  A PERSON (any signed-in account; the database checks that every row is theirs)
    POST /v1/me/data-exports                          {export_id}                 -> 202 {export}   ask for a copy of what the account holds about me (made in the background)
    GET  /v1/me/data-exports                                                       -> {exports: [...]}   mine, newest first (person and workspace ones)
    GET  /v1/me/data-exports/{id}                                                  -> {export}
    POST /v1/me/data-exports/{id}/link                                             -> {url, link_valid_seconds, file_expires_at, size_bytes, sha256}   a signed link that works for 5 minutes; counted and audited
    POST /v1/me/deletion-requests                     {request_id, confirm_email}  -> 201 {deletion}   delete MY account after a 14-day cooling-off
    GET  /v1/me/deletion-requests                                                  -> {deletions: [...]}
    POST /v1/me/deletion-requests/{id}/cancel                                      -> {deletion}
  A WORKSPACE
    POST /v1/tenants/{t}/data-exports                 {export_id, confirm_name}   Owner (+ the code if the authenticator is on) -> 202 {export}   the Owner types the business name; a notice e-mail follows
    POST /v1/tenants/{t}/deletion-requests            {request_id, confirm_name}   Owner + 2nd factor -> 201 {deletion}   (the existing erasure is requested at once and runs only after the cooling-off)
    GET  /v1/tenants/{t}/deletion-requests                                  Owner/Admin -> {deletions: [...]}
    POST /v1/tenants/{t}/deletion-requests/{id}/cancel                      Owner       -> {deletion}
    POST /v1/tenants/{t}/deletion-requests/{id}/execute                     Owner + 2nd factor, after the cooling-off -> {deletion, erasure}
    GET  /v1/tenants/{t}/retention                                          Owner/Admin -> {chats_days, voice_days, enquiries_days, scheduler_days, audit_days, updated_at, last_run_at}
    PUT  /v1/tenants/{t}/retention                    {five days fields, null = keep}   Owner + 2nd factor
    POST /v1/tenants/{t}/retention/preview            {five days fields} (optional)   Owner/Admin -> {counts}   what the next clean-up would remove
    POST /v1/tenants/{t}/grievances                   {grievance_id, kind, subject, details, on_behalf, requester_name, requester_contact}  Owner/Admin/Sales -> 201 {grievance}
    GET  /v1/tenants/{t}/grievances?status=           Owner/Admin see all, Sales their own -> {grievances: [...]}
    GET  /v1/tenants/{t}/grievances/{id}                                    -> {grievance} (with its events)
    POST /v1/tenants/{t}/grievances/{id}/status       {status, note}        Owner/Admin
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.privacy.export_service import LINK_SECONDS, run_export_job
from app.privacy.models import (
    AccountDeletionIn,
    ExportIn,
    GrievanceIn,
    GrievanceUpdateIn,
    RetentionIn,
    WorkspaceDeletionIn,
    WorkspaceExportIn,
)
from app.privacy.notice import send_notice
from app.privacy.repository import PrivacyRepository
from app.tenancy.models import Role
from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.privacy.audit")

me_router = APIRouter(prefix="/v1/me", tags=["privacy"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["privacy"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


def _privacy(runtime: Runtime) -> PrivacyRepository:
    if runtime.privacy is None:
        raise ApiError(503, "privacy_unavailable", "This is not available on this system.")
    return runtime.privacy


def _id(value: str) -> uuid.UUID:
    parsed = parse_uuid(value)
    if parsed is None:
        raise not_found()
    return parsed


def _start_export(
    runtime: Runtime, background: BackgroundTasks, token: str, export: dict[str, Any], scope: str, tenant_id: uuid.UUID | None, tenant_name: str | None
) -> JSONResponse:
    if export.get("status") == "queued" and runtime.catalogue_storage is not None:
        background.add_task(
            run_export_job, _privacy(runtime), runtime.catalogue_storage, token, uuid.UUID(str(export["id"])), scope, tenant_id, tenant_name
        )
    elif export.get("status") == "queued":
        raise ApiError(503, "storage_unavailable", "Files cannot be made on this system.")
    return JSONResponse({"export": export}, status_code=202)


# ------------------------------------------------------------------------------------------------ exports
@me_router.post("/data-exports", status_code=202)
def request_my_export(body: ExportIn, principal: PrincipalDep, runtime: RuntimeDep, background: BackgroundTasks) -> JSONResponse:
    export = _privacy(runtime).export_request(principal.token, uuid.UUID(str(body.export_id)), "person", None)
    return _start_export(runtime, background, principal.token, export, "person", None, None)


@me_router.get("/data-exports")
def list_my_exports(principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return {"exports": _privacy(runtime).export_list(principal.token)}


@me_router.get("/data-exports/{export_id}")
def get_my_export(export_id: str, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return {"export": _privacy(runtime).export_get(principal.token, _id(export_id))}


@me_router.post("/data-exports/{export_id}/link")
def my_export_link(export_id: str, principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    parsed = _id(export_id)
    privacy = _privacy(runtime)
    if runtime.catalogue_storage is None:
        raise ApiError(503, "storage_unavailable", "Files cannot be reached on this system.")
    record = privacy.export_link(principal.token, parsed)
    bucket, path = str(record["bucket"]), str(record["path"])
    urls = runtime.catalogue_storage.sign(principal.token, bucket, [path], LINK_SECONDS)
    url = urls.get(path)
    if url is None:
        raise UpstreamError("storage could not sign the file")
    logger.info("export link user=%s export=%s", principal.user_id, parsed)
    return JSONResponse(
        {"url": url, "link_valid_seconds": LINK_SECONDS, "file_expires_at": record.get("expires_at"), "size_bytes": record.get("size_bytes"), "sha256": record.get("sha256")},
        headers={"Cache-Control": "no-store"},
    )


def _typed_name_matches(typed: str, ctx: TenantContext) -> bool:
    """The Owner typed the business name as it is written (surrounding spaces ignored): the same rule as the deletion request."""
    return typed.strip() == ctx.tenant.name


@router.post("/data-exports", status_code=202)
def request_workspace_export(body: WorkspaceExportIn, ctx: OwnerStrong, runtime: RuntimeDep, background: BackgroundTasks) -> JSONResponse:
    if not _typed_name_matches(body.confirm_name, ctx):
        raise ApiError(422, "confirmation_mismatch", "What you typed does not match. Check it and try again.")
    export = _privacy(runtime).export_request(ctx.principal.token, uuid.UUID(str(body.export_id)), "workspace", ctx.tenant.id)
    background.add_task(send_notice, runtime.mail_sender, "export_requested", ctx.tenant.name, ctx.principal.email, f"export-notice-{body.export_id}")
    return _start_export(runtime, background, ctx.principal.token, export, "workspace", ctx.tenant.id, ctx.tenant.name)


# ------------------------------------------------------------------------------------------------ deletion
@me_router.post("/deletion-requests", status_code=201)
def request_account_deletion(body: AccountDeletionIn, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return {"deletion": _privacy(runtime).deletion_request(principal.token, uuid.UUID(str(body.request_id)), "account", None, body.confirm_email)}


@me_router.get("/deletion-requests")
def list_my_deletions(principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return {"deletions": _privacy(runtime).deletion_list(principal.token, None)}


@me_router.post("/deletion-requests/{request_id}/cancel")
def cancel_my_deletion(request_id: str, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    return {"deletion": _privacy(runtime).deletion_cancel(principal.token, _id(request_id))}


@router.post("/deletion-requests", status_code=201)
def request_workspace_deletion(body: WorkspaceDeletionIn, ctx: OwnerStrong, runtime: RuntimeDep, background: BackgroundTasks) -> dict[str, Any]:
    # the typed business name is checked by the database (SM615 -> 422 confirmation_mismatch); the notice goes only after it passed
    deletion = _privacy(runtime).deletion_request(ctx.principal.token, uuid.UUID(str(body.request_id)), "workspace", ctx.tenant.id, body.confirm_name)
    background.add_task(send_notice, runtime.mail_sender, "deletion_requested", ctx.tenant.name, ctx.principal.email, f"deletion-notice-{body.request_id}")
    return {"deletion": deletion}


@router.get("/deletion-requests")
def list_workspace_deletions(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return {"deletions": _privacy(runtime).deletion_list(ctx.principal.token, ctx.tenant.id)}


@router.post("/deletion-requests/{request_id}/cancel")
def cancel_workspace_deletion(request_id: str, ctx: OwnerOnly, runtime: RuntimeDep) -> dict[str, Any]:
    return {"deletion": _privacy(runtime).deletion_cancel(ctx.principal.token, _id(request_id))}


@router.post("/deletion-requests/{request_id}/execute")
def execute_workspace_deletion(request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, background: BackgroundTasks) -> dict[str, Any]:
    result = _privacy(runtime).deletion_execute_workspace(ctx.principal.token, _id(request_id))
    background.add_task(send_notice, runtime.mail_sender, "deletion_executed", ctx.tenant.name, ctx.principal.email, f"deletion-done-{request_id}")
    logger.info("workspace deletion executed tenant=%s user=%s request=%s", ctx.tenant.id, ctx.principal.user_id, request_id)
    return result


# ------------------------------------------------------------------------------------------------ retention
@router.get("/retention")
def get_retention(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return _privacy(runtime).retention_get(ctx.principal.token, ctx.tenant.id)


@router.put("/retention")
def set_retention(body: RetentionIn, ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _privacy(runtime).retention_set(ctx.principal.token, ctx.tenant.id, body.as_settings())


@router.post("/retention/preview")
def preview_retention(ctx: OwnerOrAdmin, runtime: RuntimeDep, body: RetentionIn | None = None) -> dict[str, Any]:
    """With a body: what THAT setting would remove now. Without: what the saved setting would remove at the next clean-up."""
    counts = _privacy(runtime).retention_preview(ctx.principal.token, ctx.tenant.id, body.as_settings() if body is not None else None)
    return {"counts": counts}


# ------------------------------------------------------------------------------------------------ grievances
@router.post("/grievances", status_code=201)
def submit_grievance(body: GrievanceIn, ctx: Member, runtime: RuntimeDep) -> dict[str, Any]:
    args = {
        "p_id": str(body.grievance_id),
        "p_tenant_id": str(ctx.tenant.id),
        "p_kind": body.kind,
        "p_subject": body.subject,
        "p_details": body.details,
        "p_on_behalf": body.on_behalf,
        "p_requester_name": body.requester_name,
        "p_requester_contact": body.requester_contact,
    }
    return {"grievance": _privacy(runtime).grievance_submit(ctx.principal.token, args)}


Status = Literal["received", "acknowledged", "in_progress", "resolved", "rejected", "open"]


@router.get("/grievances")
def list_grievances(ctx: Member, runtime: RuntimeDep, status: Annotated[Status | None, Query()] = None) -> dict[str, Any]:
    return {"grievances": _privacy(runtime).grievance_list(ctx.principal.token, ctx.tenant.id, status)}


@router.get("/grievances/{grievance_id}")
def get_grievance(grievance_id: str, ctx: Member, runtime: RuntimeDep) -> dict[str, Any]:
    grievance = _privacy(runtime).grievance_get(ctx.principal.token, _id(grievance_id))
    if grievance.get("tenant_id") != str(ctx.tenant.id):
        raise not_found()  # a grievance of another workspace is never shown under this one
    return {"grievance": grievance}


@router.post("/grievances/{grievance_id}/status")
def update_grievance(grievance_id: str, body: GrievanceUpdateIn, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    privacy = _privacy(runtime)
    parsed = _id(grievance_id)
    existing = privacy.grievance_get(ctx.principal.token, parsed)
    if existing.get("tenant_id") != str(ctx.tenant.id):
        raise not_found()
    return {"grievance": privacy.grievance_update(ctx.principal.token, parsed, body.status, body.note)}

