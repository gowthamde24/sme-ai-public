"""The scheduler's settings and the Owner's status card under /v1/tenants/{tenant_id}/scheduler/... (job AW, ADR 0068).

Authorization, in order, for every endpoint: a valid JWT (401); membership of the tenant in the PATH (404); a role (403: Owner and Admin read the settings and the status; only the Owner changes the
settings, and with a second factor: 403 mfa_required); then the database decides again. The worker itself is not an API caller: it is a separate process with its own registered account
(app/scheduler/worker.py) and has no endpoint here.

NOTE: no `from __future__ import annotations` here, for the same reason as app/visits/routes.py (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.scheduler.models import (
    SchedulerSettingsIn,
    SchedulerSettingsOut,
    SchedulerStatusOut,
    SchedulerTodayOut,
)
from app.tenancy.models import Role
from app.tenancy.repository import UpstreamError

router = APIRouter(prefix="/v1/tenants/{tenant_id}/scheduler", tags=["scheduler"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _repo(runtime: Runtime) -> Any:
    if runtime.scheduler is None:
        raise ApiError(503, "scheduler_unavailable", "The scheduler is not available right now.")
    return runtime.scheduler


def settings_out(raw: dict[str, Any]) -> SchedulerSettingsOut:
    try:
        return SchedulerSettingsOut(**raw)
    except (TypeError, ValueError):
        raise UpstreamError("unexpected scheduler settings") from None


def status_out(raw: dict[str, Any]) -> SchedulerStatusOut:
    try:
        return SchedulerStatusOut(
            platform_switch_on=raw["platform_switch_on"],
            auto_send_enabled=raw["auto_send_enabled"],
            active=raw["active"],
            releases_approved=raw["releases_approved"],
            worker_running=raw["worker_running"],
            last_run_at=raw.get("last_run_at"),
            next_run_at=raw.get("next_run_at"),
            interval_seconds=raw.get("interval_seconds"),
            last_activity_at=raw.get("last_activity_at"),
            today=SchedulerTodayOut(**raw["today"]),
        )
    except (KeyError, TypeError, ValueError):
        raise UpstreamError("unexpected scheduler status") from None


@router.get("/status", response_model=SchedulerStatusOut)
def get_status(ctx: OwnerAdmin, runtime: RuntimeDep) -> SchedulerStatusOut:
    """The card: is the worker running, when it last looked, when it looks next, what it did today. Owner and Admin."""
    return status_out(_repo(runtime).get_status(ctx.principal.token, ctx.tenant.id))


@router.get("/settings", response_model=SchedulerSettingsOut)
def get_settings(ctx: OwnerAdmin, runtime: RuntimeDep) -> SchedulerSettingsOut:
    """When the reminders go and whether a missed visit is marked automatically. Owner and Admin read; a business that never saved its own has the defaults (`is_default`)."""
    return settings_out(_repo(runtime).get_settings(ctx.principal.token, ctx.tenant.id))


@router.put("/settings", response_model=SchedulerSettingsOut)
def put_settings(
    body: SchedulerSettingsIn, ctx: OwnerStrong, runtime: RuntimeDep
) -> SchedulerSettingsOut:
    """Owner, with a second factor. The whole set at once. It changes no message that is already queued."""
    return settings_out(
        _repo(runtime).set_settings(
            ctx.principal.token,
            ctx.tenant.id,
            {
                "p_evening_enabled": body.reminder_evening_enabled,
                "p_evening_hour": body.reminder_evening_hour,
                "p_heads_up_enabled": body.reminder_heads_up_enabled,
                "p_heads_up_minutes": body.reminder_heads_up_minutes,
                "p_no_show_enabled": body.no_show_enabled,
                "p_no_show_after_minutes": body.no_show_after_minutes,
            },
        )
    )
