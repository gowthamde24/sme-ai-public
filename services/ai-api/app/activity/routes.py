"""Everything it did, and Limits over HTTP (docs/contracts/activity-limits.md):

  GET /v1/tenants/{tenant_id}/activity-log?limit=&cursor=&kind=   Owner, Admin   one newest-first timeline of calls, WhatsApp messages and the assistant's changes, with an undo state per item
  GET /v1/tenants/{tenant_id}/limits                              Owner, Admin   what the assistant does alone and what waits for the Owner, from the real settings
  PUT /v1/tenants/{tenant_id}/limits                              Owner          make limits TIGHTER (all or nothing); loosening is refused here and stays in the existing settings pages

The database does the work and the checks. NOTE: no `from __future__ import annotations` (FastAPI reads the signatures)."""

# ruff: noqa: E501

import base64
import binascii
import json
import re
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from app.activity import service
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["activity"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
KEY = re.compile(r"^(call|message|action):[0-9a-f-]{36}$")


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "activity", None)
    if repo is None:
        raise ApiError(503, "activity_unavailable", "This is not available right now.")
    return repo


def encode_cursor(nxt: dict[str, Any] | None) -> str | None:
    if not nxt:
        return None
    return base64.urlsafe_b64encode(json.dumps([nxt["before_at"], nxt["before_key"]], separators=(",", ":")).encode()).decode().rstrip("=")


def decode_cursor(raw: str) -> tuple[datetime, str]:
    try:
        at, key = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        parsed = datetime.fromisoformat(str(at))
        if not isinstance(key, str) or not KEY.fullmatch(key) or parsed.tzinfo is None:
            raise ValueError
        return parsed, key
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise ApiError(422, "invalid_cursor", "That page marker is not valid.") from None


@router.get("/activity-log")
def get_activity(
    ctx: Reader, runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    kind: Annotated[Literal["call", "message", "action"] | None, Query()] = None,
) -> dict[str, Any]:
    before_at, before_key = decode_cursor(cursor) if cursor else (None, None)
    raw = _repo(runtime).activity(ctx.principal.token, ctx.tenant.id, limit=limit, before_at=before_at, before_key=before_key, kind=kind)
    return service.activity_out(ctx.tenant.id, raw, encode_cursor)


@router.get("/limits")
def get_limits(ctx: Reader, runtime: RuntimeDep) -> dict[str, Any]:
    return dict(_repo(runtime).limits(ctx.principal.token, ctx.tenant.id))


class QuietHoursIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_hour: StrictInt | None = Field(default=None, ge=19, le=23)
    end_hour: StrictInt | None = Field(default=None, ge=7, le=10)


class CallHoursIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: list[Annotated[int, Field(strict=True, ge=1, le=7)]] | None = Field(default=None, min_length=1, max_length=7)
    from_minute: StrictInt | None = Field(default=None, ge=540, le=1260, multiple_of=15)
    to_minute: StrictInt | None = Field(default=None, ge=540, le=1260, multiple_of=15)


class TightenIn(BaseModel):
    """Only these can be given, and only to make things tighter: `false` for a switch or permission, a lower number, shorter hours. Anything else is refused; so is anything that would loosen."""

    model_config = ConfigDict(extra="forbid")
    workspace_on: Literal[False] | None = None
    messages_alone: Literal[False] | None = None
    message_daily_limit: StrictInt | None = Field(default=None, ge=1, le=20)
    message_quiet_hours: QuietHoursIn | None = None
    call_prices: Literal[False] | None = None
    call_visits: Literal[False] | None = None
    call_media: Literal[False] | None = None
    call_dues: Literal[False] | None = None
    call_discount_percent: StrictInt | None = Field(default=None, ge=0, le=50)
    call_big_order_paise: StrictInt | None = Field(default=None, ge=1, le=100_000_000_000)
    call_hours: CallHoursIn | None = None


_STATUS = {"would_loosen": 422, "invalid": 422, "unknown_field": 422, "not_saved": 409, "limits_elsewhere": 409}
_WORDS = {
    "would_loosen": "Limits can only be made tighter here. To allow more, use the setting itself.",
    "invalid": "That value is not valid for this limit.",
    "unknown_field": "That is not a limit that can be changed here.",
    "not_saved": "Save the AI assistant's settings first; there is nothing to tighten yet.",
    "limits_elsewhere": "These hours are set in the call settings. Change them there.",
}


@router.put("/limits")
def tighten_limits(body: TightenIn, ctx: OwnerOnly, runtime: RuntimeDep) -> dict[str, Any]:
    changes = body.model_dump(exclude_none=True)
    if body.message_quiet_hours is not None:
        changes["message_quiet_hours"] = body.message_quiet_hours.model_dump(exclude_none=True)
    if body.call_hours is not None:
        changes["call_hours"] = body.call_hours.model_dump(exclude_none=True)
    for key in ("message_quiet_hours", "call_hours"):
        if key in changes and not changes[key]:
            raise ApiError(422, "invalid", _WORDS["invalid"], extra={"field": key})
    if not changes:
        raise ApiError(422, "invalid", "Say which limit to tighten.")
    got = _repo(runtime).tighten(ctx.principal.token, ctx.tenant.id, changes)
    if not got.get("ok"):
        reason = str(got.get("reason") or "invalid")
        field = got.get("field")
        raise ApiError(_STATUS.get(reason, 422), reason if reason in _STATUS else "invalid", _WORDS.get(reason, _WORDS["invalid"]), extra={"field": field if isinstance(field, str) else None})
    return dict(got["limits"])

