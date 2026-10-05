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
from pathlib import Path

from app.agent_runs.executor import RunSubmitter, RunTask, ThreadRunExecutor
from app.agent_runs.repository import AgentRunsRepository, PostgrestAgentRunsRepository
from app.agents.db import AgentDb
from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig
from app.agents.llm.fake import FakeProvider, research_script, selftest_script
from app.agents.llm.interface import LlmClient
from app.agents.registry import AGENTS
from app.agents.runtime import AgentRunner
from app.config import AuthConfig, ConfigurationError, Settings
from app.webfetch.fakes import FixturePageFetcher

logger = logging.getLogger("app.agent_runs.wiring")

PROVIDERS = frozenset({"fake", "anthropic"})


class AgentSettingsError(ConfigurationError):
    """The agent configuration is unsafe or unknown."""


@dataclass(frozen=True)
class AgentsRuntime:
    repository: AgentRunsRepository
    executor: RunSubmitter | None
    unavailable: str | None  # why a run cannot start (None = it can)
    # the Research Agent can start: development, the scripted model, and a fixture directory (no
    # real fetcher or real model for it exists yet)
    research_available: bool = False


def _anthropic_config(settings: Settings) -> AnthropicConfig | str:
    """The adapter's configuration, or the reason it is not available (a short code)."""
    model = (settings.llm_model or "").strip()
    key = (
        settings.anthropic_api_key.get_secret_value().strip() if settings.anthropic_api_key else ""
    )
    input_price, output_price = (
        settings.llm_input_micros_per_mtok,
        settings.llm_output_micros_per_mtok,
    )
    if not model or not key or input_price is None or output_price is None:
        return "llm_not_configured"
    if not settings.llm_spend_cap_confirmed:
        # the owner sets the provider's hard cap first (pre-pilot checklist)
        return "llm_spend_cap_unconfirmed"
    try:
        return AnthropicConfig(
            api_key=key,
            model=model,
            input_micros_per_mtok=input_price,
            output_micros_per_mtok=output_price,
            base_url=settings.anthropic_base_url,
        )
    except ValueError:
        raise AgentSettingsError("the model adapter configuration is invalid") from None


def llm_unavailable_reason(settings: Settings) -> str | None:
    """None when agents may run; otherwise a short code. Raises AgentSettingsError for an unsafe
    or unknown setting."""
    if not settings.agents_enabled:
        return "agents_disabled"
    provider = settings.llm_provider
    if provider not in PROVIDERS:
        raise AgentSettingsError(f"unknown LLM_PROVIDER {provider!r}")
    if provider == "fake":
        if not settings.is_development:
            raise AgentSettingsError("LLM_PROVIDER=fake is refused outside development")
        return None
    outcome = _anthropic_config(settings)
    return outcome if isinstance(outcome, str) else None


def build_llm_factory(settings: Settings) -> Callable[[], LlmClient]:
    """A fresh client per run (the fake keeps a script)."""
    reason = llm_unavailable_reason(settings)
    if reason is not None:
        raise AgentSettingsError(reason)
    if settings.llm_provider == "anthropic":
        outcome = _anthropic_config(settings)
        if isinstance(outcome, str):  # not reachable: llm_unavailable_reason returned None
            raise AgentSettingsError(outcome)
        config = outcome
        return lambda: AnthropicClient(config)
    return lambda: FakeProvider(selftest_script())


def research_fixture_root(settings: Settings) -> Path | None:
    """The synthetic fixture sites the research agent may read, or None when it is unavailable.
    Development with the scripted model only: nothing here can reach a network."""
    if (
        not settings.agents_enabled
        or settings.llm_provider != "fake"
        or not settings.is_development
        or not settings.research_fixture_dir
    ):
        return None
    root = Path(settings.research_fixture_dir)
    return root if root.is_dir() else None


def build_agents_runtime(settings: Settings, config: AuthConfig) -> AgentsRuntime:
    repository = PostgrestAgentRunsRepository(config.rest_url, config.anon_key)
    reason = llm_unavailable_reason(settings)
    if reason is not None:
        return AgentsRuntime(repository=repository, executor=None, unavailable=reason)
    factory = build_llm_factory(settings)
    fixtures = research_fixture_root(settings)

    def execute(task: RunTask) -> None:
        spec = AGENTS.get(task.agent)
        if spec is None:
            return  # an agent this process does not know: nothing runs (the run expires)
        db = AgentDb(
            config.rest_url,
            config.anon_key,
            task.token,
            task.run_id,
            claim_predicate=spec.claim_predicate,
        )
        try:
            if spec.uses_web:
                if fixtures is None:
                    return
                AgentRunner(
                    db=db,
                    llm=FakeProvider(research_script()),
                    spec=spec,
                    fetcher=FixturePageFetcher(fixtures),
                ).run()
            else:
                AgentRunner(db=db, llm=factory(), spec=spec).run()
        finally:
            db.close()

    executor = ThreadRunExecutor(
        execute, max_workers=settings.agents_max_workers, max_queue=settings.agents_max_queue
    )
    return AgentsRuntime(
        repository=repository,
        executor=executor,
        unavailable=None,
        research_available=fixtures is not None,
    )
