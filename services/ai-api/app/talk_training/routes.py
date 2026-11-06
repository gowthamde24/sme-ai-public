"""Settings > AI assistant > "How I talk to customers" (docs/contracts/talk-training.md; owner, 5 Nov 2026).

  GET  /talk-training        Owner, Admin    the training in force (saved, else the business type's defaults), the defaults, the platform's own rules
  PUT  /talk-training        Owner (second factor; the database checks it)   the whole document -> the same answer. 422 talk_training_invalid {reason}
  POST /talk-training/reset  Owner (second factor)   back to the defaults
  POST /talk-training/practice  Owner, Admin   a TEXT practice call (app v4, owner 6 Nov 2026): the owner plays the customer, the assistant answers with the same call prompt and the same rules as a
                                real call (honesty, stop, hand-over, bye); `training` may be an unsaved draft. Nothing is stored, nothing is sent, no voice. 503 practice_unavailable without a model;
                                429 practice_busy past PRACTICE_PER_HOUR turns in a workspace.

NOTE: no `from __future__ import annotations` here (FastAPI reads the endpoint signatures at registration)."""

# ruff: noqa: E501

import asyncio
import time
from collections import defaultdict, deque
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends
from pydantic import ValidationError

from app.auth.deps import OwnerOrAdmin, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.talk_training.defaults import RULES, defaults_for
from app.talk_training.models import PracticeIn, PracticeOut, TalkTraining, TalkTrainingOut
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["talk-training"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
REASONS = ("price_or_promise", "too_many_questions", "too_many_never_say", "too_many_say_like", "too_many_objections", "too_many_examples", "duplicate", "invalid")


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
def put_talk_training(ctx: Owner, runtime: RuntimeDep, doc: Annotated[dict[str, Any], Body()]) -> TalkTrainingOut:
    """The whole document. A body that is not a JSON object is the standard 422 naming the field; a document that breaks a rule is 422 talk_training_invalid with a closed `reason`."""
    try:
        body = TalkTraining.model_validate(doc)
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


PRACTICE_PER_HOUR = 120
_practice_turns: dict[str, deque[float]] = defaultdict(deque)


def _practice_allowed(tenant: str, now: float) -> bool:
    turns = _practice_turns[tenant]
    while turns and now - turns[0] > 3600:
        turns.popleft()
    if len(turns) >= PRACTICE_PER_HOUR:
        return False
    turns.append(now)
    return True


@router.post("/talk-training/practice", response_model=PracticeOut)
async def practice_talk_training(ctx: OwnerOrAdmin, runtime: RuntimeDep, body: PracticeIn) -> PracticeOut:
    from app.conversation.turntaking import is_goodbye
    from app.telephony import persona
    from app.telephony.phone_llm import PhoneLlm

    bv = getattr(runtime, "browser_voice", None)
    if bv is None:
        raise ApiError(503, "practice_unavailable", "Practice is not available right now.")
    if not _practice_allowed(str(ctx.tenant.id), time.monotonic()):
        raise ApiError(429, "practice_busy", "That's a lot of practice for one hour. Try again a little later.")
    if body.training is not None:
        training = body.training
    else:
        row = _repo(runtime).get(ctx.principal.token, ctx.tenant.id)
        training = TalkTraining.model_validate(row["doc"]) if row is not None and isinstance(row.get("doc"), dict) else _defaults(runtime, ctx)
    last = body.turns[-1].text
    if is_goodbye(last):   # as on a call: a bye is answered by the fixed closing line, and the call ends
        return PracticeOut(reply=persona.CALL_BYE.get(body.language, persona.CALL_BYE["en"]), ended=True, handover=False)
    business = ctx.tenant.name
    system = persona.system_prompt(business=business, assistant=persona.DEFAULT_ASSISTANT, language=body.language, purpose="inbound", facts=[], customer_first_name=None,
                                   training=training.model_dump(mode="json"))
    messages = [{"role": "user" if t.who == "customer" else "assistant", "content": t.text} for t in body.turns]
    events: list[str] = []
    llm = PhoneLlm(bv.fast_llm(), business, lambda: body.language, on_event=events.append)

    async def reply() -> str:
        return "".join([piece async for piece in llm.stream(system, messages, bv.model_ids()["fast"])]).strip()

    try:
        said = await asyncio.wait_for(reply(), 25.0)
    except Exception:   # noqa: BLE001 - the model did not answer: a plain retry message, never a half reply
        raise ApiError(503, "practice_unavailable", "The assistant didn't answer just now. Try again.") from None
    return PracticeOut(reply=said, ended=any(e in ("end", "stop") for e in events), handover="handover" in events)
