"""What defines an agent inside the runtime: its name and version, its fixed policy text, its
tools and its loop limits. (The database holds the other half: agent_definitions, the
operator-managed allow-lists and ceilings.)"""

from __future__ import annotations

from dataclasses import dataclass

from app.agents.tools import Tool


@dataclass(frozen=True)
class AgentSpec:
    name: str
    version: str
    system_prompt: str
    turn_hints: tuple[str, ...]
    tools: tuple[Tool, ...]
    claim_predicate: str
    max_turns: int = 4
    max_calls_per_turn: int = 5
