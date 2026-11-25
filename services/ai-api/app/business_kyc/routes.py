"""Business KYC per client (Model B), docs/contracts/business-kyc.md. Off (404) unless KYC_PER_CLIENT is on.

  GET  /v1/tenants/{t}/phone-kyc/business               Owner, Admin   where it stands
  POST .../business/start                                Owner          make the business's VoiceLink client (once)
  POST .../business/details | pan | gst                  Owner          the steps (identity numbers go to VoiceLink and are dropped)
  POST .../business/aadhaar                              Owner          the DigiLocker address to open on the person's own phone
  POST .../business/documents                            Owner          a document (JSON with base64, up to 10 MB)
  POST .../business/submit                               Owner          final submit

NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.business_kyc import rules
from app.business_kyc.models import (
    AadhaarOut,
    DetailsIn,
    GstIn,
    PanIn,
    StatusOut,
    UploadIn,
)
from app.business_kyc.service import BusinessKycService
from app.errors import not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/phone-kyc/business", tags=["business-kyc"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _service(runtime: Runtime) -> BusinessKycService:
    if getattr(runtime, "business_kyc", None) is None:
        raise not_found()
    return runtime.business_kyc  # type: ignore[no-any-return]


@router.get("", response_model=StatusOut)
def status(ctx: Reader, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    out = service.status(ctx.principal.token, ctx.tenant.id)
    if out["state"] == "waiting_for_line" and ctx.role == Role.OWNER:   # a channel may be free by now: the Owner's own screen retries (no worker needed)
        out = service.retry_waiting(ctx.principal.token, ctx.tenant.id, ctx.principal.email or "", getattr(ctx.tenant, "name", "") or "")
    return out


@router.post("/start", response_model=StatusOut, status_code=201)
def start(ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    p = ctx.principal
    return _service(runtime).start(p.token, ctx.tenant.id, p.email or "", getattr(ctx.tenant, "name", "") or "", None)


@router.post("/details", response_model=StatusOut)
def details(body: DetailsIn, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    clean, bad = rules.check_details(body.model_dump())
    if bad:
        raise rules.refuse(bad)
    return _service(runtime).details(ctx.principal.token, ctx.tenant.id, clean)


@router.post("/pan", response_model=StatusOut)
def pan(body: PanIn, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    pan_number, holder, bad = rules.check_pan(body.model_dump())
    if bad:
        raise rules.refuse(bad)
    return _service(runtime).pan(ctx.principal.token, ctx.tenant.id, pan_number, holder)


@router.post("/gst", response_model=StatusOut)
def gst(body: GstIn, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    service = _service(runtime)
    gstin, bad = rules.check_gstin(body.model_dump(), service.status(ctx.principal.token, ctx.tenant.id).get("account_type"))
    if bad:
        raise rules.refuse(bad)
    return service.gst(ctx.principal.token, ctx.tenant.id, gstin)


@router.post("/aadhaar", response_model=AadhaarOut)
def aadhaar(ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).aadhaar_start(ctx.principal.token, ctx.tenant.id)


@router.post("/documents", response_model=StatusOut)
def documents(body: UploadIn, ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    bad = rules.check_document(body.model_dump())
    if bad:
        raise rules.refuse(bad)
    return _service(runtime).upload(ctx.principal.token, ctx.tenant.id, str(body.document_type), str(body.content_type), body.content_base64)


@router.post("/submit", response_model=StatusOut)
def submit(ctx: Owner, runtime: RuntimeDep) -> dict[str, Any]:
    return _service(runtime).submit(ctx.principal.token, ctx.tenant.id)
