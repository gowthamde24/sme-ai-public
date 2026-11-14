# ruff: noqa: E501
"""My assistant: GET /assistant/status (any member), POST /assistant/go-live and /assistant/pause (Owner). 409 `assistant_not_ready` (with `missing`) when going live lacks a business name or a phone number.
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.assistant_status.service import (
    AssistantStatusOut,
    AssistantStatusService,
    HeldBySupportError,
    NotReadyError,
)
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/assistant", tags=["assistant-status"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


def _service(runtime: Runtime) -> AssistantStatusService:
    if runtime.assistant_status is None:
        raise ApiError(503, "assistant_status_unavailable", "This is not available right now.")
    return runtime.assistant_status  # type: ignore[no-any-return]


@router.get("/status", response_model=AssistantStatusOut)
def get_status(ctx: AnyMember, runtime: RuntimeDep) -> AssistantStatusOut:
    return _service(runtime).status(ctx.principal.token, ctx.tenant.id)


@router.post("/go-live", response_model=AssistantStatusOut)
def go_live(ctx: Owner, runtime: RuntimeDep) -> AssistantStatusOut:
    service = _service(runtime)
    try:
        return service.go_live(ctx.principal.token, ctx.tenant.id)
    except HeldBySupportError:
        raise ApiError(409, "held_by_support", "Stack19 support paused your assistant. Ask support to resume it.") from None
    except NotReadyError:
        raise ApiError(409, "assistant_not_ready", "The assistant needs a business name and a connected phone number before it can go live.", extra={"missing": service.status(ctx.principal.token, ctx.tenant.id).missing}) from None


@router.post("/pause", response_model=AssistantStatusOut)
def pause(ctx: Owner, runtime: RuntimeDep) -> AssistantStatusOut:
    return _service(runtime).pause(ctx.principal.token, ctx.tenant.id)
