"""The conversational assistant over HTTP, under /v1/tenants/{tenant_id}/assistant/... (job EA). The contract is ~/Desktop/stack19-jobs/contract-conversation.md.

  POST /assistant/turns                          one thing the owner says; the router decides the kind; the answer STREAMS back as server-sent events and ends in one typed reply
  GET  /assistant/conversations                  the caller's own conversations, newest first (title, last words, count)
  POST /assistant/conversations/{id}/archive     hide one from the list (nothing is deleted)
  POST /assistant/actions/{id}/confirm           the owner's yes or no to a plan the assistant proposed (Owner; the second factor when the owner turned it on)

The written Ask (POST /assistant/messages) and the read of one conversation (GET /assistant/conversations/{id}) stay where they are.

NOTE: no `from __future__ import annotations` here, for the same reason as app/assistant/routes.py."""

import logging
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from fastapi.responses import StreamingResponse

from app.agents.errors import AgentDbError
from app.assistant.db import AssistantDb
from app.assistant.routes import SSE_HEADERS, _factory, _refusal
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import not_found
from app.tenancy.models import Role
from app.turns.models import ConfirmIn, ConfirmOut, ConversationListOut, TurnIn
from app.turns.service import confirm_decision, start_turn

logger = logging.getLogger("app.turns.routes")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]


@router.post("/assistant/turns")
def send_turn(body: TurnIn, ctx: SalesPlus, runtime: RuntimeDep) -> StreamingResponse:
    """One turn. Every refusal (switches, limits, the day's cost cap, a message id used for other words) is an ordinary error BEFORE the stream starts."""
    return StreamingResponse(start_turn(runtime, ctx, body), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/assistant/conversations", response_model=ConversationListOut)
def list_conversations(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    before: Annotated[datetime | None, Query()] = None,
) -> dict[str, Any]:
    """The caller's own conversations (a person never sees anyone else's). `before` pages: pass the `next_before` of the page before."""
    agents = _factory(runtime)
    db: AssistantDb = agents.assistant_db(ctx.principal.token, uuid.uuid4())
    try:
        try:
            return db.list_conversations(tenant_id=ctx.tenant.id, limit=limit, before=before.isoformat() if before else None)
        except AgentDbError as exc:
            raise _refusal(exc) from None
    finally:
        db.close()


@router.post("/assistant/conversations/{conversation_id}/archive", status_code=204)
def archive_conversation(conversation_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> Response:
    try:
        parsed = uuid.UUID(conversation_id)
    except ValueError:
        raise not_found() from None
    agents = _factory(runtime)
    db: AssistantDb = agents.assistant_db(ctx.principal.token, uuid.uuid4())
    try:
        try:
            db.archive_conversation(tenant_id=ctx.tenant.id, conversation_id=parsed)
        except AgentDbError as exc:
            raise _refusal(exc) from None
    finally:
        db.close()
    return Response(status_code=204)


@router.post("/assistant/actions/{action_id}/confirm", response_model=ConfirmOut)
def confirm_action(action_id: str, body: ConfirmIn, background: BackgroundTasks, ctx: OwnerOnly, runtime: RuntimeDep) -> ConfirmOut:
    """The owner's yes or no. `yes` approves the planned task exactly as POST /tasks/{id}/approve does (the same caps, hours, consent and outbox rules apply afterwards); `no` cancels it. Asking again with
    the same answer gives the same answer."""
    try:
        task_id = uuid.UUID(action_id)
    except ValueError:
        raise not_found() from None
    return confirm_decision(runtime, ctx, task_id, body.decision, background.add_task)
