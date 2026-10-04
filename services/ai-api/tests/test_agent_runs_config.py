"""Fail-closed configuration of the agent runtime: off by default; the fake model is refused
outside development."""

from __future__ import annotations

import pytest

from app.agent_runs.wiring import AgentSettingsError, build_llm_factory, llm_unavailable_reason
from app.agents.llm.fake import FakeProvider
from app.config import Settings


def settings(**kw: object) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg, arg-type]


def test_agents_are_off_by_default() -> None:
    s = settings()
    assert s.agents_enabled is False and s.llm_provider == "fake"


def test_the_fake_provider_is_available_in_development() -> None:
    s = settings(api_env="development", agents_enabled=True, llm_provider="fake")
    factory = build_llm_factory(s)
    assert isinstance(factory(), FakeProvider) and factory() is not factory()
    assert llm_unavailable_reason(s) is None


@pytest.mark.parametrize("env", ["production", "prod", "staging", "", "Development", "test"])
def test_the_fake_provider_is_refused_outside_development(env: str) -> None:
    with pytest.raises(AgentSettingsError):
        build_llm_factory(settings(api_env=env, agents_enabled=True, llm_provider="fake"))


def test_a_disabled_runtime_needs_no_provider_at_all() -> None:
    for env in ("production", "development"):
        s = settings(api_env=env, agents_enabled=False, llm_provider="whatever")
        assert llm_unavailable_reason(s) == "agents_disabled"


def test_an_unknown_provider_is_refused() -> None:
    with pytest.raises(AgentSettingsError):
        build_llm_factory(settings(api_env="development", agents_enabled=True, llm_provider="x"))
