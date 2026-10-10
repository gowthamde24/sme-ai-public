"""A model served on THIS machine through an OpenAI-compatible endpoint (Ollama), job AK K3: no key, prices may be 0, never a request off this machine.

Tested only through httpx.MockTransport and the wiring: no test starts Ollama or touches the network."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.agent_runs.wiring import AgentSettingsError, build_llm_factory, llm_unavailable_reason
from app.agents.llm.interface import Block, LlmRequest, TaskClass, ToolSpec, Trust
from app.agents.llm.openai_compat import ChatCompletionsClient, is_local_url, local_config
from app.agents.llm.routing import ModelRouter
from app.config import Settings

BASE = "http://localhost:11434/v1"
MODEL = "llama3.2:3b"
FINAL = ToolSpec(
    "reply", "give the answer", {"type": "object", "properties": {"answer": {"type": "string"}}}
)


def request() -> LlmRequest:
    return LlmRequest(
        blocks=(Block(Trust.SYSTEM, "policy"), Block(Trust.UNTRUSTED, "data")),
        tools=(),
        max_output_tokens=300,
        task_class=TaskClass.HARD,
        final_result=FINAL,
    )


def reply() -> dict[str, Any]:
    call = {
        "id": "c",
        "type": "function",
        "function": {"name": "reply", "arguments": json.dumps({"answer": "x"})},
    }
    return {
        "choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [call]}}],
        "usage": {"prompt_tokens": 1234, "completion_tokens": 56},
    }


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:11434/v1",
        "http://127.0.0.1:11434",
        "http://[::1]:8080/v1",
        "https://localhost/v1",
        "http://LOCALHOST:11434",
    ],
)
def test_this_machine_is_local(url: str) -> None:
    assert is_local_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/v1",
        "http://localhost.evil.com/v1",
        "http://evil.com/?h=localhost",
        "http://user:pw@localhost:11434/v1",
        "http://192.168.1.5:11434/v1",
        "http://0.0.0.0:11434/v1",
        "ftp://localhost/v1",
        "localhost:11434/v1",
        "http://localhost:99999/v1",
        "",
    ],
)
def test_nothing_else_is_local(url: str) -> None:
    assert not is_local_url(url)


def test_the_request_goes_to_this_machine_without_a_key_and_the_price_may_be_zero() -> None:
    seen: list[httpx.Request] = []

    def server(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, json=reply())

    client = ChatCompletionsClient(
        local_config(MODEL, 0, 0, BASE), client=httpx.Client(transport=httpx.MockTransport(server))
    )
    out = client.complete(request())
    assert str(seen[0].url) == "http://localhost:11434/v1/chat/completions"
    assert not {"authorization", "api-subscription-key"} & set(seen[0].headers), (
        "no key header is sent"
    )
    body = json.loads(seen[0].content)
    assert (
        body["model"] == MODEL and body["max_tokens"] == 300 and "max_completion_tokens" not in body
    )
    assert out.structured == {"answer": "x"}
    assert (out.usage.input_tokens, out.usage.output_tokens, out.usage.cost_micros) == (
        1234,
        56,
        0,
    ), "a free model records a cost of 0"


@pytest.mark.parametrize(
    "base",
    [
        "http://localhost:11434",
        "http://localhost:11434/",
        "http://localhost:11434/v1",
        "http://localhost:11434/v1/",
    ],
)
def test_a_base_url_with_or_without_v1_reaches_the_same_path(base: str) -> None:
    urls: list[str] = []

    def server(r: httpx.Request) -> httpx.Response:
        urls.append(str(r.url))
        return httpx.Response(200, json=reply())

    ChatCompletionsClient(
        local_config(MODEL, 0, 0, base), client=httpx.Client(transport=httpx.MockTransport(server))
    ).complete(request())
    assert urls == ["http://localhost:11434/v1/chat/completions"]


def test_a_priced_local_model_still_counts_cost_by_the_same_formula() -> None:
    client = ChatCompletionsClient(
        local_config(MODEL, 1_000_000, 2_000_000, BASE),
        client=httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json=reply()))
        ),
    )
    assert (
        client.complete(request()).usage.cost_micros
        == (1234 * 1_000_000 + 56 * 2_000_000 + 999_999) // 1_000_000
    )


@pytest.mark.parametrize(
    "base", ["https://api.openai.com", "http://example.com/v1", "http://10.0.0.5:11434"]
)
def test_a_local_configuration_refuses_any_other_address(base: str) -> None:
    with pytest.raises(ValueError):
        local_config(MODEL, 0, 0, base)


def test_a_negative_price_is_refused_and_hosted_providers_still_need_positive_prices() -> None:
    with pytest.raises(ValueError):
        local_config(MODEL, -1, 0, BASE)
    from app.agents.llm.openai_compat import openai_config

    with pytest.raises(ValueError):
        openai_config("k", MODEL, 0, 0)
    with pytest.raises(ValueError):
        openai_config("", MODEL, 1, 1)


# ---- wiring
def settings(**kw: object) -> Settings:
    base: dict[str, object] = {
        "api_env": "production",
        "agents_enabled": True,
        "llm_provider": "openai_compat",
        "llm_model": MODEL,
        "llm_base_url": BASE,
    }
    return Settings(_env_file=None, **{**base, **kw})  # type: ignore[call-arg, arg-type]


def test_a_local_model_needs_no_key_no_prices_and_no_spend_cap_confirmation() -> None:
    s = settings()
    assert s.llm_spend_cap_confirmed is False and s.llm_input_micros_per_mtok is None
    assert llm_unavailable_reason(s) is None
    made = build_llm_factory(s)()
    assert isinstance(made, ChatCompletionsClient) and made.model_id == MODEL


@pytest.mark.parametrize("kw", [{"llm_model": None}, {"llm_base_url": None}, {"llm_model": " "}])
def test_without_a_model_and_an_address_it_is_not_configured(kw: dict[str, object]) -> None:
    assert llm_unavailable_reason(settings(**kw)) == "llm_not_configured"


@pytest.mark.parametrize(
    "base", ["https://api.openai.com/v1", "http://example.com/v1", "http://user@localhost/v1"]
)
def test_a_non_local_address_stops_the_process_at_start(base: str) -> None:
    with pytest.raises(AgentSettingsError):
        llm_unavailable_reason(settings(llm_base_url=base))


def test_a_light_model_rides_on_the_local_server_too() -> None:
    made = build_llm_factory(
        settings(
            llm_light_model="llama3.2:1b",
            llm_light_input_micros_per_mtok=0,
            llm_light_output_micros_per_mtok=0,
        )
    )()
    assert isinstance(made, ModelRouter) and made.light_model_id == "llama3.2:1b"


def test_the_hosted_providers_get_a_light_model_too() -> None:
    s = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="production",
        agents_enabled=True,
        llm_provider="openai",
        llm_model="big",
        openai_api_key="sk-x",  # type: ignore[arg-type]
        llm_input_micros_per_mtok=2_000_000,
        llm_output_micros_per_mtok=8_000_000,
        llm_spend_cap_confirmed=True,
        llm_light_model="small",
        llm_light_input_micros_per_mtok=100_000,
        llm_light_output_micros_per_mtok=400_000,
    )
    made = build_llm_factory(s)()
    assert isinstance(made, ModelRouter) and made.light_model_id == "small"
