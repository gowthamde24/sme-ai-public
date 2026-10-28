"""The owner's notes under /v1/tenants/{tenant_id}/ai-assistant/context (job EB part A; Settings > AI assistant > About my business). The contract is ~/Desktop/stack19-jobs/contract-context-sources.md.

  GET  /ai-assistant/context                       the notes, the version, who saved, the gentle headings. Any member.
  PUT  /ai-assistant/context                       autosave: {notes, expected_version}; 409 context_changed + the current state when someone saved first. Owner, Admin.
  GET  /ai-assistant/context/versions[/{v}]        who changed what, when; one old version in full.
  POST /ai-assistant/context/versions/{v}/restore  an old version becomes a NEW version.
  POST /ai-assistant/context/understand            paste, a file or a recording -> "Here is what I understood" (nothing is saved).
  POST /ai-assistant/context/understand/{id}/save  save what the owner read and edited (append or replace).
  POST /ai-assistant/context/test                  "Test it": a customer's question answered from the saved notes, as the assistant would on WhatsApp.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.assistant_context.models import (
    ContextIn,
    ContextOut,
    RestoreIn,
    SaveUnderstoodIn,
    TestIn,
    TestOut,
    UnderstandIn,
    UnderstandOut,
    VersionOut,
    VersionsOut,
)
from app.assistant_context.service import ContextService
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant/context", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


def _service(runtime: Runtime) -> ContextService:
    if runtime.assistant_context is None:
        raise ApiError(503, "assistant_context_unavailable", "The assistant's notes are not available right now.")
    return runtime.assistant_context


@router.get("", response_model=ContextOut)
def get_context(ctx: AnyMember, runtime: RuntimeDep) -> ContextOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.put("", response_model=ContextOut)
def put_context(body: ContextIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ContextOut:
    return _service(runtime).put(runtime, ctx, body)


@router.get("/versions", response_model=VersionsOut)
def versions(ctx: AnyMember, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 20) -> VersionsOut:
    return _service(runtime).versions(ctx.principal.token, ctx.tenant.id, limit)


@router.get("/versions/{version}", response_model=VersionOut)
def one_version(version: int, ctx: AnyMember, runtime: RuntimeDep) -> VersionOut:
    return _service(runtime).version(ctx.principal.token, ctx.tenant.id, version)


@router.post("/versions/{version}/restore", response_model=ContextOut)
def restore(version: int, body: RestoreIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ContextOut:
    return _service(runtime).restore(runtime, ctx, version, body)


@router.post("/understand", response_model=UnderstandOut)
def understand(body: UnderstandIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> UnderstandOut:
    return _service(runtime).understand(runtime, ctx, body)


@router.post("/understand/{preview_id}/save", response_model=ContextOut)
def save_understood(preview_id: str, body: SaveUnderstoodIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ContextOut:
    if len(preview_id) > 400 or not preview_id.replace(".", "").replace("-", "").replace("_", "").isalnum():
        raise not_found()
    return _service(runtime).save_understood(runtime, ctx, preview_id, body)


@router.post("/test", response_model=TestOut)
def test_it(body: TestIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> TestOut:
    return _service(runtime).test(runtime, ctx, body)

