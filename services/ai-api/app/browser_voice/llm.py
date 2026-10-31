"""The brains of the browser voice (job DV): two tiers behind the conversation loop's one StreamingLlm port, so the loop (job natural-voice) is reused, not forked.

  fast    a short spoken reply from the streaming model (Claude Haiku by default: the model already approved and priced on staging; Sarvam 105b is the faster one measured in #153, but it needs its price row and
          spend confirmation, ADR 0102, so it is a setting, not the default). Small talk, thanks, yes/no.
  ask     anything that needs the business's own data (the router sends prices, stock, dates, numbers, long questions here): the SAME Ask run as the written assistant (`start_message`: tools, citations, the honesty
          rule, its cost ledger and allowance), then spoken. Ask writes its answer when it has checked; the loop plays a filler meanwhile. What is spoken is shortened (at most MAX_SPOKEN_CHARS, at a sentence end,
          markdown and citation marks removed); the full text reaches the screen as captions marked `spoken: false`, with the sources.

`emit(kind, data)` is the session's way to show captions, sources and steps; the tiers call it, they know no socket."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any

from app.conversation.parts import StreamingLlm

log = logging.getLogger("app.browser_voice")

MAX_SPOKEN_CHARS = 420
ASK_MODEL = "ask"
Emit = Callable[[str, dict[str, Any]], None]

_MARK = re.compile(r"(\*\*|__|`+|^#{1,6}\s*|^\s*[-*•]\s+|\[\d+\]|\[S\d+\]|\(source[^)]*\))", re.MULTILINE)
_SPACES = re.compile(r"\s+")
_CITES = re.compile(r"(\[\d+\]|\[S\d+\]|\(source[^)]*\))")


def written_for_screen(text: str) -> str:
    """The answer as it is SHOWN: its Markdown (lists, bold, line breaks) kept, only the citation marks taken out."""
    return "\n".join(_CITES.sub("", line).rstrip() for line in text.strip().splitlines()).strip()


def speakable(text: str) -> str:
    """Written text as something to say: no markdown marks, no citation numbers, one line."""
    return _SPACES.sub(" ", _MARK.sub("", text).replace("\n", " ")).strip()


def cut_for_speech(text: str, limit: int = MAX_SPOKEN_CHARS) -> tuple[str, str]:
    """(what to say, the rest): the first sentences that fit in `limit` characters (at least one sentence, whole)."""
    if len(text) <= limit:
        return text, ""
    cut = -1
    for m in re.finditer(r"[.!?।](?:\s|$)", text):
        if m.end() <= limit:
            cut = m.end()
        elif cut == -1:
            cut = m.end()
            break
        else:
            break
    if cut == -1:
        cut = limit
    return text[:cut].strip(), text[cut:].strip()


def parse_sse(block: str) -> tuple[str, dict[str, Any]] | None:
    event, data = "message", ""
    for line in block.splitlines():
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data += line[5:].strip()
    try:
        parsed = json.loads(data) if data else {}
    except ValueError:
        return None
    return (event, parsed) if isinstance(parsed, dict) else None


class AskTurns:
    """One Ask conversation for the whole voice session (so a follow-up has its history). `open(text)` returns Ask's stream of server-sent events for the caller's words; it raises ApiError as the route does."""

    def __init__(self, open_stream: Callable[[uuid.UUID, uuid.UUID, str], Iterator[str]], conversation_id: uuid.UUID | None = None) -> None:
        # `conversation_id`: the thread the web is already in (typed, dictated and live turns are ONE conversation); None starts a new one
        self._open, self.conversation_id = open_stream, conversation_id or uuid.uuid4()

    def open(self, text: str) -> Iterator[str]:
        return self._open(self.conversation_id, uuid.uuid4(), text)


class AskLlm:
    def __init__(self, turns: AskTurns, emit: Emit, *, limit: int = MAX_SPOKEN_CHARS) -> None:
        self._turns, self._emit, self._limit = turns, emit, limit

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        question = messages[-1]["content"]
        events = await asyncio.to_thread(self._turns.open, question)
        written: list[str] = []
        late: list[tuple[str, dict[str, Any]]] = []
        sentinel = object()
        while True:
            block = await asyncio.to_thread(next, events, sentinel)
            if block is sentinel:
                break
            parsed = parse_sse(str(block))
            if parsed is None:
                continue
            kind, data = parsed
            if kind == "text":
                written.append(str(data.get("delta", "")))
            elif kind in ("source", "draft", "step"):
                self._emit(kind, data)
            elif kind in ("confirm_action", "clarify"):
                late.append((kind, data))   # said first, shown after: the plan card follows the spoken plan
            elif kind == "done":
                if str(data.get("kind", "answer")) == "answer":
                    late.append(("reply", {"kind": "answer"}))
            elif kind == "error":
                self._emit("error", {"code": str(data.get("code", "ask_failed")), "message": str(data.get("message", ""))})
                return
        raw = "".join(written)
        full = speakable(raw)
        say, _rest = cut_for_speech(full, self._limit)
        if say:
            # ONE caption with the whole answer as written (Markdown lists keep their lines); only the voice gets the flattened short part, named in `spoken_text`
            self._emit("caption", {"who": "assistant", "text": written_for_screen(raw), "spoken": True, "spoken_text": say})
            yield say
        for kind, data in late:
            self._emit(kind, {k: v for k, v in data.items() if k != "type"})


class CaptionLlm:
    """The fast tier: passes the model's pieces through and shows them as captions."""

    def __init__(self, inner: StreamingLlm, emit: Emit) -> None:
        self._inner, self._emit = inner, emit

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        async for piece in self._inner.stream(system, messages, model):
            self._emit("caption", {"who": "assistant", "text": piece, "spoken": True})
            yield piece

    def speculate(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
        """A reply started on unconfirmed words (see FastThread.speculate), or None when the model behind cannot; the captions are shown only when it is served."""
        inner = getattr(self._inner, "speculate", None)
        spec = inner(system, messages, model) if inner is not None else None
        if spec is None:
            return None
        return _CaptionedSpeculation(spec, self._emit)


class _CaptionedSpeculation:
    def __init__(self, spec: Any, emit: Emit) -> None:
        self._spec, self._emit = spec, emit
        self.text = spec.text

    async def stream(self) -> AsyncIterator[str]:
        async for piece in self._spec.stream():
            self._emit("caption", {"who": "assistant", "text": piece, "spoken": True})
            yield piece

    async def cancel(self) -> None:
        await self._spec.cancel()


class TieredLlm:
    """`model == ASK_MODEL` goes to Ask; any other model id goes to the fast streaming model."""

    def __init__(self, fast: StreamingLlm, ask: StreamingLlm, on_ask: Callable[[], None] = lambda: None) -> None:
        self._fast, self._ask, self._on_ask = fast, ask, on_ask

    def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        if model == ASK_MODEL:
            self._on_ask()
            return self._ask.stream(system, messages, model)
        return self._fast.stream(system, messages, model)

    def speculate(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
        """Only the fast tier can start a reply before the words are confirmed (the written chat's turn writes the thread at once)."""
        if model == ASK_MODEL:
            return None
        inner = getattr(self._fast, "speculate", None)
        return inner(system, messages, model) if inner is not None else None
