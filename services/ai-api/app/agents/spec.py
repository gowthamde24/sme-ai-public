"""What defines an agent inside the runtime: its name and version, its fixed policy text, its
tools and its loop limits. (The database holds the other half: agent_definitions, the
operator-managed allow-lists and ceilings.)"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from app.agents.llm.interface import TaskClass
from app.agents.tools import Tool, ToolContext


@dataclass(frozen=True)
class AgentSpec:
    name: str
    version: str
    system_prompt: str
    turn_hints: tuple[str, ...]
    tools: tuple[Tool, ...]
    claim_predicate: str
    # what this agent's model calls are for (declared; the routing table picks the model)
    task_class: TaskClass
    max_turns: int = 4
    max_calls_per_turn: int = 5
    # reads the company's own website through a PageFetcher (the runtime refuses to start such a run
    # without a fetcher or without a website host, before any model call)
    uses_web: bool = False
    # what the run is about: a company or lead (the default) or an enquiry (the requirement agent)
    target_kind: str = "company"
    # run once, after a valid final result and before the run is closed as succeeded: the
    # requirement agent writes its buffered proposals here (returns how many the database refused)
    finalize: Callable[[ToolContext], int] | None = None
