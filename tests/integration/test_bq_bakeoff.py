"""Job BQ (ADR 0079): the shop tasks of the model bake-off, their scoring (tool correctness, rule-following), the two new providers (Groq's free tier, the scripted stand-in), the one spending limit for the
whole command (Rs 100 unless CONFIRM_SPEND=1), the report outside the repository and the sheet for a native reader. Everything is pure except the last test, which reads the recorded steps of a real
answer from the local stack. No key, no network, no cost."""

# ruff: noqa: E501, S608

from __future__ import annotations

import csv
import io
import re
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import assistant_smoke as smoke
import bakeoff_shop as shop
import model_bakeoff as bake
import pytest
from assistant_support import assistant_app, enable_assistant, restore
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from test_today_api import Scene

from app.assistant.language import detect_language

ZERO = dict.fromkeys(smoke.INJECTION_KEYS, 0)
TASKS = {t.id: t for t in shop.SHOP_TASKS}
CASES = {c.id: c for c in bake.build_shop_cases()}


# ------------------------------------------------------------------------------------------------ the tasks
def test_there_are_nine_kinds_in_four_languages() -> None:
    assert len(shop.SHOP_TASKS) == 36
    assert {(t.kind, t.lang) for t in shop.SHOP_TASKS} == {(k, lang) for k in shop.KINDS for lang in shop.LANGS}
    assert len({t.id for t in shop.SHOP_TASKS}) == 36 and len({t.text for t in shop.SHOP_TASKS}) == 36


@pytest.mark.parametrize("task", shop.SHOP_TASKS, ids=lambda t: t.id)
def test_each_question_is_written_in_its_own_language(task: shop.ShopTask) -> None:
    assert detect_language(task.text) == task.lang, task.text
    assert not re.search(r"₹|\bRs\.?\s*\d|\binr\b", task.text, re.IGNORECASE), "a question holds no rupee amount the assistant could repeat"


def test_any_prefix_covers_every_kind_and_every_language_early() -> None:
    first9 = shop.SHOP_TASKS[:9]
    assert {t.kind for t in first9} == set(shop.KINDS)
    assert {t.lang for t in shop.SHOP_TASKS[:4]} == set(shop.LANGS) or len({t.lang for t in shop.SHOP_TASKS[:9]}) >= 3
    assert {t.lang for t in shop.SHOP_TASKS[:18]} == set(shop.LANGS)


def test_the_expectations_follow_the_nine_intents() -> None:
    assert TASKS["shop-en-today"].expect == (("get_today",),)
    assert TASKS["shop-te-enquiry"].expect == (("find_customers",), ("record_enquiry",))
    assert TASKS["shop-hi-visit"].expect[-1] == ("propose_visit",)
    assert "send_catalogue_items" in TASKS["shop-kn-catalogue"].forbid
    for lang in shop.LANGS:
        for kind in ("money", "complaint"):
            t = TASKS[f"shop-{lang}-{kind}"]
            assert t.waits and "draft_reply" not in t.forbid and "draft_quote" in t.forbid and "send_catalogue_items" in t.forbid
        refusal = TASKS[f"shop-{lang}-refusal"]
        assert refusal.forbid == shop.ACTION_TOOLS


def test_the_action_tools_are_the_applications_own() -> None:
    from app.assistant.tools import ACTION_TOOLS

    assert shop.ACTION_TOOLS == {t.name for t in ACTION_TOOLS}


def test_every_expected_tool_exists_in_the_application() -> None:
    from app.assistant.tools import TOOLS

    names = {t.name for t in TOOLS}
    for task in shop.SHOP_TASKS:
        assert {n for group in task.expect for n in group} <= names and task.forbid <= names


# ------------------------------------------------------------------------------------------------ scoring tools
def test_a_tool_counts_only_when_its_step_ended_ok() -> None:
    steps = [("find_customers", "ok"), ("record_enquiry", "refused")]
    assert shop.used(steps) == {"find_customers"}
    ok, detail = shop.right_tools(TASKS["shop-en-enquiry"], steps)
    assert not ok and "record_enquiry" in detail
    assert shop.right_tools(TASKS["shop-en-enquiry"], [("find_customers", "ok"), ("record_enquiry", "ok")])[0]
    assert shop.right_tools(TASKS["shop-en-today"], [])[0] is False
    assert shop.right_tools(TASKS["shop-en-money"], [])[0] is True, "a matter that waits asks for no tool"


def test_a_forbidden_tool_that_ran_fails_and_a_turned_away_call_is_noted() -> None:
    assert shop.no_forbidden(TASKS["shop-en-money"], [("draft_reply", "ok")])[0] is True, "a draft reply may be written while money waits"
    assert shop.no_forbidden(TASKS["shop-en-money"], [("draft_quote", "ok")])[0] is False
    assert shop.no_forbidden(TASKS["shop-en-refusal"], [("draft_reply", "ok")])[0] is False
    ok, detail = shop.no_forbidden(TASKS["shop-en-refusal"], [("refused_call", "refused")])
    assert ok and "turned away" in detail
    assert shop.no_forbidden(TASKS["shop-en-catalogue"], [("find_catalogue_items", "ok"), ("send_catalogue_items", "ok")])[0] is False


def scored(case_id: str, text: str, steps: list[tuple[str, str]] | None, after: dict[str, int] | None = None, sources: int = 0) -> tuple[bool, dict[str, bool]]:
    case = CASES[case_id]
    events: list[tuple[str, dict[str, Any]]] = [("text", {"type": "text", "delta": text})]
    events += [("source", {"type": "source", "kind": "quote", "id": str(uuid.uuid4()), "label": "q", "target": None}) for _ in range(sources)]
    events.append(("done", {"type": "done", "kind": "answer", "language": case.expect_reply}))
    passed, _, checks = bake.score(case, 200, events, ZERO, {**ZERO, **(after or {})}, {0}, [], "", steps)
    return passed, {c.name: c.ok for c in checks}


ANSWER = {"en": "Here is what I found for you.", "te": "మీ కోసం నేను కనుగొన్నది ఇదే.", "hi": "आपके लिए मैंने यह पाया है।", "kn": "ನಿಮಗಾಗಿ ನಾನು ಕಂಡುಕೊಂಡದ್ದು ಇದು."}


@pytest.mark.parametrize("lang", shop.LANGS)
def test_a_task_done_right_passes_in_every_language(lang: str) -> None:
    ok, checks = scored(f"shop-{lang}-visit", ANSWER[lang], [("find_customers", "ok"), ("propose_visit", "ok")])
    assert ok and checks[bake.RIGHT_TOOLS] and checks[bake.NO_FORBIDDEN]
    ok, checks = scored(f"shop-{lang}-money", ANSWER[lang], [("draft_reply", "ok")])
    assert ok and checks[bake.NO_FORBIDDEN]


def test_the_wrong_tool_fails_the_task_and_a_missing_tool_fails_it_too() -> None:
    ok, checks = scored("shop-en-today", ANSWER["en"], [("list_quotes", "ok")])
    assert not ok and not checks[bake.RIGHT_TOOLS]
    ok, checks = scored("shop-en-today", ANSWER["en"], [])
    assert not ok and not checks[bake.RIGHT_TOOLS]


def test_agreeing_to_a_discount_or_a_refund_by_making_something_fails_the_rules() -> None:
    ok, checks = scored("shop-hi-money", ANSWER["hi"], [("find_customers", "ok"), ("draft_quote", "ok")], after={"all_quotes": 1})
    assert not ok and not checks[bake.NO_FORBIDDEN]
    ok, checks = scored("shop-kn-complaint", ANSWER["kn"], [("send_catalogue_items", "ok")])
    assert not ok and not checks[bake.NO_FORBIDDEN]
    ok, checks = scored("shop-te-refusal", ANSWER["te"], [("draft_followup", "ok")])
    assert not ok and not checks[bake.NO_FORBIDDEN]


def test_the_tool_checks_are_added_only_with_steps_so_the_classic_scoring_is_unchanged() -> None:
    case = CASES["shop-en-today"]
    events: list[tuple[str, dict[str, Any]]] = [("text", {"type": "text", "delta": "Fine."}), ("done", {"type": "done", "kind": "answer", "language": "en"})]
    _, _, checks = bake.score(case, 200, events, ZERO, ZERO, {0}, [])
    assert {c.name for c in checks}.isdisjoint({bake.RIGHT_TOOLS, bake.NO_FORBIDDEN})


def test_money_in_an_answer_that_the_business_does_not_hold_is_still_an_invented_price() -> None:
    ok, checks = scored("shop-en-money", "Yes, I agree: a 20% discount, so ₹4,25,000 in all.", [("draft_reply", "ok")])
    assert not ok and not checks["no price invented"]


# ------------------------------------------------------------------------------------------------ the verdicts and the columns
def result(case_id: str, ok: bool, steps_ok: bool | None = None, answered: bool = True, seconds: float = 1.0, paise: int = 0, lang_ok: bool | None = None) -> bake.CaseResult:
    case = CASES[case_id]
    checks = [smoke.Check("answered", answered), smoke.Check("nothing sent or approved", ok)]
    if steps_ok is not None:
        checks.append(smoke.Check(bake.RIGHT_TOOLS, steps_ok))
    return bake.CaseResult(case, passed=ok and (steps_ok is not False), telugu_ok=lang_ok, checks=checks, seconds=seconds, spent_paise=paise)


def test_tool_correctness_counts_only_the_tasks_that_need_a_tool() -> None:
    assert bake.tool_verdict(CASES["shop-en-money"], []) is None
    assert bake.tool_verdict(CASES["shop-en-today"], []) is False, "no tool check at all = the answer never came"
    assert bake.tool_verdict(CASES["shop-en-today"], [smoke.Check(bake.RIGHT_TOOLS, True)]) is True
    row = bake.ModelRow(
        bake.parse_models("groq:openai/gpt-oss-120b:0:0")[0],
        [result("shop-en-today", True, True), result("shop-te-price", True, False), result("shop-hi-visit", True, True), result("shop-kn-money", True)],
    )
    assert row.tool_correctness() == "67% (2/3)"


def test_rule_following_is_judged_only_on_answers_that_came() -> None:
    assert bake.rules_verdict([smoke.Check("answered", False)]) is None
    assert bake.rules_verdict([smoke.Check("answered", True), smoke.Check("nothing sent or approved", True), smoke.Check("right tools used", False)]) is True, "a wrong tool is not a broken rule"
    assert bake.rules_verdict([smoke.Check("answered", True), smoke.Check(bake.NO_FORBIDDEN, False)]) is False
    row = bake.ModelRow(
        bake.parse_models("fake:fake-selftest:0:0")[0],
        [result("shop-en-today", True), result("shop-te-money", False), result("shop-hi-refusal", True), result("shop-kn-today", True, answered=False)],
    )
    assert row.rule_following() == "67% (2/3)"


def test_rupees_per_question_and_the_pass_rate_by_language() -> None:
    row = bake.ModelRow(bake.parse_models("fake:fake-selftest:0:0")[0], [result("shop-en-today", True, paise=50), result("shop-te-today", False, paise=25), result("shop-te-price", True, paise=0)])
    assert row.inr_per_question() == "₹0.25"
    assert row.by_group() == {"en": "100% (1/1)", "te": "50% (1/2)"}
    assert bake.ModelRow(bake.parse_models("fake:fake-selftest:0:0")[0]).inr_per_question() == "n/a"


def test_the_table_has_the_new_columns_and_the_notes_for_the_fake_and_the_free_tier() -> None:
    fake = bake.ModelRow(bake.parse_models("fake:fake-selftest:0:0")[0], [result("shop-en-today", True, True)])
    groq = bake.ModelRow(bake.parse_models("groq:openai/gpt-oss-120b:0:0")[0], [result("shop-en-today", True, True)])
    text = bake.table([fake, groq], 36)
    header = text.splitlines()[0]
    assert "tool correctness" in header and "rule-following" in header and "₹ per question" in header
    assert "fake model: plumbing check" in text and "groq free tier" in text
    assert text.splitlines()[2].count("|") == header.count("|"), "every row has every column"


# ------------------------------------------------------------------------------------------------ providers and the gates
def test_groq_and_the_stand_in_are_providers_and_cost_nothing() -> None:
    groq, fake = bake.parse_models("groq:openai/gpt-oss-120b:0:0 fake:fake-selftest:0:0")
    assert groq.free and not groq.keyless and fake.free and fake.keyless
    assert groq.label == "groq:openai/gpt-oss-120b (groq free tier)" and "plumbing" in fake.label
    assert bake.PROVIDER_KEYS["groq"] == "GROQ_API_KEY"
    for bad in ("groq:a b:0:0", "groq:../x:0:0", "openai:openai/gpt:1:2"):
        with pytest.raises(ValueError):
            bake.parse_models(bad)


def test_gates_for_the_free_providers() -> None:
    fake = bake.parse_models("fake:fake-selftest:0:0")
    assert bake.gate_message({}, fake) is None, "the stand-in needs no key and no confirmation"
    groq = bake.parse_models("groq:openai/gpt-oss-120b:0:0")
    message = bake.gate_message({}, groq)
    assert message is not None and "GROQ_API_KEY" in message and "gsk_" not in message
    assert bake.gate_message({"GROQ_API_KEY": "gsk_test_not_real"}, groq) is None, "a free tier needs no spend-cap confirmation"
    paid = bake.parse_models("openai:m:1:2 groq:openai/gpt-oss-120b:0:0")
    assert bake.gate_message({"OPENAI_API_KEY": "k", "GROQ_API_KEY": "g"}, paid) is not None, "the paid one still needs it"


@pytest.mark.parametrize(
    ("env", "paise"),
    [({}, 10_000), ({"SPEND_CAP_RS": "40"}, 4_000), ({"CONFIRM_SPEND": "1"}, 50_000), ({"CONFIRM_SPEND": "1", "SPEND_CAP_RS": "250"}, 25_000), ({"CONFIRM_SPEND": "true", "SPEND_CAP_RS": "100"}, 10_000)],
)
def test_the_spending_limit_is_rs_100_unless_confirmed(env: dict[str, str], paise: int) -> None:
    cap, note = bake.spend_cap(env)
    assert cap == paise and "Rs" in note


@pytest.mark.parametrize("env", [{"SPEND_CAP_RS": "101"}, {"SPEND_CAP_RS": "0"}, {"SPEND_CAP_RS": "ten"}, {"CONFIRM_SPEND": "1", "SPEND_CAP_RS": "501"}, {"CONFIRM_SPEND": "no", "SPEND_CAP_RS": "300"}])
def test_a_bigger_or_odd_limit_is_refused_with_a_plain_sentence(env: dict[str, str]) -> None:
    with pytest.raises(ValueError):
        bake.spend_cap(env)


def test_the_day_cap_follows_the_commands_limit() -> None:
    assert bake.day_cap_for(10_000) == 100_000_000
    assert bake.day_cap_for(100) == smoke.SMOKE_DAILY_CAP_MICROS
    assert bake.day_cap_for(50_000) == bake.DB_WALL_MICROS


def test_the_command_refuses_a_bad_suite_or_limit_before_doing_anything(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setattr("shutil.which", lambda _: "/usr/bin/docker")
    good = {"MODELS": "fake:fake-selftest:0:0"}
    assert bake.main(env={**good, "SUITE": "everything"}) == 2
    assert "SUITE" in capsys.readouterr().err
    assert bake.main(env={**good, "SPEND_CAP_RS": "500"}) == 2
    assert "CONFIRM_SPEND" in capsys.readouterr().err
    assert bake.main(env={**good, "CONFIRM_SPEND": "1", "SPEND_CAP_RS": "900"}) == 2
    assert "wall" in capsys.readouterr().err


# ------------------------------------------------------------------------------------------------ suites
def test_the_suites() -> None:
    assert len(bake.build_bake_cases()) == 40, "the classic suite is unchanged"
    assert len(bake.build_suite("classic")) == 40 and len(bake.build_suite("shop")) == 36
    both = bake.build_suite("all")
    assert len(both) == 76 and len({c.id for c in both}) == 76
    assert [c.task is None for c in both[:6]] == [True, False, True, False, True, False], "alternating, so a LIMIT samples both"
    with pytest.raises(ValueError):
        bake.build_suite("none")


def test_a_shop_case_is_a_case_with_a_task_and_a_group_that_is_its_language() -> None:
    for c in bake.build_shop_cases():
        assert c.task is not None and c.group == c.task.lang and c.expect_reply == c.task.lang and c.category == f"shop_{c.task.kind}"
        assert not c.injection


# ------------------------------------------------------------------------------------------------ the report and the sheet
def test_the_report_lands_outside_the_repository_with_a_sheet_for_a_native_reader(tmp_path: Path) -> None:
    assert Path.home() / "Desktop" / "v2-overnight" / "model-bakeoff.md" == bake.REPORT_FILE
    assert bake.ROOT not in bake.REPORT_FILE.parents
    te = result("shop-te-today", True, True)
    te.text = ANSWER["te"]
    te.tools = [("get_today", "ok")]
    en = result("shop-en-today", True, True)
    en.text = "Three things wait for you."
    row = bake.ModelRow(bake.parse_models("fake:fake-selftest:0:0")[0], [te, en])
    path = tmp_path / "out" / "model-bakeoff.md"
    csv_path = bake.write_report([row], 36, path, "shop", "Spending limit for the whole command: Rs 100.")
    text = path.read_text(encoding="utf-8")
    assert csv_path == tmp_path / "out" / "model-bakeoff.native-review.csv" and csv_path.exists()
    assert "Spending limit for the whole command: Rs 100." in text and "## Pass rate by language" in text
    assert "tools: get_today:ok" in text and "## For a native reader" in text
    assert "fake-selftest / shop-te-today" in text and "fake-selftest / shop-en-today" not in text, "English answers are not in the native sheet"
    rows = list(csv.reader(io.StringIO(csv_path.read_text(encoding="utf-8"))))
    assert rows[0][:4] == ["id", "language", "question", "answer"] and len(rows) == 2 and rows[1][1] == "Telugu" and rows[1][4:] == ["", "", "", ""]


def test_the_sheet_cannot_be_broken_by_a_pipe_or_a_new_line() -> None:
    sheet = shop.native_review_rows([("x", "hi", "a | b\nc", "d | e\n\nf")])
    body = sheet.splitlines()[-1]
    assert body.count("|") - body.count("\\|") == 9 and "\n" not in body


# ------------------------------------------------------------------------------------------------ the recorded steps of a real answer (needs the local stack)
@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack)


@pytest.fixture(scope="module")
def scene(eval_world: World, client: TestClient) -> Iterator[Scene]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield Scene(eval_world, client)
    finally:
        restore(saved)


def test_the_steps_of_a_real_answer_are_read_back_from_the_database(app: TestClient, scene: Scene) -> None:
    status, events, _ = smoke.ask(app, str(scene.a.id), bearer(scene.a.users["owner"])["Authorization"].split()[1], smoke.Question("t", "What is waiting for me today?"))
    assert status == 200
    steps = bake.tool_steps(str(scene.a.id), events)
    assert steps and all(status in ("ok", "refused", "failed") for _, status in steps)
    assert ("get_today", "ok") in steps
    assert bake.tool_steps(str(scene.a.id), [("done", {"conversation_id": "not-an-id"})]) == []
    assert bake.tool_steps(str(scene.a.id), []) == []
    # another business's conversation shows nothing here
    assert bake.tool_steps(str(scene.b.id), events) == []


# ------------------------------------------------------------------------------------------------ the settings each provider is run with (the same code the command uses)
def test_every_provider_builds_the_runtime_the_command_would_use() -> None:
    from app.agents.llm.openai_compat import ChatCompletionsClient
    from app.config import Settings
    from app.main import build_runtime

    models = {
        "groq": "groq:openai/gpt-oss-120b:0:0",
        "fake": "fake:fake-selftest:0:0",
        "local": "openai_compat:llama3.2:3b:0:0",
        "openai": "openai:gpt-test:100:200",
        "gemini": "gemini:gemini-test:100:200",
        "sarvam": "sarvam:sarvam-test:100:200",
        "anthropic": "anthropic:claude-test:100:200",
    }
    for name, text in models.items():
        (spec,) = bake.parse_models(text)
        options = bake.model_options(spec, "" if spec.keyless else "k-test-not-real", "http://127.0.0.1:54421", "anon", {"LLM_BASE_URL": "http://localhost:11434/v1"})
        runtime = build_runtime(Settings(_env_file=None, **options))  # type: ignore[call-arg]
        assert runtime is not None and runtime.agents is not None and not runtime.agents.unavailable, name
        assert runtime.agents.assistant_llm is not None, name
        if name == "groq":
            client = runtime.agents.assistant_llm()
            assert isinstance(client, ChatCompletionsClient) and client.model_id == "openai/gpt-oss-120b"
            assert "k-test-not-real" not in repr(client)


def test_groq_is_called_at_its_own_address_with_the_key_in_the_bearer_header_only() -> None:
    import httpx

    from app.agents.llm.interface import Block, LlmRequest, TaskClass, Trust
    from app.agents.llm.openai_compat import ChatCompletionsClient, hosted_free_config

    seen: dict[str, Any] = {}

    def server(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"] = str(request.url), request.headers.get("authorization")
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}], "usage": {"prompt_tokens": 3, "completion_tokens": 2}})

    client = ChatCompletionsClient(hosted_free_config("gsk_test_not_real", "openai/gpt-oss-120b", bake.GROQ_URL), client=httpx.Client(transport=httpx.MockTransport(server)))
    request = LlmRequest(blocks=(Block(Trust.SYSTEM, "policy"), Block(Trust.UNTRUSTED, "data")), tools=(), max_output_tokens=50, task_class=TaskClass.HARD)
    try:
        client.complete(request)
    except Exception:  # noqa: S110 - the reply shape is not the point here: the address and the key are
        pass
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions" and seen["auth"] == "Bearer gsk_test_not_real"
    assert "gsk_test_not_real" not in seen["body"]
