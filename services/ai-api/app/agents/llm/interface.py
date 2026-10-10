"""The ONLY description of a model that the rest of the system knows (CLAUDE.md #9: provider
integrations behind interfaces).

A request is a list of blocks tagged with how far they are trusted: SYSTEM (our own constant
policy text), TRUSTED (our own fixed phrases) and UNTRUSTED (data from the outside world:
company names, web pages, e-mail, documents). An adapter must put untrusted blocks inside the
user turn, delimited, and never in the system role. Nothing provider-specific appears here."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Protocol


class Trust(StrEnum):
    SYSTEM = "system"
    TRUSTED = "trusted"
    UNTRUSTED = "untrusted"


class TaskClass(StrEnum):
    """What a model call is FOR, declared by the agent at every call. Today both classes use the
    main model (and both use the light one while a workspace is over its allowance: see
    routing.py); the model bake-off fills the routing table later."""

    SIMPLE = "simple"
    HARD = "hard"


@dataclass(frozen=True)
class Block:
    trust: Trust
    text: str


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class LlmRequest:
    blocks: tuple[Block, ...]
    tools: tuple[ToolSpec, ...]
    max_output_tokens: int
    task_class: TaskClass
    # How the model reports that it is DONE: a structured result in this shape (an adapter
    # offers it as a tool of this name and returns the arguments as `LlmResponse.structured`).
    # Never an instruction to do anything.
    final_result: ToolSpec | None = None


@dataclass(frozen=True)
class ToolCall:
    """What the model ASKED for. Untrusted: the runtime checks the name against the allowlist and
    the arguments against a closed schema before anything happens."""

    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int
    cost_micros: int


@dataclass(frozen=True)
class LlmResponse:
    tool_calls: tuple[ToolCall, ...]
    structured: dict[str, Any] | None
    usage: Usage


class LlmClient(Protocol):
    @property
    def model_id(self) -> str:
        """The model this client calls: the key of the operator's price table (the daily cost cap
        reserves a worst-case cost at THAT price before every call)."""
        ...

    def complete(self, request: LlmRequest) -> LlmResponse: ...


class LlmError(Exception):
    """A provider failure. `str(error)` is a constant code: no provider body, URL, key or prompt
    text is ever carried."""

    code = "llm_error"

    def __init__(self) -> None:
        super().__init__(self.code)


class LlmRateLimited(LlmError):
    code = "rate_limited"


class LlmUnavailable(LlmError):
    code = "unavailable"


class LlmTimeout(LlmError):
    code = "timeout"


class LlmBadResponse(LlmError):
    code = "bad_response"


class LlmRejected(LlmError):
    """The provider refused the request itself (4xx other than 429): a bug or a bad configuration,
    not
        a retry."""

    code = "rejected"


class LlmNotConfigured(LlmError):
    code = "not_configured"
