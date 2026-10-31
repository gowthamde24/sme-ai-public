"""Casual Live turns on the fast tier, in the SAME conversation thread (owner decision, 31 Oct 2026: "one thread stays the rule; only the model path differs").

Small talk and general help used to take the whole written-chat turn (begin the message, load the history, reserve the cost, ONE non-streaming model call, save the reply): about two seconds before the first
word. Here the same facts are written to the same thread, but the model STREAMS and the first clause goes to the voice as soon as it exists:

  * the caller's words are stored in the thread (`assistant_begin_message`, a LIGHT run: not counted against the hourly allowance) while the thread's earlier messages (typed, dictated, live) are read, together;
  * the fast model answers from that history with the call prompt (short, spoken, no markdown, the address rule);
  * the reply is saved to the thread when it ends or is cut: hygiene as in the written chat (no gendered address, no internal name), and the cost is reserved before and recorded after (estimated from
    the characters when the model does not say), so the day's cap sees it.
The router decides before: small talk and general help come here; business questions and actions keep the written chat's turn (tools, records, plans)."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

from app.agents.errors import AgentDbError
from app.agents.llm.interface import Usage
from app.agents.register.address import clean as clean_address
from app.assistant.tools import friendly_names
from app.conversation.parts import StreamingLlm

log = logging.getLogger("app.browser_voice.fast_thread")
HISTORY_MESSAGES = 10
ALL_SEQ = 2**31 - 1
MAX_REPLY_TOKENS = 200


class FastThread:
    def __init__(
        self,
        *,
        fast: StreamingLlm,
        open_db: Callable[[], Any],
        tenant_id: uuid.UUID,
        conversation_id: Callable[[], uuid.UUID],
        language: Callable[[], str],
        emit: Callable[[str, dict[str, Any]], None],
        refuse: Callable[[AgentDbError], dict[str, str]],
        allow_address: Callable[[], tuple[str, ...]] = lambda: (),
        input_micros_per_mtok: int = 0,
        output_micros_per_mtok: int = 0,
    ) -> None:
        self._fast, self._open_db, self._tenant, self._conversation, self._language = fast, open_db, tenant_id, conversation_id, language
        self._emit, self._refuse, self._allow = emit, refuse, allow_address
        self._in_price, self._out_price = input_micros_per_mtok, output_micros_per_mtok

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        text = messages[-1]["content"]
        db = self._open_db()
        conversation, message_id, reply_id = self._conversation(), uuid.uuid4(), uuid.uuid4()
        language = self._language()
        try:
            began, thread = await asyncio.gather(
                asyncio.to_thread(self._begin, db, conversation, message_id, text, language),
                asyncio.to_thread(self._thread, db, conversation, text),
            )
        except AgentDbError as exc:
            self._emit("error", self._refuse(exc))
            await asyncio.to_thread(self._close, db)
            return
        if began.get("replayed"):
            await asyncio.to_thread(self._close, db)
            return
        prompt = [*thread, {"role": "user", "content": text}]
        bound_in = max(1, (len(system) + sum(len(m["content"]) for m in prompt)))   # a token is at least one byte of what is sent: the bytes bound the tokens
        try:
            await asyncio.to_thread(db.reserve_cost, "usage-1", model=model, max_input_tokens=bound_in, max_output_tokens=MAX_REPLY_TOKENS)
        except AgentDbError as exc:
            self._emit("error", self._refuse(exc))
            await asyncio.to_thread(self._close, db, "failed", "budget")
            return
        pieces: list[str] = []
        status, code = "failed", "tool_failed"
        try:
            async for piece in self._fast.stream(system, prompt, model):
                pieces.append(piece)
                yield piece
            status, code = "succeeded", ""
        finally:
            # cut by the caller or finished: write what was said to the thread, off the critical path (a cancelled turn must not wait for the database)
            asyncio.get_running_loop().run_in_executor(None, self._settle, db, reply_id, "".join(pieces), language, len(system) + sum(len(m["content"]) for m in prompt), status, code, model)

    # ---- the database, in worker threads -----------------------------------------------------------------------------------------------------------

    def _begin(self, db: Any, conversation: uuid.UUID, message_id: uuid.UUID, text: str, language: str) -> dict[str, Any]:
        sha = hashlib.sha256(json.dumps({"conversation": str(conversation), "message": str(message_id), "text": text}).encode()).hexdigest()
        out: dict[str, Any] = db.begin_message(tenant_id=self._tenant, conversation_id=conversation, message_id=message_id, text=text, language=language, input_sha256=sha, light=True)
        return out

    def _thread(self, db: Any, conversation: uuid.UUID, text: str) -> list[dict[str, str]]:
        """The thread's earlier messages as a model's turns: oldest first, starting with a person's, without the message being stored right now."""
        try:
            rows = db.history(conversation, ALL_SEQ, HISTORY_MESSAGES + 1)
        except AgentDbError:
            return []   # a thread that cannot be read once is not a reason to stay silent: this turn answers without it
        turns = [{"role": "assistant" if r.get("role") == "assistant" else "user", "content": str(r.get("body") or "")} for r in rows if str(r.get("body") or "").strip()]
        if turns and turns[-1]["role"] == "user" and turns[-1]["content"] == text:
            turns.pop()   # (the begin ran first: the caller's own words are already in the thread)
        turns = turns[-HISTORY_MESSAGES:]
        while turns and turns[0]["role"] != "user":
            turns.pop(0)
        return turns

    def _settle(self, db: Any, reply_id: uuid.UUID, reply: str, language: str, bytes_in: int, status: str, code: str, model: str) -> None:
        try:
            written = friendly_names(clean_address(reply.strip(), self._allow()))
            if written:
                db.save_reply(message_id=reply_id, text=written, language=language, sources=[], drafts=[])
            tokens_in, tokens_out = bytes_in // 3 + 1, max(1, len(reply) // 2) if reply else 0   # estimates: the streaming model does not report them here
            micros = (tokens_in * self._in_price + tokens_out * self._out_price + 999_999) // 1_000_000
            db.record_usage("usage-1", Usage(tokens_in, tokens_out, micros))
            db.finish("succeeded" if written else status, None if written else (code or None))
        except Exception as exc:   # noqa: BLE001  the bookkeeping must never be the reason a spoken turn fails; only the class is kept
            log.warning("fast thread turn not fully stored (%s)", exc.__class__.__name__)
        finally:
            self._close(db)

    @staticmethod
    def _close(db: Any, status: str | None = None, code: str | None = None) -> None:
        try:
            if status:
                db.finish(status, code)
        except Exception:   # noqa: BLE001, S110
            pass
        try:
            db.close()
        except Exception:   # noqa: BLE001, S110
            pass
