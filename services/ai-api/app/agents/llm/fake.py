"""A scripted, deterministic model for tests and for local development. It needs no key and makes
no network call.

It can also play a model that OBEYS an injection (a script that emits whatever tool calls an
attacker would want): the runtime's containment is then tested independently of any real
model's behaviour. Use is refused outside development by the API's configuration
(app/agent_runs/factory.py), not here."""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from typing import Any

from app.agents.llm.interface import (
    LlmBadResponse,
    LlmError,
    LlmRequest,
    LlmResponse,
    ToolCall,
    Usage,
)

Step = LlmResponse | LlmError | Callable[[LlmRequest], LlmResponse]


def call(name: str, **arguments: Any) -> ToolCall:
    return ToolCall(name=name, arguments=dict(arguments))


def respond(
    *calls: ToolCall,
    structured: dict[str, Any] | None = None,
    tokens_in: int = 100,
    tokens_out: int = 50,
) -> LlmResponse:
    return LlmResponse(
        tool_calls=tuple(calls), structured=structured, usage=Usage(tokens_in, tokens_out, 0)
    )


def final() -> LlmResponse:
    return respond(structured={"summary": "DEMO selftest finished.", "uncertainty": "high"})


def selftest_responses() -> list[LlmResponse]:
    """A well-behaved selftest run: one note, two observations, a final result."""
    return [
        respond(
            call("write_note", text="DEMO selftest note: the data was read as untrusted input.")
        ),
        respond(
            call("write_observation", value="DEMO observation one (synthetic)", stance="supports"),
            call("write_observation", value="DEMO observation two (synthetic)", stance="context"),
        ),
        final(),
    ]


def selftest_script() -> list[Step]:
    return list(selftest_responses())


FAKE_MODEL_ID = "fake-selftest"  # the one development model the migration prices


class FakeProvider:
    model_id = FAKE_MODEL_ID

    def __init__(self, script: Sequence[Step]) -> None:
        self._script = list(script)
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if not self._script:
            raise LlmBadResponse
        step = self._script.pop(0)
        if isinstance(step, LlmError):
            raise step
        if isinstance(step, LlmResponse):
            return step
        return step(request)


# ---- a scripted RESEARCH model: reads the page blocks it is shown and abstains when they say
# nothing. For local development and tests only (like selftest_script); it follows no
# instruction in a page.
_PAGE_BLOCK = re.compile(r"page: (p\d)\nurl: [^\n]*\ntext: ([^\n]*)", re.DOTALL)
# (what a sentence must contain, the predicate and value it supports): deliberately blunt keywords
_RESEARCH_RULES: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (re.compile(r"closed permanently|permanently closed", re.I), "operating_status", "closed"),
    (re.compile(r"wholesale", re.I), "buyer_type", "wholesaler"),
    (
        re.compile(r"minimum (?:of )?five pieces|five or more pieces", re.I),
        "order_scale",
        "five_or_more_per_order",
    ),
    (re.compile(r"mid-sized", re.I), "size_band", "medium"),
)


def pages_in(request: LlmRequest) -> dict[str, str]:
    """handle -> text of every page block in a request."""
    found: dict[str, str] = {}
    for block in request.blocks:
        match = _PAGE_BLOCK.search(block.text)
        if match:
            found[match.group(1)] = match.group(2)
    return found


def _research_reading(request: LlmRequest) -> LlmResponse:
    calls: list[ToolCall] = []
    evidence = 0
    for handle, text in pages_in(request).items():
        for sentence in (s.strip() for s in re.split(r"(?<=[.!?])\s+", text)):
            if evidence >= 2 or not 12 <= len(sentence) <= 300:
                continue
            for pattern, predicate, value in _RESEARCH_RULES:
                if pattern.search(sentence) and evidence < 2:
                    evidence += 1
                    calls.append(call("record_evidence", page=handle, quote=sentence))
                    calls.append(
                        call(
                            "propose_claim",
                            predicate=predicate,
                            value=value,
                            stance="supports",
                            evidence=f"e{evidence}",
                        )
                    )
                    break
    return respond(*calls[:5], tokens_in=400, tokens_out=120)


def research_script() -> list[Step]:
    return [
        respond(call("fetch_page", path="/"), call("fetch_page", path="/about")),
        _research_reading,
        final(),
    ]
