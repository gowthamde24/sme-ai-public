"""Which model answers a call: the routing table.

Two things decide it: the TASK CLASS the agent declared on the request (simple or hard), and the
MODE the database reports for the workspace (normal, or light once the workspace is over its
allowance for the day or the month; see ADR 0064). Choosing a model is a cost decision only: the
database still prices the call at the model it is told about and enforces the caps, so a wrong
choice here can never spend past the hard cap.

The table below is the single place to change when the model bake-off has its answer. Today both
task classes use the main model in normal mode, and both use the light model in light mode. When no
light model is configured the main model serves every call (the hard cap still applies)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from enum import StrEnum

from app.agents.llm.interface import LlmClient, TaskClass


class Mode(StrEnum):
    NORMAL = "normal"
    LIGHT = "light"


class Role(StrEnum):
    MAIN = "main"
    LIGHT = "light"


ROUTING_TABLE: Mapping[tuple[TaskClass, Mode], Role] = {
    (TaskClass.SIMPLE, Mode.NORMAL): Role.MAIN,
    (TaskClass.HARD, Mode.NORMAL): Role.MAIN,
    (TaskClass.SIMPLE, Mode.LIGHT): Role.LIGHT,
    (TaskClass.HARD, Mode.LIGHT): Role.LIGHT,
}


class ModelRouter:
    """The main client, the optional light client and the table between them."""

    def __init__(
        self,
        main: LlmClient,
        light: LlmClient | None = None,
        table: Mapping[tuple[TaskClass, Mode], Role] = ROUTING_TABLE,
    ) -> None:
        self._main, self._light, self._table = main, light, table

    @property
    def light_model_id(self) -> str | None:
        """What to ask the database about (None = no light model: it is never asked)."""
        return self._light.model_id if self._light is not None else None

    def client_for(self, task_class: TaskClass, mode: Mode) -> LlmClient:
        if self._table[(task_class, mode)] is Role.LIGHT and self._light is not None:
            return self._light
        return self._main

    def choose(self, task_class: TaskClass, ask_mode: Callable[[str], str]) -> LlmClient:
        """The client for THIS call. `ask_mode(light_model)` is the database's answer ('light' or
        'normal'); it is asked only when a light model is configured."""
        light = self.light_model_id
        mode = mode_of(ask_mode(light)) if light is not None else Mode.NORMAL
        return self.client_for(task_class, mode)


def as_router(llm: LlmClient | ModelRouter) -> ModelRouter:
    return llm if isinstance(llm, ModelRouter) else ModelRouter(llm)


def mode_of(answer: str | None) -> Mode:
    """Anything but an explicit 'light' is normal (the safe direction: the main model, still
    capped)."""
    return Mode.LIGHT if answer == Mode.LIGHT.value else Mode.NORMAL
