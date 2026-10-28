"""The Owner's switch for the assistant's automatic WhatsApp replies (job DY), under /v1/tenants/{tenant_id}/ai-assistant:

  GET /auto-reply    any member   -> {enabled, changed_at, answered_today, held_today, daily_limit, rules: [word, ...]}
  PUT /auto-reply    Owner + second factor   {enabled: bool}   (approve once: the standing rules in `rules` apply to every message; every change is audited)

`rules` are fixed WORDS the screen shows next to the switch: answers_within_24_hours, asks_you_before_prices_and_promises, hands_over_when_unsure_or_asked_for_a_person.
The worker answers only while the switch is on, the assistant is on for the workspace and the system-wide sending switch is on; sending itself is the outbox's (consent, STOP, window, limits, kill switches)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.autoreply.repository import AutoReplySwitch
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["auto-reply"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


class SwitchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool


def _repo(runtime: Runtime) -> AutoReplySwitch:
    if runtime.auto_reply is None:
        raise ApiError(503, "auto_reply_unavailable", "This is not available on this system.")
    return runtime.auto_reply


@router.get("/auto-reply")
def get_auto_reply(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.put("/auto-reply")
def put_auto_reply(body: SwitchIn, ctx: OwnerStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _repo(runtime).set(ctx.principal.token, ctx.tenant.id, body.enabled)
