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
# nothing. For local development and tests only (like selftest_script). It plays a CAREFUL model:
# it skips text addressed to an AI (an instruction is never evidence), quotes only sentences that
# say something, and cites one quote for every claim that sentence supports. It is a stand-in:
# real quality is measured only with a real model (M4).
_PAGE_BLOCK = re.compile(r"page: (p\d)\nurl: [^\n]*\ntext: ([^\n]*)", re.DOTALL)
_ADDRESSED_TO_AN_AI = re.compile(
    r"\b(ignore (?:all |your |the )?(?:previous |prior )?(?:rules|instructions|policy)|"
    r"ai agent|system message|assistant:|you are now|tool result|developer mode|"
    r"record the claim|write the claim|call send_email)\b",
    re.I,
)
# (what a sentence must contain, the predicate and value it supports): deliberately blunt keywords
_RESEARCH_RULES: tuple[tuple[re.Pattern[str], str, str], ...] = (
    (
        re.compile(r"closed permanently|permanently closed|shut down for good", re.I),
        "operating_status",
        "closed",
    ),
    (
        re.compile(r"temporarily closed|not operating|on a break", re.I),
        "operating_status",
        "inactive",
    ),
    (
        re.compile(r"open (?:daily|every day|six days|seven days)", re.I),
        "operating_status",
        "active",
    ),
    (re.compile(r"multi-?brand", re.I), "buyer_type", "multi_brand_store"),
    (
        re.compile(r"\b\d+ (?:stores|branches|outlets)\b|chain of", re.I),
        "buyer_type",
        "regional_chain",
    ),
    (re.compile(r"boutique", re.I), "buyer_type", "boutique"),
    (
        re.compile(r"\b(?:our|a|the) (?:family )?saree (?:shop|store|showroom)\b", re.I),
        "buyer_type",
        "saree_shop",
    ),
    (
        re.compile(r"walk-in customers|retail customers only|individual customers only", re.I),
        "buyer_type",
        "consumer",
    ),
    (re.compile(r"school uniforms|dress fabrics", re.I), "buyer_type", "other"),
    (re.compile(r"wholesale", re.I), "buyer_type", "wholesaler"),
    (
        re.compile(r"minimum (?:of )?five pieces|five or more pieces", re.I),
        "order_scale",
        "five_or_more_per_order",
    ),
    (
        re.compile(r"single pieces|no bulk|one piece at a time", re.I),
        "order_scale",
        "fewer_than_five_per_order",
    ),
    (
        re.compile(r"\b(?:over|more than) \d{3,} (?:staff|employees)|large group", re.I),
        "size_band",
        "large",
    ),
    (re.compile(r"mid-sized|medium-sized", re.I), "size_band", "medium"),
    (re.compile(r"small (?:team|business)", re.I), "size_band", "small"),
    (re.compile(r"two people|one-person|home-based", re.I), "size_band", "micro"),
)


def pages_in(request: LlmRequest) -> dict[str, str]:
    """handle -> text of every page block in a request."""
    found: dict[str, str] = {}
    for block in request.blocks:
        match = _PAGE_BLOCK.search(block.text)
        if match:
            found[match.group(1)] = match.group(2)
    return found


class _Reader:
    """Plans, once, which sentences to quote and what each supports; hands the calls out five at a
    time (a turn may carry at most five). The last chunk carries the final result."""

    def __init__(self) -> None:
        self._chunks: list[list[ToolCall]] | None = None
        self._next = 0

    @staticmethod
    def _plan(request: LlmRequest) -> list[list[ToolCall]]:
        quotes: list[tuple[str, str, list[tuple[str, str]]]] = []
        seen: set[tuple[str, str]] = set()
        for handle, text in pages_in(request).items():
            for sentence in (s.strip() for s in re.split(r"(?<=[.!?])\s+", text)):
                if (
                    not 12 <= len(sentence) <= 300
                    or _ADDRESSED_TO_AN_AI.search(sentence)
                    or "[contact removed]"
                    in sentence  # a careful reader never quotes contact details
                ):
                    continue
                found = [(p, v) for pattern, p, v in _RESEARCH_RULES if pattern.search(sentence)]
                # one claim per predicate per sentence: the first rule that fits, in the order above
                claims = list({p: (p, v) for p, v in reversed(found)}.values())[::-1]
                claims = [c for c in claims if c not in seen]
                if claims:
                    seen.update(claims)
                    quotes.append((handle, sentence, claims))
        calls: list[ToolCall] = []
        evidence = proposed = 0
        for handle, sentence, claims in quotes:
            if evidence >= 3 or proposed >= 4:
                break
            evidence += 1
            calls.append(call("record_evidence", page=handle, quote=sentence))
            for predicate, value in claims:
                if proposed >= 4:
                    break
                proposed += 1
                calls.append(
                    call(
                        "propose_claim",
                        predicate=predicate,
                        value=value,
                        stance="supports",
                        evidence=f"e{evidence}",
                    )
                )
        return [calls[i : i + 5] for i in range(0, len(calls), 5)] or [[]]

    def __call__(self, request: LlmRequest) -> LlmResponse:
        if self._chunks is None:
            self._chunks = self._plan(request)
        chunk = self._chunks[self._next] if self._next < len(self._chunks) else []
        self._next += 1
        last = self._next >= len(self._chunks)
        return respond(
            *chunk,
            structured=final().structured if last else None,
            tokens_in=400,
            tokens_out=120,
        )


def research_script() -> list[Step]:
    reader = _Reader()
    return [
        respond(call("fetch_page", path="/"), call("fetch_page", path="/about")),
        reader,
        reader,
    ]
