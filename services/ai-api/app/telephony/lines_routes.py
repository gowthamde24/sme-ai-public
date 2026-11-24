# ruff: noqa: E501
"""Calls at once, for the Phone numbers page (28 Nov 2026): `GET /v1/tenants/{t}/phone-lines` -> {total, in_use, lines: [{n, state: open|on_call}]}. The total is the number of calls this deployment allows at one time (TELEPHONY_MAX_CONCURRENT) and `in_use` is OUR own live-call counter (VoiceLink offers no read of channels in use). The lines are shared by every number, so an open line means a new call can start. Nothing else is in it: no number, no caller, no workspace. Owner and Admin only.
NOTE: no `from __future__ import annotations` (response models are attached at registration time)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/phone-lines", tags=["phone"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
MAX_SHOWN = 20


class LineOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    n: int
    state: Literal["open", "on_call"]


class LinesOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    total: int
    in_use: int
    lines: list[LineOut]


@router.get("", response_model=LinesOut)
def phone_lines(ctx: OwnerAdmin, runtime: RuntimeDep, response: Response) -> LinesOut:
    response.headers["Cache-Control"] = "no-store"
    service = getattr(runtime, "phone_inbound", None)
    settings = getattr(service, "gate_settings", None)
    total = max(0, min(int(getattr(settings, "max_concurrent", 0) or 0), MAX_SHOWN))
    live = runtime.live_calls
    in_use = min(total, live.count()) if live is not None else 0
    return LinesOut(total=total, in_use=in_use, lines=[LineOut(n=i + 1, state="on_call" if i < in_use else "open") for i in range(total)])
