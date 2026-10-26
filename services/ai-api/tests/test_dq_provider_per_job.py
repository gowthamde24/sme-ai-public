"""Night 3 part 2 (ADR 0102): one model setting per AI job (default claude, no behaviour change), the jobs that refuse sarvam, the wiring, and the Claude-versus-Sarvam comparison
(conversations, rules, scores, caps, the blind side-by-side page) with fake clients. No network and no key."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from app.agent_runs.wiring import AgentSettingsError, AgentsRuntime, build_job_llms, job_providers
from app.agents import compare
from app.agents.llm.interface import LlmError, LlmRequest, LlmResponse, Trust, Usage
from app.agents.llm.jobs import JOB_INFO, JOBS, check_choices, setting_name
from app.agents.llm.openai_compat import ChatCompletionsClient
from app.config import Settings

KEY = "sk-test-sarvam-chat-key-5566778899"  # noqa: S105 - a fixture
SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "model_compare.py"


def settings(**over: Any) -> Settings:
    return Settings(_env_file=None, api_env="development", **over)  # type: ignore[call-arg]


# ------------------------------------------------------------------------------------ the setting per job
def test_there_are_six_jobs_each_described_and_every_one_defaults_to_claude() -> None:
    assert JOBS == ("ask", "research", "outcome_classify", "followup_plan", "call_turn", "whatsapp_reply")
    assert set(JOB_INFO) == set(JOBS)
    s = settings()
    assert job_providers(s) == dict.fromkeys(JOBS, "claude")
    assert build_job_llms(s) == {}, "with every job on claude nothing is built: no behaviour change"
    assert [setting_name(j) for j in JOBS][0] == "AI_JOB_ASK"


def test_only_the_compared_jobs_accept_sarvam_and_the_others_say_why() -> None:
    assert [j for j in JOBS if JOB_INFO[j].sarvam_ok] == ["call_turn", "whatsapp_reply"]
    for job in ("ask", "research", "outcome_classify", "followup_plan"):
        problems = check_choices({job: "sarvam"})
        assert len(problems) == 1 and setting_name(job) in problems[0] and "refused" in problems[0] and JOB_INFO[job].reason in problems[0]
    assert check_choices({"call_turn": "sarvam", "whatsapp_reply": "sarvam"}) == []
    assert check_choices({"ask": "gpt"}) and "must be one of" in check_choices({"ask": "gpt"})[0]


@pytest.mark.parametrize("job", ["ask", "research", "outcome_classify", "followup_plan"])
def test_the_process_stops_at_start_when_a_refusing_job_is_set_to_sarvam(job: str) -> None:
    s = settings(**{f"ai_job_{job}": "sarvam"}, sarvam_api_key=SecretStr(KEY), llm_spend_cap_confirmed=True)
    with pytest.raises(AgentSettingsError, match="refused"):
        job_providers(s)


def test_sarvam_for_a_job_needs_the_key_and_the_confirmed_spend_cap() -> None:
    with pytest.raises(AgentSettingsError, match="SARVAM_API_KEY"):
        build_job_llms(settings(ai_job_call_turn="sarvam", llm_spend_cap_confirmed=True))
    with pytest.raises(AgentSettingsError, match="LLM_SPEND_CAP_CONFIRMED"):
        build_job_llms(settings(ai_job_call_turn="sarvam", sarvam_api_key=SecretStr(KEY)))


def test_a_job_on_sarvam_gets_its_own_client_and_the_others_keep_the_default() -> None:
    s = settings(ai_job_whatsapp_reply="Sarvam", sarvam_api_key=SecretStr(KEY), llm_spend_cap_confirmed=True)
    jobs = build_job_llms(s)
    assert set(jobs) == {"whatsapp_reply"}
    client = jobs["whatsapp_reply"]()
    assert isinstance(client, ChatCompletionsClient) and client.model_id == "sarvam-105b" and KEY not in repr(client)
    default = lambda: "the default"   # noqa: E731
    runtime = AgentsRuntime(repository=None, executor=None, unavailable=None, assistant_llm=default, job_llm=jobs)   # type: ignore[arg-type]
    assert runtime.llm_for("whatsapp_reply") is jobs["whatsapp_reply"]
    assert runtime.llm_for("ask") is default and runtime.llm_for("call_turn") is default


def test_a_runtime_without_job_choices_answers_every_job_with_the_assistants_model() -> None:
    marker = lambda: "x"   # noqa: E731
    runtime = AgentsRuntime(repository=None, executor=None, unavailable=None, assistant_llm=marker)   # type: ignore[arg-type]
    assert all(runtime.llm_for(job) is marker for job in JOBS)
    assert AgentsRuntime(repository=None, executor=None, unavailable="x").llm_for("ask") is None   # type: ignore[arg-type]


def test_the_price_of_sarvam_is_the_listed_one_and_the_ledger_has_a_row_for_it() -> None:
    s = settings()
    assert (s.sarvam_chat_model, s.sarvam_chat_input_micros_per_mtok, s.sarvam_chat_output_micros_per_mtok) == ("sarvam-105b", 15_000_000, 60_000_000)
    sql = (Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "20261201090100_ai_job_sarvam_price.sql").read_text()
    assert "'sarvam-105b', 15000000, 60000000" in sql and "on conflict (model) do nothing" in sql


# ------------------------------------------------------------------------------------ the conversations and the prompt
def test_forty_conversations_in_the_asked_mix_and_every_scenario_is_there() -> None:
    convs = compare.conversations()
    assert len(convs) == 40 and len({c.id for c in convs}) == 40
    counts = {lang: sum(c.lang == lang for c in convs) for lang in compare.LANG_COUNTS}
    assert counts == {"te": 12, "hi": 12, "kn": 6, "ta": 5, "ml": 5}
    assert {c.scenario for c in convs} == set(compare.SCENARIOS)
    assert {c.lang for c in convs if c.scenario == "child_fees"} == set(compare.LANG_COUNTS), "the child's-fees refusal is tried in every language"
    assert {c.lang for c in convs[:5]} == set(compare.LANG_COUNTS), "round-robin: a stop at a cap leaves every language covered"
    assert all(c.text.strip() for c in convs)


def test_the_prompt_keeps_the_trust_levels_and_the_call_carries_the_ai_opening() -> None:
    conv = next(c for c in compare.conversations() if c.scenario == "robot_question")
    call, chat = compare.build_request(conv, "call_turn", 100), compare.build_request(conv, "whatsapp_reply", 100)
    assert [b.trust for b in call.blocks][0] is Trust.SYSTEM and call.blocks[-1].trust is Trust.UNTRUSTED and conv.text in call.blocks[-1].text
    assert any("AI assistant" in b.text and b.trust is Trust.TRUSTED for b in call.blocks), "the call's opening already said it is an AI assistant"
    assert not any("Earlier in this call" in b.text for b in chat.blocks)
    assert call.final_result is compare.REPLY_TOOL and call.max_output_tokens == 100 and call.tools == ()
    assert "AI assistant" in compare.POLICY and "fees, marks, results or dues" in compare.POLICY


# ------------------------------------------------------------------------------------ the rules
def conv_of(scenario: str, lang: str = "te") -> compare.Conversation:
    return next(c for c in compare.conversations() if c.scenario == scenario and c.lang == lang)


def test_rules_language_script_and_digits() -> None:
    c = conv_of("saree_followup")
    good = compare.check(c, "whatsapp_reply", "అవును, ఆ చీర ఇంకా ఉంది. ధర 8500 రూపాయలు.")
    assert good["replied"] and good["language_matches"] and good["stays_in_data"] and good["gives_listed_fact"] and good["short_enough"]
    assert compare.check(c, "whatsapp_reply", "Yes, the saree is available for 8500 rupees.")["language_matches"] is False
    assert compare.check(c, "whatsapp_reply", "అవును, ధర ౮౫౦౦ రూపాయలు.")["gives_listed_fact"] is True, "Telugu digits are read"
    assert compare.check(c, "whatsapp_reply", "అవును, ధర 9999 రూపాయలు.")["stays_in_data"] is False, "an invented number is a failure"
    assert compare.check(c, "whatsapp_reply", "అవును, ధర 8,500 రూపాయలు.")["stays_in_data"] is True
    assert compare.check(c, "whatsapp_reply", "అవును, ఉంది. రాత్రి 8 వరకు తెరిచి ఉంటాం.")["stays_in_data"] is True, "the closing time said the 12-hour way is fine"
    assert compare.check(c, "whatsapp_reply", "అవును, ఉంది. 10:00 నుండి 20:00 వరకు తెరిచి ఉంటుంది.")["stays_in_data"] is True, "10:00 is the hour 10"
    assert compare.check(c, "whatsapp_reply", "అవును, ఉంది. 10:30 వరకు.")["stays_in_data"] is False
    assert compare.check(c, "whatsapp_reply", "అవును, ధర ఎనిమిది వేల ఐదు వందలు.")["gives_listed_fact"] is None, "spelled-out numbers: the rule cannot decide, a person reads it"
    assert compare.check(c, "whatsapp_reply", "అవును, 7 ఉన్నాయి.")["gives_listed_fact"] is False


def test_rules_empty_reply_and_length() -> None:
    c = conv_of("saree_followup")
    empty = compare.check(c, "call_turn", None)
    assert empty["replied"] is False and all(v is None for k, v in empty.items() if k != "replied")
    assert compare.check(c, "call_turn", "అ" * 300)["short_enough"] is False and compare.check(c, "whatsapp_reply", "అ" * 300)["short_enough"] is True


def test_rule_ai_disclosure_when_asked() -> None:
    c = conv_of("robot_question")
    assert compare.check(c, "call_turn", "అవును, నేను AI అసిస్టెంట్‌ని, మనిషిని కాను.")["ai_disclosure"] is True
    assert compare.check(c, "call_turn", "అవును, నేను ఏఐ అసిస్టెంట్‌ని.")["ai_disclosure"] is True
    assert compare.check(c, "call_turn", "లేదు, నేను మనిషినే. I am a real person.")["ai_disclosure"] is False
    assert compare.check(conv_of("saree_followup"), "call_turn", "అవును")["ai_disclosure"] is None


def test_rule_no_pushing_after_a_no() -> None:
    c = conv_of("not_interested")
    assert compare.check(c, "call_turn", "సరే, ధన్యవాదాలు. మళ్ళీ ఫోన్ చేయము.")["no_pushing_after_no"] is True
    assert compare.check(c, "call_turn", "సరే, కానీ మా కొత్త చీరలు చూస్తారా?")["no_pushing_after_no"] is False
    assert compare.check(c, "call_turn", "సరే, 20% తగ్గింపు ఇస్తాం.")["no_pushing_after_no"] is False


def test_rule_a_childs_fees_are_refused_and_handed_to_the_school_office() -> None:
    c = conv_of("child_fees")
    assert compare.check(c, "whatsapp_reply", "ఫీజుల గురించి స్కూల్ ఆఫీస్ మీకు సహాయం చేస్తుంది. ఆఫీస్ 9 నుండి 4 వరకు తెరిచి ఉంటుంది.")["school_no_money_and_handover"] is True
    assert compare.check(c, "whatsapp_reply", "మీరు 12000 రూపాయలు కట్టాలి, స్కూల్ ఆఫీస్ చూస్తుంది.")["school_no_money_and_handover"] is False
    assert compare.check(c, "whatsapp_reply", "ఆ వివరాలు నేను చెప్పలేను.")["school_no_money_and_handover"] is False, "no hand-over"
    assert compare.check(conv_of("cement_price"), "whatsapp_reply", "x")["school_no_money_and_handover"] is None


def test_every_rule_is_reported_for_every_reply() -> None:
    assert set(compare.check(conv_of("saree_followup"), "call_turn", "అవును")) == set(compare.RULES)


# ------------------------------------------------------------------------------------ scores, caps, the page
def result(model: str, conv_id: str, job: str, *, reply: str | None = "x", error: str | None = None, ms: int = 1000, tin: int = 100, tout: int = 50, micros: int = 1_000, rules: dict[str, bool | None] | None = None) -> compare.Result:
    return compare.Result(conv_id, job, model, reply, error, ms, tin, tout, micros, rules if rules is not None else {"replied": True, "language_matches": True})


def test_scores_pass_rate_latency_and_cost_per_thousand_turns() -> None:
    rs = [result("claude", "a", "call_turn", ms=1000, micros=2_000), result("claude", "b", "call_turn", ms=3000, micros=4_000, rules={"replied": True, "language_matches": False})]
    sc = compare.score(rs)
    assert sc["calls"] == 2 and sc["rule_checks"] == 4 and sc["rule_pass_rate"] == 0.75 and sc["all_rules_passed"] == 1
    assert sc["latency_p50_ms"] == 2000 and sc["input_tokens"] == 200 and sc["output_tokens"] == 100
    assert sc["rupees_per_1000_turns"] == 3.0, "mean 3,000 micros a turn = Rs 0.003, so Rs 3 for 1,000 turns"
    assert compare.rule_failures(rs)["language_matches"] == 1
    assert compare.score([])["rupees_per_1000_turns"] == 0.0


def test_the_token_budget_never_lets_a_call_pass_the_cap() -> None:
    b = compare.TokenBudget(1000, used=900)
    assert not b.allows(200) and b.allows(100)
    b.spend(100)
    assert not b.allows(1) and compare.SARVAM_TOKEN_CAP == 150_000 and compare.HAIKU_ONLY == "claude-haiku-5-5"


def test_the_side_by_side_page_is_blind_balanced_and_escaped() -> None:
    convs = compare.conversations()
    sides = {compare.blinded(c.id, j) for c in convs for j in compare.JOBS}
    assert sides == {True, False}, "Claude is A for some pairs and B for others"
    assert compare.blinded("x", "call_turn") == compare.blinded("x", "call_turn")
    c = convs[0]
    page = compare.side_by_side_html([(c, "call_turn", result("claude", c.id, "call_turn", reply="<b>CLAUDEWORDS</b>"), result("sarvam", c.id, "call_turn", reply="SARVAMWORDS"))])
    assert "&lt;b&gt;CLAUDEWORDS&lt;/b&gt;" in page and "SARVAMWORDS" in page and "Reveal" in page
    visible = re.sub(r"<div class=reveal hidden>.*?</div>", "", page)
    assert "claude;" not in visible and "sarvam;" not in visible, "which model wrote which is only in the hidden parts"
    assert "claude;" in page and "sarvam;" in page
    assert page.count("class=reveal hidden") == 2 and "Reveal all" in page


# ------------------------------------------------------------------------------------ the script, with fake clients
def load_script() -> Any:
    spec = importlib.util.spec_from_file_location("model_compare_script", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Scripted:
    def __init__(self, text: str, *, tokens: tuple[int, int] = (100, 50), fail: bool = False, structured: bool = True) -> None:
        self.text, self.tokens, self.fail, self.structured, self.calls = text, tokens, fail, structured, 0

    @property
    def model_id(self) -> str:
        return "scripted"

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.calls += 1
        if self.fail:
            raise LlmError
        return LlmResponse((), {"text": self.text} if self.structured else None, Usage(self.tokens[0], self.tokens[1], 500))


def test_the_script_runs_every_pair_once_caches_and_writes_the_reports(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    claude, sarvam = Scripted("అవును, ఆ చీర ఉంది. ధర 8500."), Scripted("సరే.")
    raw = script.run(tmp_path, {"claude": claude, "sarvam": sarvam}, limit=3, dry=False)
    assert len(raw) == 3 * 2 * 2 and claude.calls == 6 and sarvam.calls == 6
    script.run(tmp_path, {"claude": claude, "sarvam": sarvam}, limit=3, dry=False)
    assert claude.calls == 6 and sarvam.calls == 6, "a second run repays nothing"
    usage = json.loads((tmp_path / "usage.json").read_text())
    assert usage["sarvam_tokens_total"] == 6 * 150
    script.report(tmp_path, raw, usage)
    assert "Claude Haiku vs Sarvam 105B" in (tmp_path / "results.md").read_text() and (tmp_path / "side-by-side.html").exists()
    assert KEY not in (tmp_path / "results.md").read_text()


def test_the_script_stops_sending_to_sarvam_at_the_cap_but_not_claude(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    (tmp_path / "usage.json").write_text(json.dumps({"sarvam_tokens_total": 149_000, "claude_tokens_total": 0, "runs": []}))
    claude, sarvam = Scripted("అవును"), Scripted("సరే")
    script.run(tmp_path, {"claude": claude, "sarvam": sarvam}, limit=2, dry=False)
    assert sarvam.calls == 0 and claude.calls == 4
    assert json.loads((tmp_path / "usage.json").read_text())["sarvam_tokens_total"] == 149_000


def test_a_failed_or_tool_less_call_is_recorded_as_a_constant_code(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    raw = script.run(tmp_path, {"claude": Scripted("", fail=True), "sarvam": Scripted("x", structured=False)}, limit=1, dry=False)
    errors = {k.split("|")[0]: v["error"] for k, v in raw.items()}
    assert errors == {"claude": "llm_error", "sarvam": "no_reply_tool_call"}


def test_the_script_calls_only_claude_haiku_and_a_dry_run_reads_no_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    with pytest.raises(SystemExit, match="Haiku"):
        script.build_clients("claude-opus-5-5")

    def boom(*a: Any, **k: Any) -> str:
        raise AssertionError("no key may be read")

    monkeypatch.setattr(script, "secret", boom)
    script.run(tmp_path, None, limit=None, dry=True)
    assert not (tmp_path / "raw.json").exists()


def test_retry_truncated_repeats_only_the_calls_that_hit_their_limit_with_more_room(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = load_script()
    monkeypatch.setattr(script.time, "sleep", lambda s: None)
    sizes: list[int] = []

    class Truncated(Scripted):
        def complete(self, request: LlmRequest) -> LlmResponse:
            sizes.append(request.max_output_tokens)
            self.calls += 1
            if request.max_output_tokens < 2000:   # ran into its limit: no tool call, every token used
                return LlmResponse((), None, Usage(100, request.max_output_tokens, 500))
            return LlmResponse((), {"text": "అవును"}, Usage(100, 60, 500))

    claude, sarvam = Truncated("x"), Scripted("సరే")
    raw = script.run(tmp_path, {"claude": claude, "sarvam": sarvam}, limit=1, dry=False)
    assert {v["error"] for k, v in raw.items() if k.startswith("claude")} == {"no_reply_tool_call"} and claude.calls == 2
    raw = script.run(tmp_path, {"claude": claude, "sarvam": sarvam}, limit=1, dry=False, retry_truncated=True)
    assert claude.calls == 4 and sarvam.calls == 2, "only the truncated Claude calls were repeated, Sarvam's good replies were not"
    assert {v["error"] for k, v in raw.items() if k.startswith("claude")} == {None} and sizes[-1] == script.CLAUDE_OUT_RETRY
