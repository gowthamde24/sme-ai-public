"""Assemble the agent runtime from settings: which model client, which executor, and whether runs
may start at all.

Fail closed: agents are OFF unless AGENTS_ENABLED is set; the scripted fake model is refused
outside development; an unknown provider is refused. When something needed to run is missing
the API still serves everything that only reads the database (runs, suggestions, reviews, the
tenant switch) and answers a start with 503 `agents_unavailable`."""

from __future__ import annotations

import dataclasses
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TypeVar

from app.agent_runs.executor import RunSubmitter, RunTask, ThreadRunExecutor
from app.agent_runs.repository import AgentRunsRepository, PostgrestAgentRunsRepository
from app.agents.db import AgentDb
from app.agents.llm.anthropic import AnthropicClient, AnthropicConfig
from app.agents.llm.fake import FakeProvider, research_script, selftest_script
from app.agents.llm.fake_requirement import requirement_script
from app.agents.llm.gemini import GeminiClient, GeminiConfig
from app.agents.llm.interface import LlmClient
from app.agents.llm.openai_compat import (
    ChatCompletionsClient,
    ChatCompletionsConfig,
    is_local_url,
    local_config,
    openai_config,
    sarvam_config,
)
from app.agents.llm.routing import ModelRouter
from app.agents.registry import AGENTS
from app.agents.runtime import AgentRunner
from app.assistant.db import AssistantDb
from app.assistant.dev_model import DevAssistantModel
from app.config import AuthConfig, ConfigurationError, Settings
from app.webfetch.fakes import FixturePageFetcher

logger = logging.getLogger("app.agent_runs.wiring")

_C = TypeVar("_C", AnthropicConfig, ChatCompletionsConfig, GeminiConfig)

PROVIDERS = frozenset({"fake", "anthropic", "openai", "gemini", "sarvam", "openai_compat"})


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
    # the Main agent (job AG): a model client per message (the scripted stand-in under the fake
    # provider, in development only) and the database door per message
    assistant_llm: Callable[[], LlmClient | ModelRouter] | None = None
    assistant_db: Callable[[str, uuid.UUID], AssistantDb] | None = None


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


def _light_config(settings: Settings, main: _C) -> _C | None:
    """The light model's configuration (the main model's provider, key and address), or None when
    no light model is set. A model without both prices is an unsafe setting: refused at start."""
    model = (settings.llm_light_model or "").strip()
    if not model:
        return None
    input_price, output_price = (
        settings.llm_light_input_micros_per_mtok,
        settings.llm_light_output_micros_per_mtok,
    )
    if input_price is None or output_price is None:
        raise AgentSettingsError(
            "LLM_LIGHT_MODEL needs LLM_LIGHT_INPUT_MICROS_PER_MTOK "
            "and LLM_LIGHT_OUTPUT_MICROS_PER_MTOK"
        )
    try:
        return dataclasses.replace(
            main,
            model=model,
            input_micros_per_mtok=input_price,
            output_micros_per_mtok=output_price,
        )
    except ValueError:
        raise AgentSettingsError("the light model configuration is invalid") from None


def _routed(
    config: ChatCompletionsConfig | GeminiConfig, light: ChatCompletionsConfig | GeminiConfig | None
) -> Callable[[], LlmClient | ModelRouter]:
    """A client factory for a chat-completions or Gemini configuration, with the light model
    beside it when one is set."""

    def build(c: ChatCompletionsConfig | GeminiConfig) -> LlmClient:
        return GeminiClient(c) if isinstance(c, GeminiConfig) else ChatCompletionsClient(c)

    def make() -> LlmClient | ModelRouter:
        main_client = build(config)
        return main_client if light is None else ModelRouter(main_client, build(light))

    return make


def _local_model(settings: Settings) -> Callable[[], LlmClient | ModelRouter] | str:
    """LLM_PROVIDER=openai_compat: a model served on THIS machine (Ollama and the like). No key, no
    spend-cap confirmation, prices default to 0. Any other address is refused: nothing here ever
    sends a request off this machine."""
    model = (settings.llm_model or "").strip()
    base_url = (settings.llm_base_url or "").strip()
    if not model or not base_url:
        return "llm_not_configured"
    if not is_local_url(base_url):
        raise AgentSettingsError("LLM_BASE_URL must be this machine (localhost or 127.0.0.1)")
    try:
        config = local_config(
            model,
            settings.llm_input_micros_per_mtok or 0,
            settings.llm_output_micros_per_mtok or 0,
            base_url,
        )
    except ValueError:
        raise AgentSettingsError("the local model configuration is invalid") from None
    return _routed(config, _light_config(settings, config))


def _other_provider(settings: Settings) -> Callable[[], LlmClient | ModelRouter] | str:
    """OpenAI, Gemini, Sarvam (job AK / K3) or a local OpenAI-compatible server: a client factory,
    or the code of what is missing.

    The provider's OWN key is the only thing that enables a hosted provider."""
    provider = settings.llm_provider
    if provider == "openai_compat":
        return _local_model(settings)
    secret = {
        "openai": settings.openai_api_key,
        "gemini": settings.gemini_api_key,
        "sarvam": settings.sarvam_api_key,
    }[provider]
    key = secret.get_secret_value().strip() if secret else ""
    model = (settings.llm_model or "").strip()
    input_price, output_price = (
        settings.llm_input_micros_per_mtok,
        settings.llm_output_micros_per_mtok,
    )
    if not model or not key or input_price is None or output_price is None:
        return "llm_not_configured"
    if not settings.llm_spend_cap_confirmed:
        return "llm_spend_cap_unconfirmed"
    try:
        if provider == "gemini":
            gemini = GeminiConfig(key, model, input_price, output_price)
            return _routed(gemini, _light_config(settings, gemini))
        chat: ChatCompletionsConfig = (
            openai_config(key, model, input_price, output_price)
            if provider == "openai"
            else sarvam_config(key, model, input_price, output_price)
        )
        return _routed(chat, _light_config(settings, chat))
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
    if provider != "anthropic":
        other = _other_provider(settings)
        return other if isinstance(other, str) else None
    outcome = _anthropic_config(settings)
    return outcome if isinstance(outcome, str) else None


def build_llm_factory(settings: Settings) -> Callable[[], LlmClient | ModelRouter]:
    """A fresh client per run (the fake keeps a script)."""
    reason = llm_unavailable_reason(settings)
    if reason is not None:
        raise AgentSettingsError(reason)
    if settings.llm_provider in ("openai", "gemini", "sarvam", "openai_compat"):
        other = _other_provider(settings)
        if isinstance(other, str):  # not reachable: llm_unavailable_reason returned None
            raise AgentSettingsError(other)
        return other
    if settings.llm_provider == "anthropic":
        outcome = _anthropic_config(settings)
        if isinstance(outcome, str):  # not reachable: llm_unavailable_reason returned None
            raise AgentSettingsError(outcome)
        config = outcome
        light = _light_config(settings, config)

        def make() -> LlmClient | ModelRouter:
            main_client = AnthropicClient(config)
            if light is None:
                return main_client
            return ModelRouter(main_client, AnthropicClient(light))

        return make
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
            elif spec.target_kind == "enquiry":
                # the scripted model under the fake provider (development only); else the adapter
                llm = (
                    FakeProvider(requirement_script())
                    if settings.llm_provider == "fake"
                    else factory()
                )
                AgentRunner(db=db, llm=llm, spec=spec).run()
            else:
                AgentRunner(db=db, llm=factory(), spec=spec).run()
        finally:
            db.close()

    executor = ThreadRunExecutor(
        execute, max_workers=settings.agents_max_workers, max_queue=settings.agents_max_queue
    )

    def assistant_db(token: str, run_id: uuid.UUID) -> AssistantDb:
        return AssistantDb(config.rest_url, config.anon_key, token, run_id)

    return AgentsRuntime(
        repository=repository,
        executor=executor,
        unavailable=None,
        research_available=fixtures is not None,
        assistant_llm=(lambda: DevAssistantModel()) if settings.llm_provider == "fake" else factory,
        assistant_db=assistant_db,
    )
