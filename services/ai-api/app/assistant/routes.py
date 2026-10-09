"""The Main agent over HTTP, under /v1/tenants/{tenant_id}/assistant/... (job AG).

  POST /assistant/messages                 one message of the owner; the answer STREAMS back as server-sent events
  GET  /assistant/conversations/{id}       a chat as stored, with its sources and draft cards (labels read fresh)

Authorization, in order: a valid JWT (401); membership of the tenant in the PATH (404); a role of Owner, Admin or Sales (403); then the DATABASE decides again: it proves the
role, the switches (platform, assistant, workspace), the run limits and the day's cost cap, and stores the message and starts the run in one step. The assistant reads and
drafts with the caller's own token only. Nothing is sent, approved or priced.

The model call is not streamed token by token (the model interface is one call at a time); what streams is the progress (`step`), then the finished answer in pieces
(`text`), then one `source` per source, one `draft` per draft, and `done`; or `error` in their place. Events: text, source, draft, error, done. Each is a server-sent event
(`event: <type>` and one `data:` line of JSON that repeats `type`), so a client can read the data line alone.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py."""

import json
import logging
import queue
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.agent_runs import pause
from app.agents.errors import (
    AgentDbError,
    AgentsDisabled,
    CostCapReached,
    DataLayerUnavailable,
    LimitReached,
    RunDenied,
    RunExpired,
    ValueRefused,
)
from app.assistant import resolver
from app.assistant.db import AssistantDb, MessageConflict
from app.assistant.language import detect_language
from app.assistant.models import ConversationOut, MessageIn, MessageOut
from app.assistant.runner import AssistantRunner, Outcome, _sha
from app.assistant.tools import Ctx, State
from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

logger = logging.getLogger("app.assistant.routes")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]
HISTORY_LINES = 8

# fixed sentences for the ways a message can fail; nothing from the model or the data layer reaches a client
FAILURES: dict[str, tuple[str, str]] = {
    "killed": ("agents_disabled", "The assistant is switched off for this workspace."),
    "budget": (pause.CODE, pause.MESSAGE),
    "model_failed": (
        "model_failed",
        "The assistant could not answer just now. Send the message again as a new message.",
    ),
    "expired": ("token_expiring", "Your session is about to expire. Sign in again and retry."),
    "cancelled": ("run_not_running", "That message was stopped."),
    "tool_failed": (
        "assistant_failed",
        "The assistant could not finish. Send the message again as a new message.",
    ),
    "invalid_output": (
        "assistant_failed",
        "The assistant could not finish. Send the message again as a new message.",
    ),
}


def _unavailable(reason: str) -> ApiError:
    return ApiError(
        503, "assistant_unavailable", f"The assistant is not available right now ({reason})."
    )


def _refusal(
    exc: AgentDbError, today_repo: Any = None, token: str = "", tenant: uuid.UUID | None = None
) -> ApiError:
    if isinstance(exc, AgentsDisabled):
        return ApiError(
            409, "agents_disabled", "The assistant is not switched on for this workspace."
        )
    if isinstance(exc, LimitReached):
        return ApiError(429, "run_limit_reached", "Too many agent runs. Try again later.")
    if isinstance(exc, CostCapReached):
        return pause.paused_error(pause.resolve_until(today_repo, token, tenant))
    if isinstance(exc, RunExpired):
        return ApiError(
            409, "token_expiring", "Your session is about to expire. Sign in again and retry."
        )
    if isinstance(exc, RunDenied):
        return not_found()
    if isinstance(exc, ValueRefused):
        return ApiError(422, "validation_error", "Invalid input.")
    if isinstance(exc, MessageConflict):
        return ApiError(
            409,
            "message_id_used",
            "That message id was already used for different words. Use a new one.",
        )
    if isinstance(exc, DataLayerUnavailable):
        return ApiError(502, "upstream_error", "The data layer failed.")
    return ApiError(502, "upstream_error", "The data layer failed.")


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _factory(runtime: Runtime) -> Any:
    agents = runtime.agents
    if agents is None or agents.assistant_db is None or agents.assistant_llm is None:
        raise _unavailable(
            agents.unavailable if agents is not None and agents.unavailable else "not configured"
        )
    return agents


@router.post("/assistant/messages")
def send_message(body: MessageIn, ctx: SalesPlus, runtime: RuntimeDep) -> StreamingResponse:
    """One message of the owner. The answer streams back as server-sent events."""
    agents = _factory(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    conversation_id = body.conversation_id or uuid.uuid4()
    run_id = uuid.uuid4()
    language = detect_language(body.text)
    db: AssistantDb = agents.assistant_db(token, run_id)
    try:
        began = db.begin_message(
            tenant_id=tenant,
            conversation_id=conversation_id,
            message_id=body.message_id,
            text=body.text,
            language=language,
            input_sha256=_sha(
                {
                    "conversation": str(conversation_id),
                    "message": str(body.message_id),
                    "text": body.text,
                }
            ),
        )
    except AgentDbError as exc:
        db.close()
        raise _refusal(exc, runtime.today, token, tenant) from None

    if began.get("replayed"):
        # the same message again: the stored answer, if there is one; nothing is spent
        try:
            stored = db.conversation(conversation_id)
        finally:
            db.close()
        messages = (stored or {}).get("assistant_messages") or []
        reply = next(
            (m for m in messages if str(m["id"]) == str(began.get("reply_message_id"))), None
        )
        if reply is None:
            raise ApiError(
                409,
                "message_unanswered",
                "That message was not answered. Send it again as a new message.",
            )
        db2: AssistantDb = agents.assistant_db(token, uuid.uuid4())
        try:
            sources, drafts = resolver.resolve(db2, reply["sources"], reply["drafts"])
        finally:
            db2.close()

        def replay() -> Iterator[str]:
            yield _sse("text", {"type": "text", "delta": reply["body"]})
            for source in sources:
                yield _sse("source", {"type": "source", **source.model_dump(mode="json")})
            for draft in drafts:
                yield _sse("draft", {"type": "draft", **draft.model_dump(mode="json")})
            yield _sse(
                "done",
                {
                    "type": "done",
                    "message_id": str(reply["id"]),
                    "conversation_id": str(conversation_id),
                    "language": reply.get("language"),
                    "kind": "replayed",
                },
            )

        return StreamingResponse(
            replay(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )

    seq = int(began.get("seq") or 1)
    history = db.history(conversation_id, seq, HISTORY_LINES)
    state = State()
    runner = AssistantRunner(
        db=db, llm=agents.assistant_llm(), ctx=Ctx(db, runtime, token, tenant, run_id, state)
    )
    events: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()
    reply_id = uuid.uuid4()
    outcome_box: list[Outcome] = []

    def work() -> None:
        try:
            outcome_box.append(
                runner.run(
                    question=body.text,
                    language=language,
                    history=history,
                    emit=lambda e, d: events.put((e, d)),
                    message_id=reply_id,
                )
            )
        except (
            Exception
        ) as exc:  # last resort: only the class is kept; the stream ends with a fixed error
            logger.error("assistant run %s crashed: %s", run_id, exc.__class__.__name__)
            outcome_box.append(Outcome("failed", "tool_failed"))
        finally:
            events.put(None)
            db.close()

    threading.Thread(target=work, daemon=True).start()

    def stream() -> Iterator[str]:
        while True:
            item = events.get()
            if item is None:
                break
            yield _sse(item[0], item[1])
        outcome = outcome_box[0] if outcome_box else Outcome("failed", "tool_failed")
        if outcome.reply is None:
            code, message = FAILURES.get(
                outcome.error_code or "tool_failed", FAILURES["tool_failed"]
            )
            event: dict[str, Any] = {"type": "error", "code": code, "message": message}
            if (
                code == pause.CODE
            ):  # the time the AI is back (the allowance of the day or the month is used up)
                event["until"] = (
                    pause.resolve_until(runtime.today, token, tenant)
                    .astimezone(UTC)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
            yield _sse("error", event)
        else:
            yield _sse(
                "done",
                {
                    "type": "done",
                    "message_id": str(reply_id),
                    "conversation_id": str(conversation_id),
                    "language": outcome.reply.language,
                    "kind": outcome.reply.kind,
                },
            )

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.get("/assistant/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(conversation_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> ConversationOut:
    """A chat as stored. A person reads only their own chats (the database sees to it); anyone else's, an erased one and an unknown one are the same 404."""
    agents = _factory(runtime)
    try:
        parsed = uuid.UUID(conversation_id)
    except ValueError:
        raise not_found() from None
    db: AssistantDb = agents.assistant_db(ctx.principal.token, uuid.uuid4())
    try:
        try:
            row = db.conversation(parsed)
            if row is None:
                raise not_found()
            messages: list[MessageOut] = []
            for m in row.get("assistant_messages") or []:
                sources, drafts = resolver.resolve(db, m["sources"], m["drafts"])
                messages.append(
                    MessageOut(
                        id=m["id"],
                        role=m["role"],
                        text=m["body"],
                        language=m.get("language"),
                        sources=sources,
                        drafts=drafts,
                        created_at=m["created_at"],
                    )
                )
        except AgentDbError as exc:
            raise _refusal(exc) from None
    finally:
        db.close()
    return ConversationOut(
        id=row["id"], created_at=row["created_at"], updated_at=row["updated_at"], messages=messages
    )
