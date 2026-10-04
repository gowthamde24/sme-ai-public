"""Assemble the agent runtime from settings: which model client, which executor, and whether runs
may start at all.

Fail closed: agents are OFF unless AGENTS_ENABLED is set; the scripted fake model is refused
outside development; an unknown provider is refused. When something needed to run is missing
the API still serves everything that only reads the database (runs, suggestions, reviews, the
tenant switch) and answers a start with 503 `agents_unavailable`."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass

from app.agent_runs.executor import RunSubmitter, RunTask, ThreadRunExecutor
from app.agent_runs.repository import AgentRunsRepository, PostgrestAgentRunsRepository
from app.agents.db import AgentDb
from app.agents.llm.fake import FakeProvider, selftest_script
from app.agents.llm.interface import LlmClient
from app.agents.registry import AGENTS
from app.agents.runtime import AgentRunner
from app.config import AuthConfig, ConfigurationError, Settings

logger = logging.getLogger("app.agent_runs.wiring")

PROVIDERS = frozenset({"fake"})


class AgentSettingsError(ConfigurationError):
    """The agent configuration is unsafe or unknown."""


@dataclass(frozen=True)
class AgentsRuntime:
    repository: AgentRunsRepository
    executor: RunSubmitter | None
    unavailable: str | None  # why a run cannot start (None = it can)


def llm_unavailable_reason(settings: Settings) -> str | None:
    """None when agents may run; otherwise a short code. Raises AgentSettingsError for an unsafe
    or unknown setting."""
    if not settings.agents_enabled:
        return "agents_disabled"
    provider = settings.llm_provider
    if provider not in PROVIDERS:
        raise AgentSettingsError(f"unknown LLM_PROVIDER {provider!r}")
    if provider == "fake" and not settings.is_development:
        raise AgentSettingsError("LLM_PROVIDER=fake is refused outside development")
    return None


def build_llm_factory(settings: Settings) -> Callable[[], LlmClient]:
    """A fresh client per run (the fake keeps a script)."""
    reason = llm_unavailable_reason(settings)
    if reason is not None:
        raise AgentSettingsError(reason)
    return lambda: FakeProvider(selftest_script())


def build_agents_runtime(settings: Settings, config: AuthConfig) -> AgentsRuntime:
    repository = PostgrestAgentRunsRepository(config.rest_url, config.anon_key)
    reason = llm_unavailable_reason(settings)
    if reason is not None:
        return AgentsRuntime(repository=repository, executor=None, unavailable=reason)
    factory = build_llm_factory(settings)

    def execute(task: RunTask) -> None:
        spec = AGENTS["selftest"]
        db = AgentDb(
            config.rest_url,
            config.anon_key,
            task.token,
            task.run_id,
            claim_predicate=spec.claim_predicate,
        )
        try:
            AgentRunner(db=db, llm=factory(), spec=spec).run()
        finally:
            db.close()

    executor = ThreadRunExecutor(
        execute, max_workers=settings.agents_max_workers, max_queue=settings.agents_max_queue
    )
    return AgentsRuntime(repository=repository, executor=executor, unavailable=None)
