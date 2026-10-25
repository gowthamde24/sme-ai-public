"""The Owner's own voice under /v1/tenants/{tenant_id}/voice-clone (job DP part 5). The contract is packages/contracts/own_voice.* and docs/contracts/own-voice.md.

  GET    /voice-clone/sentence?name=   the exact consent sentence to read aloud, with that name and the business's name. Owner.
  GET    /voice-clone                  the status (none, pending, ready, failed, deleted), the consenting name and time, the languages. Owner, Admin. No recording is ever returned.
  POST   /voice-clone                  make the voice: the sample (15 to 60 s), the recorded consent sentence, the name; all in one JSON body (base64). Owner, second factor. A fake provider.
  POST   /voice-clone/delete           "delete my voice": the provider's voice, the sample, the consent recording and the name go. Owner, second factor. (The API has no DELETE verb anywhere.)

Once ready, the voice is the persona `own_voice` in Settings > AI assistant (PUT /ai-assistant with voice_persona `own_voice`). The assistant still says it is the AI assistant.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.ownvoice.models import OwnVoiceIn, OwnVoiceOut, PersonName, SentenceOut
from app.ownvoice.service import OwnVoiceService
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/voice-clone", tags=["voice"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
MAX_BODY = 20 * 1024 * 1024


def _service(runtime: Runtime) -> OwnVoiceService:
    if runtime.own_voice is None:
        raise ApiError(503, "own_voice_unavailable", "Your own voice is not available right now.")
    return runtime.own_voice


@router.get("/sentence", response_model=SentenceOut)
def sentence(ctx: OwnerOnly, runtime: RuntimeDep, name: Annotated[PersonName, Query()]) -> SentenceOut:
    return _service(runtime).sentence(ctx.principal.token, ctx.tenant.id, name)


@router.get("", response_model=OwnVoiceOut)
def get_voice(ctx: OwnerAdmin, runtime: RuntimeDep) -> OwnVoiceOut:
    return _service(runtime).get(ctx.principal.token, ctx.tenant.id)


@router.post("", response_model=OwnVoiceOut)
def make_voice(request: Request, body: OwnVoiceIn, ctx: OwnerStrong, runtime: RuntimeDep) -> OwnVoiceOut:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BODY:
        raise ApiError(413, "recording_too_large", "That recording is too big.")
    return _service(runtime).create(ctx.principal.token, ctx.tenant.id, body)


@router.post("/delete", response_model=OwnVoiceOut)
def delete_voice(ctx: OwnerStrong, runtime: RuntimeDep) -> OwnVoiceOut:
    return _service(runtime).delete(ctx.principal.token, ctx.tenant.id)
