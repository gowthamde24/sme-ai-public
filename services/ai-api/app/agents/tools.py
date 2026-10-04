"""Tools: what an agent may DO. A tool has a closed argument schema, runs against the run's own
database module, and answers with one of the fixed phrases of `notes`. No tool takes a tenant,
a run, a table, an evidence id or a token from the model: the run's tenant and target come
from the run row inside the database functions, and the evidence a claim links to is the one
this run's own note produced, held by the runtime in `RunState`."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from app.agents.llm.interface import ToolSpec
from app.agents.notes import NOTE_RECORDED, NOTE_REFUSED
from app.agents.ports import AgentDbPort
from app.agents.schemas import WriteNoteArgs, WriteObservationArgs

MAX_OBSERVATIONS = 3


@dataclass
class RunState:
    """What the runtime remembers between tool calls of one run (never the model)."""

    note_evidence_id: uuid.UUID | None = None
    observations: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class ToolContext:
    db: AgentDbPort
    state: RunState
    step_key: str


Handler = Callable[[ToolContext, Any], str]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Handler

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, self.args_model.model_json_schema())


def find(allowed: Sequence[Tool], name: str) -> Tool | None:
    """Exact, case-sensitive lookup in the agent's own allowlist."""
    for tool in allowed:
        if tool.name == name:
            return tool
    return None


def _write_note(ctx: ToolContext, args: WriteNoteArgs) -> str:
    if ctx.state.note_evidence_id is not None:
        return NOTE_REFUSED  # one note per run
    ctx.state.note_evidence_id = ctx.db.write_evidence(ctx.step_key, text=args.text)
    return NOTE_RECORDED


def _write_observation(ctx: ToolContext, args: WriteObservationArgs) -> str:
    if ctx.state.note_evidence_id is None or ctx.state.observations >= MAX_OBSERVATIONS:
        return NOTE_REFUSED  # a claim needs this run's note to rest on
    ctx.db.write_claim(
        ctx.step_key,
        value=args.value,
        stance=args.stance,
        evidence_id=ctx.state.note_evidence_id,
    )
    ctx.state.observations += 1
    return NOTE_RECORDED


WRITE_NOTE = Tool(
    "write_note",
    "Record one short note (at most 500 characters) about what you were shown. One note per run.",
    WriteNoteArgs,
    _write_note,
)
WRITE_OBSERVATION = Tool(
    "write_observation",
    "Record one observation about the company with a stance toward your note. "
    "At most three per run; write the note first.",
    WriteObservationArgs,
    _write_observation,
)
