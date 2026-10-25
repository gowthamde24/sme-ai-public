"""Job DG: a run tells its progress as it goes; the stream's first byte need not wait for it.

The web route needs a first event before it can answer; the answer text follows its checks.
A step event carries a closed word and nothing else: no tool name, no argument, no record.
"""

from __future__ import annotations

from tests.test_bp_assistant import SEARCH, Seq, answer, calls, run


def test_the_first_event_of_a_run_is_a_step_and_comes_before_any_answer_text() -> None:
    model = Seq(calls(SEARCH), answer("Nothing found.", [], "refusal"))
    _, _, events, _ = run("search the web for saree trends", model, None)
    names = [name for name, _ in events]
    assert names[0] == "step"
    assert "text" in names and names.index("step") < names.index("text")


def test_a_step_event_is_a_closed_word_and_names_nothing() -> None:
    model = Seq(calls(SEARCH), answer("Nothing found.", [], "refusal"))
    _, _, events, _ = run("search the web for saree trends", model, None)
    steps = [data for name, data in events if name == "step"]
    assert steps
    assert all(set(d) == {"type", "step"} and d["step"] in {"working", "looking"} for d in steps)
