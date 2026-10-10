"""Job AN: hosted FREE-tier models (Groq, Cerebras, OpenRouter) behind the openai_compat adapter, and the two new refusals that are not spending limits.

Tested only through httpx.MockTransport, the wiring and fake database doors: no test reaches a network, and the "key" in these tests is a made-up string."""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.agent_runs.wiring import AgentSettingsError, build_llm_factory, llm_unavailable_reason
from app.agents import errors
from app.agents.db import AgentDb
from app.agents.llm.interface import (
    Block,
    LlmRateLimited,
    LlmRejected,
    LlmRequest,
    LlmUnavailable,
    TaskClass,
    ToolSpec,
    Trust,
)
from app.agents.llm.openai_compat import (
    HOSTED_FREE_URLS,
    ChatCompletionsClient,
    hosted_free_config,
    hosted_free_name,
    is_hosted_free_url,
    local_config,
)
from app.agents.llm.routing import ModelRouter
from app.agents.ports import RunView
from app.assistant import routes
from app.assistant.runner import AssistantRunner
from app.config import Settings

KEY = "gsk_made-up-key-for-tests-0123456789"
GROQ = "https://api.groq.com/openai/v1"
CEREBRAS = "https://api.cerebras.ai/v1"
OPENROUTER = "https://openrouter.ai/api/v1"
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


def client_for(config: Any, handler: Any) -> ChatCompletionsClient:
    return ChatCompletionsClient(
        config, client=httpx.Client(transport=httpx.MockTransport(handler))
    )


# ---- the allow-list
@pytest.mark.parametrize("url", [GROQ, CEREBRAS, OPENROUTER, GROQ + "/", " " + CEREBRAS + " "])
def test_the_three_hosted_free_addresses_are_allowed(url: str) -> None:
    assert is_hosted_free_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://api.openai.com/v1",
        "http://api.groq.com/openai/v1",  # not https
        "https://api.groq.com/openai",  # not the full address
        "https://api.groq.com/openai/v1/chat/completions",
        "https://api.groq.com.evil.com/openai/v1",
        "https://evil.com/https://api.groq.com/openai/v1",
        "https://user:pw@api.groq.com/openai/v1",
        "https://api.groq.com:8443/openai/v1",
        "https://API.GROQ.COM/openai/v1",  # exact match only
        "https://api.cerebras.ai/v1//",
        "https://openrouter.ai/api",
        "https://openrouter.ai/api/v1?x=1",
        "http://localhost:11434/v1",
        "",
    ],
)
def test_nothing_else_is_allowed(url: str) -> None:
    assert not is_hosted_free_url(url)


def test_the_allow_list_is_exactly_these_three() -> None:
    assert set(HOSTED_FREE_URLS) == {GROQ, CEREBRAS, OPENROUTER}
    assert hosted_free_name(GROQ) == "groq"


@pytest.mark.parametrize(
    "base", ["https://api.openai.com/v1", "http://api.groq.com/openai/v1", "https://evil.com"]
)
def test_a_hosted_free_configuration_refuses_any_other_address(base: str) -> None:
    with pytest.raises(ValueError):
        hosted_free_config(KEY, "llama-3.3-70b-versatile", base)


def test_a_hosted_free_model_needs_a_key() -> None:
    with pytest.raises(ValueError):
        hosted_free_config("", "llama-3.3-70b-versatile", GROQ)
    with pytest.raises(ValueError):
        hosted_free_config("   ", "llama-3.3-70b-versatile", GROQ)


def test_a_local_configuration_still_refuses_a_hosted_address() -> None:
    with pytest.raises(ValueError):
        local_config("m", 0, 0, GROQ)


@pytest.mark.parametrize("model", ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o", ""])
def test_openrouter_is_used_only_with_a_free_model_id(model: str) -> None:
    with pytest.raises(ValueError):
        hosted_free_config(KEY, model, OPENROUTER)


def test_openrouter_accepts_a_free_model_id() -> None:
    assert (
        hosted_free_config(KEY, "meta-llama/llama-3.3-70b-instruct:free", OPENROUTER).model
        == "meta-llama/llama-3.3-70b-instruct:free"
    )


# ---- the request
@pytest.mark.parametrize(
    ("base", "model", "url"),
    [
        (GROQ, "llama-3.3-70b-versatile", "https://api.groq.com/openai/v1/chat/completions"),
        (CEREBRAS, "llama-3.3-70b", "https://api.cerebras.ai/v1/chat/completions"),
        (
            OPENROUTER,
            "meta-llama/llama-3.3-70b-instruct:free",
            "https://openrouter.ai/api/v1/chat/completions",
        ),
    ],
)
def test_the_request_goes_to_the_service_with_the_key_and_costs_the_minimum(
    base: str, model: str, url: str
) -> None:
    seen: list[httpx.Request] = []

    def server(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, json=reply())

    out = client_for(hosted_free_config(KEY, model, base), server).complete(request())
    assert str(seen[0].url) == url
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(seen[0].content)
    assert body["model"] == model and body["max_tokens"] == 300
    assert "max_completion_tokens" not in body
    assert out.structured == {"answer": "x"}
    # 1 micro per million tokens: 1290 tokens round up to ONE micro per call, never zero
    assert (out.usage.input_tokens, out.usage.output_tokens, out.usage.cost_micros) == (
        1234,
        56,
        1,
    )


def test_a_redirect_is_not_followed_so_the_key_cannot_travel() -> None:
    seen: list[httpx.Request] = []

    def server(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(302, headers={"location": "https://evil.example/steal"})

    # the real default client (no redirect following) behind a mock transport
    client = ChatCompletionsClient(
        hosted_free_config(KEY, "m", GROQ),
        client=httpx.Client(transport=httpx.MockTransport(server)),
    )
    with pytest.raises(LlmRejected):
        client.complete(request())
    assert len(seen) == 1


def test_a_429_is_a_rate_limit_and_the_key_is_in_no_log_and_no_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = client_for(
        hosted_free_config(KEY, "m", GROQ),
        lambda r: httpx.Response(429, json={"error": {"message": f"slow down {KEY}"}}),
    )
    with caplog.at_level(logging.DEBUG), pytest.raises(LlmRateLimited) as info:
        client.complete(request())
    assert KEY not in repr(info.value) and KEY not in str(info.value)
    assert all(KEY not in r.getMessage() for r in caplog.records)
    assert "slow down" not in caplog.text
    assert KEY not in repr(client) and KEY not in repr(hosted_free_config(KEY, "m", GROQ))


def test_a_transport_failure_does_not_put_the_key_or_the_address_in_the_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def server(r: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {r.url} with {r.headers['authorization']}")

    client = client_for(hosted_free_config(KEY, "m", GROQ), server)
    with caplog.at_level(logging.DEBUG), pytest.raises(LlmUnavailable):
        client.complete(request())
    assert KEY not in caplog.text and "api.groq.com" not in caplog.text


# ---- the wiring
def settings(**kw: object) -> Settings:
    base: dict[str, object] = {
        "api_env": "development",
        "agents_enabled": True,
        "llm_provider": "openai_compat",
        "llm_model": "llama-3.3-70b-versatile",
        "llm_base_url": GROQ,
        "llm_api_key": KEY,
    }
    return Settings(_env_file=None, **{**base, **kw})  # type: ignore[call-arg, arg-type]


def test_a_hosted_free_model_needs_the_key_and_nothing_else() -> None:
    s = settings()
    assert s.llm_spend_cap_confirmed is False and s.llm_input_micros_per_mtok is None
    assert llm_unavailable_reason(s) is None
    made = build_llm_factory(s)()
    assert isinstance(made, ChatCompletionsClient) and made.model_id == "llama-3.3-70b-versatile"


@pytest.mark.parametrize("base", [GROQ, CEREBRAS])
def test_each_allowed_service_is_wired(base: str) -> None:
    assert llm_unavailable_reason(settings(llm_base_url=base)) is None


def test_openrouter_is_wired_with_a_free_model_and_refused_with_a_paid_one() -> None:
    assert (
        llm_unavailable_reason(
            settings(llm_base_url=OPENROUTER, llm_model="meta-llama/llama-3.3-70b-instruct:free")
        )
        is None
    )
    with pytest.raises(AgentSettingsError):
        llm_unavailable_reason(settings(llm_base_url=OPENROUTER, llm_model="openai/gpt-4o"))


@pytest.mark.parametrize("key", [None, "", "   "])
def test_without_the_key_it_is_not_configured(key: str | None) -> None:
    assert llm_unavailable_reason(settings(llm_api_key=key)) == "llm_not_configured"


@pytest.mark.parametrize("env", ["production", "prod", "staging", ""])
def test_a_hosted_free_model_is_refused_outside_development(env: str) -> None:
    with pytest.raises(AgentSettingsError):
        llm_unavailable_reason(settings(api_env=env))


@pytest.mark.parametrize(
    "base",
    [
        "https://api.openai.com/v1",
        "https://api.groq.com/openai/v1/chat/completions",
        "http://api.groq.com/openai/v1",
        "https://example.com/v1",
    ],
)
def test_any_other_remote_address_stops_the_process_at_start(base: str) -> None:
    with pytest.raises(AgentSettingsError) as info:
        llm_unavailable_reason(settings(llm_base_url=base))
    assert KEY not in str(info.value)


def test_the_key_is_never_in_a_setting_repr() -> None:
    assert KEY not in repr(settings()) and KEY not in str(settings())


def test_a_light_model_rides_on_the_same_service_at_the_same_minimum_price() -> None:
    made = build_llm_factory(settings(llm_light_model="llama-3.1-8b-instant"))()
    assert isinstance(made, ModelRouter) and made.light_model_id == "llama-3.1-8b-instant"


# ---- a model with no price row is NOT a spending limit
RUN = uuid.UUID("11111111-1111-4111-8111-111111111111")


def agent_db(answer: dict[str, Any]) -> AgentDb:
    http = httpx.Client(
        base_url="http://rest.test/rest/v1",
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=answer)),
    )
    return AgentDb("http://rest.test/rest/v1", "anon", "token", RUN, client=http)


def reserve(answer: dict[str, Any]) -> None:
    agent_db(answer).reserve_cost("usage-1", model="m", max_input_tokens=1, max_output_tokens=1)


def test_no_price_is_model_not_configured_and_still_a_refusal_that_spends_nothing() -> None:
    with pytest.raises(errors.ModelNotConfigured) as info:
        reserve({"granted": False, "reason": "no_price"})
    assert info.value.code == "model_not_configured"
    assert isinstance(
        info.value, errors.CostCapReached
    )  # every handler of the old refusal still stops the run


@pytest.mark.parametrize(
    "answer",
    [{"granted": False, "reason": "daily_cap"}, {"granted": False}, {"granted": "true"}, {}],
)
def test_every_other_refusal_stays_a_cost_cap_refusal(answer: dict[str, Any]) -> None:
    with pytest.raises(errors.CostCapReached) as info:
        reserve(answer)
    assert not isinstance(info.value, errors.ModelNotConfigured)
    assert info.value.code == "cost_cap_reached"


class FakeDb:
    """Just enough of the assistant's door for a run that stops at its first model call."""

    def __init__(self, reserve_error: Exception | None = None) -> None:
        self.reserve_error = reserve_error
        self.finished: list[tuple[str, str | None]] = []
        self.released: list[str] = []

    def read_run(self) -> RunView:
        return RunView(
            id=RUN,
            agent_name="assistant",
            status="running",
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
            cancel_requested_at=None,
            input_sha256="a" * 64,
            company_id=None,
            lead_id=None,
        )

    def ai_mode(self, light_model: str) -> str:
        return "normal"

    def reserve_cost(self, step_key: str, **_: Any) -> None:
        if self.reserve_error is not None:
            raise self.reserve_error

    def release_cost(self, step_key: str, *, reason: str) -> None:
        self.released.append(reason)

    def finish(self, status: str, error_code: str | None) -> None:
        self.finished.append((status, error_code))


class RaisingModel:
    model_id = "m"

    def __init__(self, error: Exception) -> None:
        self.error = error

    def complete(self, request: LlmRequest) -> Any:
        raise self.error


def run_it(db: FakeDb, llm: Any) -> Any:
    ctx = SimpleNamespace(run_id=RUN, state=SimpleNamespace(drafts=[]))
    runner = AssistantRunner(db=db, llm=llm, ctx=ctx)  # type: ignore[arg-type]
    return runner.run(
        question="what needs me today",
        language="en",
        history=[],
        emit=lambda *_: None,
        message_id=uuid.uuid4(),
    )


def test_a_missing_price_ends_the_run_as_model_not_configured_not_as_a_budget() -> None:
    db = FakeDb(errors.ModelNotConfigured())
    out = run_it(db, RaisingModel(RuntimeError("never reached")))
    assert (out.status, out.error_code, out.shown) == (
        "failed",
        "model_failed",
        "model_not_configured",
    )
    assert db.finished == [("failed", "model_failed")], "the database's own list has no new code"


def test_a_real_cap_still_ends_the_run_as_a_budget() -> None:
    db = FakeDb(errors.CostCapReached())
    out = run_it(db, RaisingModel(RuntimeError("never reached")))
    assert (out.status, out.error_code, out.shown) == ("failed", "budget", None)


def test_a_429_from_the_service_ends_the_run_as_busy_and_the_reservation_is_released() -> None:
    db = FakeDb()
    out = run_it(db, RaisingModel(LlmRateLimited()))
    assert (out.status, out.error_code, out.shown) == ("failed", "model_failed", "model_busy")
    assert db.released == ["rate_limited"], "a refused call was never billed"


def test_any_other_model_failure_is_not_called_busy() -> None:
    out = run_it(FakeDb(), RaisingModel(LlmRejected()))
    assert (out.error_code, out.shown) == ("model_failed", None)


def test_the_client_is_told_a_distinct_code_with_plain_words_for_each() -> None:
    assert routes.FAILURES["model_busy"] == (
        "model_busy",
        "The AI service is busy, try again in a minute.",
    )
    code, message = routes.FAILURES["model_not_configured"]
    assert code == "model_not_configured" and "spending" not in message.lower()
    assert "limit" not in message.lower() and "allowance" not in message.lower()
    # and none of the three share a code, so the screen can tell them apart
    assert (
        len({routes.FAILURES[k][0] for k in ("budget", "model_busy", "model_not_configured")}) == 3
    )


def test_a_missing_price_before_the_run_starts_is_a_503_not_the_spending_pause() -> None:
    refusal = routes._refusal(errors.ModelNotConfigured())
    assert (refusal.status_code, refusal.code) == (503, "model_not_configured")
