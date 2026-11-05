"""Settings > AI assistant > "How I talk to customers" (docs/contracts/talk-training.md; owner, 5 Nov 2026).

  GET  /talk-training        Owner, Admin    the training in force (saved, else the business type's defaults), the defaults, the platform's own rules
  PUT  /talk-training        Owner (second factor; the database checks it)   the whole document -> the same answer. 422 talk_training_invalid {reason}
  POST /talk-training/reset  Owner (second factor)   back to the defaults

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError

from app.auth.deps import OwnerOrAdmin, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.talk_training.defaults import RULES, defaults_for
from app.talk_training.models import TalkTraining, TalkTrainingOut
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["talk-training"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
REASONS = ("price_or_promise", "too_many_questions", "too_many_never_say", "too_many_objections", "too_many_examples", "duplicate", "invalid")


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "talk_training", None)
    if repo is None:
        raise ApiError(503, "talk_training_unavailable", "This is not available right now.")
    return repo


def _defaults(runtime: Runtime, ctx: TenantContext) -> TalkTraining:
    pack: str | None = None
    packs = getattr(runtime, "packs", None)
    if packs is not None:
        try:
            pack = str(packs.workspace_pack(ctx.principal.token, ctx.tenant.id).get("pack_id") or "") or None
        except Exception:   # noqa: BLE001 - the generic defaults are fine when the pack cannot be read
            pack = None
    return defaults_for(pack)


def _out(runtime: Runtime, ctx: TenantContext, row: dict[str, Any] | None) -> TalkTrainingOut:
    defaults = _defaults(runtime, ctx)
    saved = row is not None and isinstance(row.get("doc"), dict)
    training = TalkTraining.model_validate(row["doc"]) if saved and row is not None else defaults
    return TalkTrainingOut(training=training, saved=saved, defaults=defaults, rules=list(RULES), updated_at=row.get("updated_at") if saved and row is not None else None)


@router.get("/talk-training", response_model=TalkTrainingOut)
def get_talk_training(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> TalkTrainingOut:
    return _out(runtime, ctx, _repo(runtime).get(ctx.principal.token, ctx.tenant.id))


@router.put("/talk-training", response_model=TalkTrainingOut)
async def put_talk_training(request: Request, ctx: Owner, runtime: RuntimeDep) -> TalkTrainingOut:
    try:
        body = TalkTraining.model_validate(await request.json())
    except ValidationError as exc:
        words = " ".join(str(e.get("msg", "")) for e in exc.errors())
        reason = next((r for r in REASONS if r in words), "invalid")
        raise ApiError(422, "talk_training_invalid", "Something in the training can't be saved.", extra={"reason": reason}) from None
    except ValueError:
        raise ApiError(422, "talk_training_invalid", "Something in the training can't be saved.", extra={"reason": "invalid"}) from None
    row = _repo(runtime).save(ctx.principal.token, ctx.tenant.id, body.model_dump(mode="json"))
    return _out(runtime, ctx, row)


@router.post("/talk-training/reset", response_model=TalkTrainingOut)
def reset_talk_training(ctx: Owner, runtime: RuntimeDep) -> TalkTrainingOut:
    _repo(runtime).reset(ctx.principal.token, ctx.tenant.id)
    return _out(runtime, ctx, None)
