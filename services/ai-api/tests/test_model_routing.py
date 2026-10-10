"""Which model answers a call (job AK K2b): the task class the agent declares, the mode the database reports, and the table between them.

The table is cost routing only: the database prices the call at the model it is told and enforces the caps, so these tests prove the SELECTION, and that
the light model is asked about only when one is configured. The real mode rules (80 / 100 / 300 %, both resets) are proved in pgTAP 75."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import pytest

from app.agent_runs.wiring import AgentSettingsError, build_llm_factory
from app.agents import inputs, runtime, selftest
from app.agents.llm.anthropic import AnthropicClient
from app.agents.llm.fake import FakeProvider, selftest_script
from app.agents.llm.interface import TaskClass
from app.agents.llm.routing import ROUTING_TABLE, Mode, ModelRouter, Role, as_router, mode_of
from app.agents.registry import AGENTS
from app.config import Settings
from tests.agent_fakes import FakeAgentDb


def provider(model: str) -> FakeProvider:
    p = FakeProvider(selftest_script())
    p.model_id = model
    return p


def test_the_table_has_a_row_for_every_class_and_mode_and_today_both_classes_share_a_model() -> (
    None
):
    assert set(ROUTING_TABLE) == {(c, m) for c in TaskClass for m in Mode}
    for task_class in TaskClass:
        assert ROUTING_TABLE[(task_class, Mode.NORMAL)] is Role.MAIN
        assert ROUTING_TABLE[(task_class, Mode.LIGHT)] is Role.LIGHT


@pytest.mark.parametrize("task_class", list(TaskClass))
def test_normal_mode_is_the_main_model_and_light_mode_the_light_one(task_class: TaskClass) -> None:
    main, light = provider("main-m"), provider("light-m")
    router = ModelRouter(main, light)
    assert router.client_for(task_class, Mode.NORMAL) is main
    assert router.client_for(task_class, Mode.LIGHT) is light


def test_without_a_light_model_the_main_model_serves_every_call_and_the_database_is_not_asked() -> (
    None
):
    main = provider("main-m")
    router = ModelRouter(main)
    asked: list[str] = []

    def ask(model: str) -> str:
        asked.append(model)
        return "light"

    chosen = router.choose(TaskClass.HARD, ask)
    assert chosen is main and asked == [] and router.light_model_id is None


def test_the_database_is_asked_about_the_light_model_by_name() -> None:
    router = ModelRouter(provider("main-m"), provider("light-m"))
    asked: list[str] = []

    def ask(model: str) -> str:
        asked.append(model)
        return "normal"

    router.choose(TaskClass.SIMPLE, ask)
    assert asked == ["light-m"]


@pytest.mark.parametrize("answer", [None, "", "normal", "LIGHT", "paused", "heavy"])
def test_anything_but_an_explicit_light_is_normal(answer: str | None) -> None:
    assert mode_of(answer) is Mode.NORMAL
    assert mode_of("light") is Mode.LIGHT


def test_a_bare_client_is_wrapped_and_a_router_is_kept() -> None:
    p = provider("m")
    assert as_router(p).client_for(TaskClass.HARD, Mode.LIGHT) is p
    router = ModelRouter(p)
    assert as_router(router) is router


def test_every_agent_declares_its_task_class() -> None:
    assert AGENTS and all(isinstance(spec.task_class, TaskClass) for spec in AGENTS.values())
    assert AGENTS["selftest"].task_class is TaskClass.SIMPLE


# ---- the runner: the light model is used, priced and reserved as itself, while the workspace is light
def make_db(**kw: Any) -> FakeAgentDb:
    db = FakeAgentDb(**kw)
    db.input_sha256 = inputs.input_sha256(inputs.model_input_from_company(db.facts))
    db.prices["light-m"] = (200_000, 1_000_000)
    return db


def run(db: FakeAgentDb, router: ModelRouter) -> runtime.RunOutcome:
    return runtime.AgentRunner(
        db=db, llm=router, spec=selftest.SELFTEST, now=db.clock, delimiter="feedc0de"
    ).run()


def test_a_light_workspace_is_served_by_the_light_model_and_reserved_at_its_price() -> None:
    db, main, light = make_db(), provider("fake-selftest"), provider("light-m")
    db.mode = "light"
    out = run(db, ModelRouter(main, light))
    assert out.status == "succeeded"
    assert main.requests == [] and len(light.requests) == 3
    assert {r[1] for r in db.reserve_requests} == {"light-m"}, (
        "the cost is reserved at the LIGHT model's price"
    )
    assert db.mode_requests == ["light-m"] * 3, "asked before every call"


def test_a_normal_workspace_keeps_the_main_model() -> None:
    db, main, light = make_db(), provider("fake-selftest"), provider("light-m")
    out = run(db, ModelRouter(main, light))
    assert out.status == "succeeded" and light.requests == [] and len(main.requests) == 3
    assert {r[1] for r in db.reserve_requests} == {"fake-selftest"}


def test_a_light_model_with_no_price_is_never_used_so_the_ai_does_not_stop_for_it() -> None:
    db, main, light = make_db(), provider("fake-selftest"), provider("light-unpriced")
    db.mode = "light"
    out = run(db, ModelRouter(main, light))
    assert out.status == "succeeded" and light.requests == [] and len(main.requests) == 3


def test_every_request_carries_the_class_its_agent_declared() -> None:
    db, main = make_db(), provider("fake-selftest")
    run(db, ModelRouter(main))
    assert {r.task_class for r in main.requests} == {selftest.SELFTEST.task_class}


# ---- configuration: the light model rides on the main model's provider and key
def anthropic_settings(**kw: object) -> Settings:
    base: dict[str, object] = {
        "api_env": "production",
        "agents_enabled": True,
        "llm_provider": "anthropic",
        "llm_model": "main-model",
        "anthropic_api_key": "sk-ant-KEY-CANARY",
        "llm_input_micros_per_mtok": 3_000_000,
        "llm_output_micros_per_mtok": 15_000_000,
        "llm_spend_cap_confirmed": True,
    }
    return Settings(_env_file=None, **{**base, **kw})  # type: ignore[call-arg, arg-type]


def test_no_light_model_set_means_a_plain_client() -> None:
    assert isinstance(build_llm_factory(anthropic_settings())(), AnthropicClient)


def test_a_light_model_makes_a_router_with_its_own_id() -> None:
    s = anthropic_settings(
        llm_light_model="light-model",
        llm_light_input_micros_per_mtok=800_000,
        llm_light_output_micros_per_mtok=4_000_000,
    )
    made = build_llm_factory(s)()
    assert isinstance(made, ModelRouter) and made.light_model_id == "light-model"


@pytest.mark.parametrize(
    "prices",
    [
        {},
        {"llm_light_input_micros_per_mtok": 1},
        {"llm_light_output_micros_per_mtok": 1},
        {"llm_light_input_micros_per_mtok": 0, "llm_light_output_micros_per_mtok": 1},
    ],
)
def test_a_light_model_without_both_positive_prices_stops_the_process_at_start(
    prices: dict[str, int],
) -> None:
    with pytest.raises(AgentSettingsError):
        build_llm_factory(anthropic_settings(llm_light_model="light-model", **prices))
