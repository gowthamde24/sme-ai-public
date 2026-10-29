"""One cost-accounted model call outside a chat (job EB part A): the notes' "understand" and "test". It follows the task planner: a bookkeeping run on the caller's own token (the day's cost cap is checked BEFORE
the call, the usage is recorded after), with the model that serves the assistant. The words go in as DATA between a random delimiter; the answer comes back as a closed structured result."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import uuid
from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, Any

from app.agents.errors import AgentDbError
from app.agents.llm.interface import Attachment, Block, LlmError, LlmRequest, TaskClass, ToolSpec
from app.agents.llm.routing import as_router
from app.agents.runtime import NOT_BILLED, input_token_bound
from app.errors import ApiError

if TYPE_CHECKING:
    from app.auth.deps import Runtime

logger = logging.getLogger("app.assistant_context.modelrun")

UNDERSTAND_LABEL = "Read business notes"
TEST_LABEL = "Test business notes"


def delimiter() -> str:
    return secrets.token_hex(8)


def data_block(delim: str, lines: Sequence[str]) -> str:
    """Text for the model that is DATA: flattened so nothing in it can close the block."""
    clean = [" ".join(line.replace(delim, "").split())[:3000] for line in lines]
    return "\n".join((f"<<<DATA {delim}", *clean, f"DATA {delim}>>>"))


def run(
    runtime: Runtime,
    token: str,
    tenant_id: uuid.UUID,
    *,
    label: str,
    blocks: Sequence[Block],
    final: ToolSpec,
    max_output_tokens: int,
    charge: Callable[[Any], None] | None = None,
    attachments: tuple[Attachment, ...] = (),
) -> dict[str, Any]:
    """The structured result of one call, or an ApiError (the day's allowance, the model busy or not set up)."""
    from app.assistant.routes import (
        _refusal,  # (imported here: the routes import the runtime, which holds this module's service)
    )

    agents = runtime.agents
    factory = agents.llm_for("ask") if agents is not None else None
    if agents is None or agents.assistant_db is None or factory is None:
        raise ApiError(503, "model_unavailable", "The assistant's AI is not available right now. Try again in a minute.")
    run_id = uuid.uuid4()
    db = agents.assistant_db(token, run_id)
    status, code = "failed", "tool_failed"
    try:
        try:
            db.begin_message(
                tenant_id=tenant_id, conversation_id=uuid.uuid4(), message_id=uuid.uuid4(), text=label, language="en",
                input_sha256=hashlib.sha256(json.dumps({"label": label, "run": str(run_id)}).encode()).hexdigest(),
            )
            if charge is not None:
                charge(db)
        except AgentDbError as exc:
            raise _refusal(exc, runtime.today, token, tenant_id) from None
        router = as_router(factory())
        request = LlmRequest(blocks=tuple(blocks), tools=(), max_output_tokens=max_output_tokens, task_class=TaskClass.SIMPLE, final_result=final, attachments=attachments)
        llm = router.choose(request.task_class, db.ai_mode)
        if attachments and not getattr(llm, "supports_attachments", False):
            raise ApiError(503, "vision_unavailable", "Reading pictures and PDFs is not switched on for this system. Paste the text instead.")
        try:
            db.reserve_cost("usage-1", model=llm.model_id, max_input_tokens=input_token_bound(request), max_output_tokens=request.max_output_tokens)
        except AgentDbError as exc:
            raise _refusal(exc, runtime.today, token, tenant_id) from None
        try:
            response = llm.complete(request)
        except LlmError as exc:
            logger.warning("notes model call failed (%s)", exc.code)
            if exc.code in NOT_BILLED:
                try:
                    db.release_cost("usage-1", reason=exc.code)
                except AgentDbError as release_error:
                    logger.warning("notes cost not released (%s)", release_error.code)
            if exc.code == "rate_limited":
                raise ApiError(503, "model_busy", "The AI service is busy, try again in a minute.") from None
            raise ApiError(502, "model_unavailable", "The assistant's AI did not answer. Try again.") from None
        try:
            db.record_usage("usage-1", response.usage)
        except AgentDbError as exc:
            raise _refusal(exc, runtime.today, token, tenant_id) from None
        if response.structured is None:
            raise ApiError(502, "model_unavailable", "The assistant's AI did not give a usable answer. Try again.")
        try:
            db.save_reply(message_id=uuid.uuid4(), text="Done", language="en", sources=[], drafts=[])
        except AgentDbError as exc:
            logger.warning("notes run reply not stored (%s)", exc.code)
        status, code = "succeeded", ""
        return dict(response.structured)
    finally:
        try:
            db.finish(status, code or None)
        except Exception as exc:   # the bookkeeping must never hide the real result
            logger.warning("notes run could not be closed: %s", exc.__class__.__name__)
        db.close()
