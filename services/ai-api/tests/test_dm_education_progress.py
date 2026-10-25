"""Job DM (owner decision 25 Oct 2026): marks and progress messages to parents name the child, so they are FIXED TEMPLATES filled from the school's records and NEVER pass through a model. Tests: the templates,
the values, and the structural proof that nothing that can talk to a model touches them (and they touch nothing that can)."""

# ruff: noqa: E501

from __future__ import annotations

import ast
import json
import re
import socket
from pathlib import Path

import pytest

from app.education import progress as p

APP = Path(__file__).resolve().parents[1] / "app"
PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
GOOD = {"student": "Ravi", "subject": "Maths", "marks": 42, "out_of": 50, "term": "Term 1"}


# ------------------------------------------------------------------------------------------------ the templates
def test_every_kind_has_a_template_in_every_language_with_only_the_allowed_placeholders() -> None:
    assert set(p.TEMPLATES) == set(p.KINDS) == set(p.FIELDS)
    for kind, by_lang in p.TEMPLATES.items():
        assert set(by_lang) == set(p.LANGUAGES), kind
        for lang, text in by_lang.items():
            found = set(re.findall(r"\{([a-z_]+)\}", text))
            assert found == set(p.FIELDS[kind]) | {"school"}, (kind, lang, found)
            assert text.count("{") == len(found) and text.count("}") == len(found), "no stray braces"


def test_a_message_is_the_template_with_the_values_and_nothing_else() -> None:
    m = p.render("marks", "en", "Little Flower School", GOOD)
    assert m.text == "Ravi scored 42 out of 50 in Maths (Term 1). - Little Flower School"
    assert p.render("report_ready", "en", "Little Flower School", {"student": "Ravi", "term": "Term 1"}).text.startswith("Ravi's progress report for Term 1 is ready.")
    for lang in p.LANGUAGES:
        assert "Ravi" in p.render("marks", lang, "Little Flower School", GOOD).text and "42" in p.render("marks", lang, "Little Flower School", GOOD).text


def test_numbers_are_shown_plainly() -> None:
    assert "42.5 out of 50" in p.render("marks", "en", "S", {**GOOD, "marks": "42.50"}).text
    assert "50 out of 50" in p.render("marks", "en", "S", {**GOOD, "marks": 50}).text


@pytest.mark.parametrize(
    "bad",
    [
        {"student": ""}, {"student": "x" * 61}, {"student": "<b>Ravi</b>"}, {"student": "Ravi {school}"}, {"student": "Ravi\nKumar"}, {"student": "ravi@example.com"}, {"student": "https://x.example"}, {"student": "R" + chr(8238) + "i"},
        {"subject": ""}, {"subject": "M" * 41}, {"term": "T" * 31},
        {"marks": -1}, {"marks": 51}, {"marks": "forty"}, {"marks": True}, {"marks": None}, {"marks": "1000"}, {"out_of": 0}, {"out_of": "-5"},
    ],
)
def test_a_value_that_is_not_safe_makes_no_message(bad: dict[str, object]) -> None:
    with pytest.raises(p.ProgressMessageError):
        p.render("marks", "en", "Little Flower School", {**GOOD, **bad})


def test_the_fields_must_be_exactly_the_ones_the_template_takes() -> None:
    for fields in ({k: v for k, v in GOOD.items() if k != "term"}, {**GOOD, "extra": "x"}, {}):
        with pytest.raises(p.ProgressMessageError):
            p.render("marks", "en", "S", fields)
    with pytest.raises(p.ProgressMessageError):
        p.render("report_ready", "en", "S", GOOD)
    with pytest.raises(p.ProgressMessageError):
        p.render("gossip", "en", "S", GOOD)
    with pytest.raises(p.ProgressMessageError):
        p.render("marks", "fr", "S", GOOD)
    with pytest.raises(p.ProgressMessageError):
        p.render("marks", "en", "<script>", GOOD)


def test_a_value_with_braces_cannot_become_a_placeholder() -> None:
    # a name or a school with braces is refused outright; brackets inside a name are fine
    assert p.render("marks", "en", "Mini School (Hyderabad)", GOOD).text.endswith("- Mini School (Hyderabad)")
    with pytest.raises(p.ProgressMessageError):
        p.render("marks", "en", "{student}", GOOD)


def test_it_is_pure_the_same_values_give_the_same_words_and_it_never_touches_the_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def no_network(*a: object, **k: object) -> None:
        raise AssertionError("a progress message must not open a connection")

    monkeypatch.setattr(socket, "socket", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    assert p.render("marks", "te", "S", GOOD) == p.render("marks", "te", "S", GOOD)


# ------------------------------------------------------------------------------------------------ never through a model
def _imports(path: Path) -> set[str]:
    out: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            out |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


MODEL_SIDE = ("anthropic", "openai", "httpx", "requests", "urllib", "socket", "app.agents", "app.agent_runs", "app.assistant", "app.voice", "app.voice_notes", "app.llm", "app.followups.builder", "app.outbox")


def test_the_progress_module_imports_nothing_that_talks_to_a_model_a_voice_engine_or_the_network() -> None:
    imports = _imports(APP / "education" / "progress.py")
    bad = sorted(i for i in imports if any(i == m or i.startswith(m + ".") for m in MODEL_SIDE))
    assert bad == [], bad


def test_nothing_on_the_model_side_imports_the_progress_module() -> None:
    offenders = []
    for folder in ("agents", "agent_runs", "assistant", "voice", "voice_notes", "followups", "outbox", "whatsapp", "scheduler", "campaigns"):
        for path in (APP / folder).rglob("*.py"):
            if any(i.startswith("app.education.progress") or i == "app.education" for i in _imports(path)):
                offenders.append(str(path.relative_to(APP)))
    assert offenders == [], offenders


def test_the_assistant_has_no_tool_that_can_reach_marks_or_progress() -> None:
    from app.assistant.tools import TOOLS

    names = " ".join(t.name for t in TOOLS)
    assert len(TOOLS) > 10, "the tool names were found"
    for word in ("mark", "progress", "grade", "score", "report_card", "student", "exam", "result"):
        assert word not in names, f"an assistant tool name contains {word!r}"


def test_no_model_facing_text_is_built_from_the_progress_templates() -> None:
    for folder in ("agents", "agent_runs", "assistant"):
        for path in (APP / folder).rglob("*.py"):
            text = path.read_text(encoding="utf-8")
            assert "progress.render" not in text and "ProgressMessage" not in text, path.name


def test_marks_are_not_stored_and_no_campaign_kind_carries_them_yet() -> None:
    from app.campaigns.models import Kind

    kinds = set(Kind.__args__)  # type: ignore[attr-defined]
    assert not {k for k in kinds if re.search(r"mark|progress|grade|score", k)}, "a campaign kind for marks needs the owner's decision on storing children's data first"
    models = (APP / "education" / "models.py").read_text(encoding="utf-8")
    assert "Never stored" in models and "marks" in models.split("Never stored", 1)[1].split("\n\n")[0]
    pack = json.loads((PACKS / "education" / "pack.json").read_text())
    assert not re.search(r"\b(marks|grade|score|attendance)\b", json.dumps(pack.get("custom_fields", {})).lower()), "the pack's own fields hold no marks either"


def test_the_education_pack_has_no_lead_finding_and_no_research() -> None:
    pack = json.loads((PACKS / "education" / "pack.json").read_text())
    assert not {"lead_finder", "research", "companies", "catalogue", "quotes", "orders"} & set(pack["modules"])
    assert {"enquiries", "fees", "campaigns", "followups", "voice_notes", "programmes", "call_list"} <= set(pack["modules"]), "what a school does: admission enquiries, fee reminders, messages to parents"
