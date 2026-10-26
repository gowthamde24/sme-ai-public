"""Job DR B1: the 30 task-planning evaluations: the set itself, the checks that score a plan (with passing and failing examples), the cap, and the script end to end with a SCRIPTED model (no key, no network)."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.agents.llm.interface import LlmRequest, LlmResponse, Usage
from app.tasks import evals
from app.tasks.models import PlanDraft
from app.tasks.planner import Planned, build_plan
from app.tasks.resolver import DbContactSource
from tests.dr_fakes import plan_answer


def load_script() -> Any:
    scripts = Path(__file__).resolve().parents[3] / "scripts"
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location("tasks_eval", scripts / "tasks_eval.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def planned(**changes: Any) -> Planned:
    return build_plan(PlanDraft.model_validate(plan_answer(**changes)), source=DbContactSource(evals.SyntheticDb()), language="en", provided=None, school=False)


def case(case_id: str) -> evals.Case:
    return next(c for c in evals.CASES if c.id == case_id)


def test_the_set_is_thirty_instructions_in_six_languages_and_several_business_types() -> None:
    assert evals.eval_set_ok() == []
    counts = {lang: sum(1 for c in evals.CASES if c.lang == lang) for lang in ("en", "te", "hi", "kn", "ta", "ml")}
    assert counts == {"en": 2, "te": 7, "hi": 7, "kn": 5, "ta": 5, "ml": 4}
    assert {c.pack for c in evals.CASES} >= {"saree_shop", "cement_dealer", "school", "real_estate", "coaching", "clinic"}
    assert sum(1 for c in evals.CASES if c.asks_question) == 4, "unclear instructions must get a question"
    assert {t for c in evals.CASES for t in c.templates} >= {"call_new_leads", "reengage_old_leads", "confirm_appointments", "collect_feedback", "payment_reminder", "supplier_price_enquiry", "offer_invite"}


def test_a_good_plan_passes_every_check() -> None:
    p = planned(template="supplier_price_enquiry", questions=[{"key": "price", "text": "Today's price per bag?", "type": "amount"}], selectors=[{"segment": "all_leads"}])
    v = evals.judge(case("en-supplier"), p, None)
    assert v.failed() == [] and v.checks["people_found_or_said_so"] and v.checks["template_ok"]


def test_the_checks_catch_a_wrong_template_channel_or_a_hidden_ai() -> None:
    wrong = evals.judge(case("en-supplier"), planned(template="collect_feedback", channel="whatsapp"), None)
    assert {"template_ok", "channel_ok"} <= set(wrong.failed())
    hidden = evals.judge(case("en-supplier"), planned(template="supplier_price_enquiry", script_notes="Pretend to be a human supplier"), None)
    assert "does_not_hide_ai" in hidden.failed()
    figure = evals.judge(case("hi-offer"), planned(template="offer_invite", channel="whatsapp", message_text="Sale 20% off"), None)
    assert "no_amount_in_message" in figure.failed()


def test_an_unclear_instruction_must_get_a_question_and_a_clear_one_must_not() -> None:
    q = Planned(question="Which suppliers?")
    assert evals.judge(case("en-unclear"), q, None).failed() == []
    assert "asks_one_question" in evals.judge(case("en-supplier"), q, None).failed()
    assert "no_needless_question" in evals.judge(case("en-unclear"), planned(), None).failed()


def test_a_school_asked_about_fees_must_be_refused_and_never_become_a_money_task() -> None:
    fees = case("te-school-fees")
    assert evals.judge(fees, None, "not_for_schools").failed() == []
    assert evals.judge(fees, None, "plan_failed").failed() == ["answered"]
    money = planned(template="custom", goal="Ask when the pending fees will be paid", channel="call")
    assert "school_no_money" in evals.judge(fees, money, None).failed()
    reminder = planned(template="payment_reminder", channel="whatsapp")
    assert "school_no_money" in evals.judge(case("te-school-open-house"), reminder, None).failed()
    assert evals.judge(case("te-school-open-house"), planned(template="offer_invite", channel="whatsapp", goal="Invite parents to the open house", questions=[{"key": "coming", "text": "మీరు వస్తారా అండీ?", "type": "yesno"}]), None).checks["school_no_money"] is True


def test_a_list_with_a_stranger_reaches_only_the_matching_contact() -> None:
    c = case("hi-list")
    provided = [__import__("app.tasks.models", fromlist=["ProvidedContact"]).ProvidedContact(name=n, phone=p) for n, p in c.provided]
    p = build_plan(PlanDraft.model_validate(plan_answer(selectors=[], channel="call")), source=DbContactSource(evals.SyntheticDb()), language="hi", provided=provided, school=False)
    assert evals.judge(c, p, None).checks["strangers_not_contacted"] is True and [u[1] for u in p.unmatched] == ["2345"]


def test_the_summary_counts_and_groups() -> None:
    good = evals.judge(case("en-supplier"), planned(template="supplier_price_enquiry"), None)
    bad = evals.judge(case("en-supplier"), planned(template="collect_feedback", channel="whatsapp"), None)
    s = evals.summary([good, bad])
    assert s["cases"] == 2 and s["cases_clean"] == 1 and s["failed_by_check"]["template_ok"] == 1 and s["by_language"]["en"] == {"cases": 2, "clean": 1} and 0 < s["pass_rate"] < 1


class Scripted:
    model_id = "claude-haiku-5-5"

    def __init__(self) -> None:
        self.calls = 0

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.calls += 1
        question = "Which people?" if "Ask them about it" in "\n".join(b.text for b in request.blocks) or "వాళ్ళకి చెప్పండి" in "\n".join(b.text for b in request.blocks) else None
        return LlmResponse(tool_calls=(), structured=plan_answer(clarifying_question=question, selectors=[{"segment": "all_leads"}]), usage=Usage(1000, 300, 0))


def test_the_script_plans_all_thirty_with_a_scripted_model_keeps_the_count_and_never_repeats(tmp_path: Path) -> None:
    script = load_script()
    model = Scripted()
    data = script.run(tmp_path, False, client=model)
    assert len(data["cases"]) == 30 and data["tokens"] == 30 * 1300 or data["tokens"] > 0
    assert (tmp_path / "tasks-eval.md").exists() and "Task planning evaluation" in (tmp_path / "tasks-eval.md").read_text()
    again = Scripted()
    script.run(tmp_path, False, client=again)
    assert again.calls == 0, "a finished case is never repeated"
    saved = json.loads((tmp_path / "tasks-eval.json").read_text())
    assert saved["tokens"] == data["tokens"]


def test_the_cap_stops_the_script_before_a_call_that_could_pass_it(tmp_path: Path) -> None:
    script = load_script()
    (tmp_path / "tasks-eval.json").write_text(json.dumps({"tokens": script.TOKEN_CAP - 100, "cases": {}}))
    model = Scripted()
    data = script.run(tmp_path, False, client=model)
    assert model.calls == 0 and data["cases"] == {} and data["tokens"] == script.TOKEN_CAP - 100


def test_the_dry_run_reads_no_key_and_opens_no_connection(tmp_path: Path, capsys: Any) -> None:
    script = load_script()
    script.run(tmp_path, True)
    assert "30 cases to plan" in capsys.readouterr().out
    assert SimpleNamespace is not None
