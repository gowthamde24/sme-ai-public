"""A scripted, deterministic model for tests and for local development. It needs no key and makes
no network call.

It can also play a model that OBEYS an injection (a script that emits whatever tool calls an
attacker would want): the runtime's containment is then tested independently of any real
model's behaviour. Use is refused outside development by the API's configuration
(app/agent_runs/factory.py), not here."""

from __future__ import annotations

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
