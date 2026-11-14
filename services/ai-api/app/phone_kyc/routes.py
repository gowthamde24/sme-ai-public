"""The in-app KYC of the business's phone number (owner decision 14 Nov 2026), under /v1/tenants/{tenant_id}/phone-kyc:

  GET  /phone-kyc/options   Owner, Admin   the three documents (one is enough), their number labels, the file rules
  GET  /phone-kyc           any member      {state, doc_kind, compliance_id, reason (Owner, Admin), live, can_choose_number}; refreshed from Plivo for the Owner
  POST /phone-kyc           Owner + second factor   file the application (the document passes through in memory only; nothing is stored of it)
Refusals: 413 kyc_file_too_large, 415 kyc_file_type, 422 kyc_file_unreadable | kyc_not_accepted (Plivo's own sentence in `reason`), 409 kyc_document_not_offered | kyc_field_not_supported, 502 kyc_provider_unavailable, 503 kyc_unavailable.
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.phone_kyc.models import KycIn, KycOut, OptionsOut
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/phone-kyc", tags=["phone-kyc"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime):  # type: ignore[no-untyped-def]
    if runtime.phone_kyc is None:
        raise ApiError(503, "kyc_unavailable", "Phone number registration is not available right now.")
    return runtime.phone_kyc


@router.get("/options", response_model=OptionsOut)
def options(ctx: OwnerAdmin, runtime: RuntimeDep) -> OptionsOut:
    return _service(runtime).options()  # type: ignore[no-any-return]


@router.get("", response_model=KycOut)
def status(ctx: AnyMember, runtime: RuntimeDep) -> KycOut:
    return _service(runtime).status(ctx.principal.token, ctx.tenant.id, can_refresh=ctx.role == Role.OWNER and ctx.principal.aal == "aal2")  # type: ignore[no-any-return]


@router.post("", response_model=KycOut)
def submit(body: KycIn, ctx: OwnerStrong, runtime: RuntimeDep) -> KycOut:
    return _service(runtime).submit(ctx.principal.token, ctx.tenant.id, body)  # type: ignore[no-any-return]
