# ruff: noqa: E501
"""Extra lines: more "calls at once" for a workspace (26 Nov 2026; switch EXTRA_LINES, off: every route answers 404).
  GET  /v1/tenants/{t}/extra-lines                 the price, the limit, the lines and what is bought (Owner or Admin)
  POST /v1/tenants/{t}/extra-lines                 {key}: add one line, paid from the credits (Owner; with the second factor when it is on)
  POST /v1/tenants/{t}/extra-lines/{id}/cancel     the line works to the end of the paid month (Owner)
  POST /v1/tenants/{t}/extra-lines/{id}/keep       take the cancel back (Owner)
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.extra_lines.service import ExtraLinesService, LinesBlocked
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/extra-lines", tags=["phone"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
WORDS = {
    "paused": "We cannot add lines right now.",
    "at_limit": "You have the most lines a workspace can have. Write to us if you need more.",
    "no_number": "Get a phone number first. Each number comes with two lines.",
    "not_enough_credits": "There are not enough credits for a line. Add credits first.",
    "not_found": "We could not find that line.",
    "unavailable": "We could not add the line just now. You were not charged. Try again in a minute.",
}


class LineOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    status: str
    working: bool
    paid_until: str
    cancel_at_period_end: bool
    grace_until: str | None = None


class ExtraLinesOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    price_rupees: int   # the price of one line for a month, before GST, in whole rupees
    cap: int
    numbers: int
    included: int
    total: int
    can_add: bool
    extra: list[LineOut]


class AddIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")   # one per press of the button: the same key twice is the same line


def _service(runtime: Runtime) -> ExtraLinesService:
    service = getattr(runtime, "extra_lines", None)
    if service is None:
        raise ApiError(404, "not_found", "Not found.")
    return service  # type: ignore[no-any-return]


def _blocked(exc: LinesBlocked) -> ApiError:
    message = WORDS.get(exc.reason, WORDS["unavailable"])
    if exc.reason == "not_found":
        return ApiError(404, "not_found", message, extra={"reason": exc.reason})
    return ApiError(409, "lines_unavailable", message, extra={"reason": exc.reason, "fields": [exc.reason]})


def _line(row: dict[str, Any]) -> LineOut:
    return LineOut(id=str(row["id"]), status=str(row["status"]), working=bool(row.get("working")), paid_until=str(row["paid_until"]), cancel_at_period_end=bool(row.get("cancel_at_period_end")),
                   grace_until=str(row["grace_until"]) if row.get("grace_until") else None)


@router.get("", response_model=ExtraLinesOut)
def overview(ctx: OwnerAdmin, runtime: RuntimeDep, response: Response) -> ExtraLinesOut:
    response.headers["Cache-Control"] = "no-store"
    got = _service(runtime).overview(ctx.principal.token, ctx.tenant.id)
    return ExtraLinesOut(enabled=bool(got.get("enabled")), price_rupees=int(got.get("price_paise") or 0) // 100, cap=int(got.get("cap") or 0), numbers=int(got.get("numbers") or 0),
                         included=int(got.get("included") or 0), total=int(got.get("total") or 0), can_add=bool(got.get("can_add")), extra=[_line(r) for r in got.get("extra") or [] if isinstance(r, dict)])


@router.post("", response_model=LineOut, status_code=201)
def add(ctx: OwnerStrong, runtime: RuntimeDep, body: AddIn) -> LineOut:
    try:
        return _line(_service(runtime).add(ctx.principal.token, ctx.tenant.id, body.key))
    except LinesBlocked as exc:
        raise _blocked(exc) from None


@router.post("/{line_id}/cancel", response_model=LineOut)
def cancel(ctx: OwnerStrong, runtime: RuntimeDep, line_id: uuid.UUID) -> LineOut:
    try:
        return _line(_service(runtime).cancel(ctx.principal.token, ctx.tenant.id, line_id, True))
    except LinesBlocked as exc:
        raise _blocked(exc) from None


@router.post("/{line_id}/keep", response_model=LineOut)
def keep(ctx: OwnerStrong, runtime: RuntimeDep, line_id: uuid.UUID) -> LineOut:
    try:
        return _line(_service(runtime).cancel(ctx.principal.token, ctx.tenant.id, line_id, False))
    except LinesBlocked as exc:
        raise _blocked(exc) from None
