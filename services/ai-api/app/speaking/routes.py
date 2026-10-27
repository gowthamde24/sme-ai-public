"""Speaking style under /v1/tenants/{tenant_id}/speaking-style (job DS). The contract is packages/contracts/speaking_style.*

  GET  /speaking-style    every member: the style and region of each of the six languages (saved or default), the options, and whether the example lines of each language are owner-approved or drafts
  PUT  /speaking-style    Owner with a second factor: {languages: {te: {style, region}, ...}}; a language left out goes back to the default

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.speaking.models import SpeakingStyleIn, SpeakingStyleOut
from app.speaking.service import SpeakingService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/speaking-style", tags=["speaking-style"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> SpeakingService:
    if runtime.speaking is None:
        raise ApiError(503, "speaking_style_unavailable", "This is not available right now.")
    return runtime.speaking


@router.get("", response_model=SpeakingStyleOut)
def get_style(ctx: AnyMember, runtime: RuntimeDep) -> SpeakingStyleOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.put("", response_model=SpeakingStyleOut)
def put_style(body: SpeakingStyleIn, ctx: OwnerStrong, runtime: RuntimeDep) -> SpeakingStyleOut:
    return _service(runtime).save(ctx.principal.token, ctx.tenant.id, body)
