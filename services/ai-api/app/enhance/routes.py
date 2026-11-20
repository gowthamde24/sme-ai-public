"""POST /v1/tenants/{t}/ai-assistant/enhance {language, text} -> {text, changes: [{from, to, rule}], applied, reason}. Owner and Admin. One model call, nothing is saved, nothing is sent (owner, 21 Nov 2026).

`applied: false` means the text is the original, unchanged, and `reason` says why: nothing_to_change, unreadable, numbers_changed, link_added, promise_added, language_changed, no_model (503 enhance_unavailable when no model is wired at all)."""

# ruff: noqa: E501

import asyncio
import time
from collections import defaultdict, deque
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.enhance import service
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ai-assistant", tags=["enhance"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
PER_HOUR = 30
_turns: dict[str, deque[float]] = defaultdict(deque)


class EnhanceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=service.MAX_TEXT)]


class ChangeOut(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    rule: str


class EnhanceOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    changes: list[ChangeOut]
    applied: bool
    reason: str | None


@router.post("/enhance", response_model=EnhanceOut, response_model_by_alias=True)
async def enhance(body: EnhanceIn, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> EnhanceOut:
    bv = getattr(runtime, "browser_voice", None)
    if bv is None:
        raise ApiError(503, "enhance_unavailable", "Enhance is not available right now.")
    now = time.monotonic()
    turns = _turns[str(ctx.tenant.id)]
    while turns and now - turns[0] > 3600:
        turns.popleft()
    if len(turns) >= PER_HOUR:
        raise ApiError(429, "enhance_busy", "That is a lot of rewrites for one hour. Try again a little later.")
    turns.append(now)

    async def ask() -> str:
        system = service.system_prompt(body.language)
        return "".join([piece async for piece in bv.fast_llm().stream(system, [{"role": "user", "content": body.text}], bv.model_ids()["fast"])]).strip()

    try:
        raw = await asyncio.wait_for(ask(), 30.0)
    except Exception:   # noqa: BLE001 - the model did not answer: the text as it was
        return EnhanceOut(text=body.text, changes=[], applied=False, reason="no_model")
    made = service.check(body.text, body.language, service.parse(raw))
    return EnhanceOut(text=made.text, changes=[ChangeOut(**{"from": c.before, "to": c.after, "rule": c.rule}) for c in made.changes], applied=made.applied, reason=made.reason)
