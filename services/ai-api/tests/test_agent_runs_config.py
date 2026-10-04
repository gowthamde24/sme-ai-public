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


# ---- the real adapter's gates (T006 M2 commit 3)
def anthropic_settings(**kw: object) -> Settings:
    base: dict[str, object] = {
        "api_env": "production",
        "agents_enabled": True,
        "llm_provider": "anthropic",
        "llm_model": "claude-test-model",
        "anthropic_api_key": "sk-ant-KEY-CANARY",
        "llm_input_micros_per_mtok": 3_000_000,
        "llm_output_micros_per_mtok": 15_000_000,
        "llm_spend_cap_confirmed": True,
    }
    return settings(**{**base, **kw})


def test_the_real_adapter_is_available_only_when_everything_is_configured() -> None:
    assert llm_unavailable_reason(anthropic_settings()) is None
    factory = build_llm_factory(anthropic_settings())
    from app.agents.llm.anthropic import AnthropicClient

    assert isinstance(factory(), AnthropicClient)


@pytest.mark.parametrize(
    ("missing", "reason"),
    [
        ({"anthropic_api_key": None}, "llm_not_configured"),
        ({"llm_model": None}, "llm_not_configured"),
        ({"llm_model": "  "}, "llm_not_configured"),
        ({"llm_input_micros_per_mtok": None}, "llm_not_configured"),
        ({"llm_output_micros_per_mtok": None}, "llm_not_configured"),
        ({"llm_spend_cap_confirmed": False}, "llm_spend_cap_unconfirmed"),
    ],
)
def test_a_missing_key_model_prices_or_spend_cap_makes_the_runtime_unavailable_not_broken(
    missing: dict[str, object], reason: str
) -> None:
    s = anthropic_settings(**missing)
    assert llm_unavailable_reason(s) == reason
    with pytest.raises(AgentSettingsError):
        build_llm_factory(s)


def test_there_is_no_default_model_and_the_key_comes_only_from_the_environment() -> None:
    s = settings()
    assert (
        s.llm_model is None and s.anthropic_api_key is None and s.llm_spend_cap_confirmed is False
    )
    assert "sk-ant-KEY-CANARY" not in repr(anthropic_settings())


def test_a_plain_http_gateway_is_refused() -> None:
    with pytest.raises(AgentSettingsError):
        build_llm_factory(anthropic_settings(anthropic_base_url="http://gateway.test"))
