"""The ONLY prompt builder. Our own constant policy goes in the SYSTEM block; our own fixed
phrases in TRUSTED blocks; every fact about the outside world in exactly one UNTRUSTED block,
between a per-run random delimiter that the content cannot contain, flattened to single-line
values with control characters removed. Untrusted text is never placed in the system role."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from app.agents.inputs import ModelInput
from app.agents.llm.interface import Block, LlmRequest, ToolSpec, Trust
from app.agents.notes import FIXED_NOTES, NOTE_RECORDED, NOTE_REFUSED, NOTE_REPAIR
from app.agents.schemas import FinalResult
from app.agents.spec import AgentSpec

__all__ = [
    "FINAL_RESULT",
    "NOTE_RECORDED",
    "NOTE_REFUSED",
    "NOTE_REPAIR",
    "build_request",
    "escape_value",
]

FINAL_RESULT = ToolSpec(
    "final_result",
    "Report that you are done: a short summary and your uncertainty.",
    FinalResult.model_json_schema(),
)

_MARKS = re.compile(r"<{3,}|>{3,}")


def escape_value(value: str | None, delimiter: str) -> str:
    """One line, no control or hidden characters, no way to produce the delimiter or a marker."""
    if value is None:
        return "(none)"
    flat = "".join(" " if unicodedata.category(ch).startswith("C") else ch for ch in value)
    flat = " ".join(flat.split())
    flat = re.sub(re.escape(delimiter), "[removed]", flat, flags=re.IGNORECASE)
    flat = _MARKS.sub(lambda m: " ".join(m.group(0)), flat)
    return flat or "(none)"


def build_request(
    spec: AgentSpec,
    model_input: ModelInput,
    *,
    turn: int,
    delimiter: str,
    notes: Sequence[str],
    max_output_tokens: int,
) -> LlmRequest:
    if not re.fullmatch(r"[0-9a-f]{6,64}", delimiter):
        raise ValueError("the delimiter must be a random hex string")
    for note in notes:
        if note not in FIXED_NOTES:
            raise ValueError("only fixed phrases may flow back to the model as trusted text")
    hint = spec.turn_hints[min(turn, len(spec.turn_hints)) - 1]
    blocks = [Block(Trust.SYSTEM, spec.system_prompt), Block(Trust.TRUSTED, f"Turn {turn}. {hint}")]
    if notes:
        blocks.append(Block(Trust.TRUSTED, " ".join(dict.fromkeys(notes))))
    data = "\n".join(
        (
            f"<<<DATA {delimiter}",
            f"company_name: {escape_value(model_input.company_name, delimiter)}",
            f"city: {escape_value(model_input.city, delimiter)}",
            f"region: {escape_value(model_input.region, delimiter)}",
            f"website_host: {escape_value(model_input.website_host, delimiter)}",
            f"DATA {delimiter}>>>",
        )
    )
    blocks.append(Block(Trust.UNTRUSTED, data))
    return LlmRequest(
        blocks=tuple(blocks),
        tools=tuple(t.spec() for t in spec.tools),
        max_output_tokens=max_output_tokens,
        final_result=FINAL_RESULT,
    )
