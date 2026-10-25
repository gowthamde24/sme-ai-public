"""The AI assistant's settings under /v1/tenants/{tenant_id}/ai-assistant (job DM, C1 part; Settings > AI assistant). The contract is packages/contracts/assistant_settings.* and
docs/contracts/assistant-settings.md.

  GET  /ai-assistant                the settings in force (or the defaults of the business type), the defaults, the options with the voices that exist, the fixed introduction. Owner and Admin.
  PUT  /ai-assistant                save every field. Owner, with a second factor. A save also sets the speed, calling hours and voices of the business's voice notes when it has them.
  GET  /ai-assistant/preview        one sample line with the shop's name (`language`, `style`, optional unsaved `name`). Owner and Admin.
  POST /ai-assistant/test-call      "Call me now for a test": a SIMULATION until telephony exists (no call, nothing sent or stored). Owner, with a second factor.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.assistant_settings.models import AssistantOut, AssistantSettings, LanguageWord, PreviewOut, StyleWord, TestCallOut
from app.assistant_settings.service import AssistantSettingsService
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["ai-assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> AssistantSettingsService:
    if runtime.assistant_settings is None:
        raise ApiError(503, "assistant_settings_unavailable", "The assistant settings are not available right now.")
    return runtime.assistant_settings


@router.get("", response_model=AssistantOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> AssistantOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.put("", response_model=AssistantOut)
def save_settings(body: AssistantSettings, ctx: OwnerStrong, runtime: RuntimeDep) -> AssistantOut:
    return _service(runtime).save(ctx.principal.token, ctx.tenant.id, body)


@router.get("/preview", response_model=PreviewOut)
def preview(
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    language: Annotated[LanguageWord, Query()],
    style: Annotated[StyleWord, Query()],
    name: Annotated[str | None, Query(min_length=1, max_length=30, pattern=r"^[^<>{}@/\\|\x00-\x1f\x7f]+$")] = None,
) -> PreviewOut:
    return _service(runtime).preview(ctx.principal.token, ctx.tenant.id, language, style, name.strip() if name else None)


@router.post("/test-call", response_model=TestCallOut)
def test_call(ctx: OwnerStrong, runtime: RuntimeDep) -> TestCallOut:
    return _service(runtime).test_call(ctx.principal.token, ctx.tenant.id)
