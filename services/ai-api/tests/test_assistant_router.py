"""Job BB (ADR 0070): the deterministic tool router of Agent OWL. Which tools are described to the model for a question (the catalogue tools only for questions about photos, designs, colours,
fabrics, stock or showing sarees; the visit tool only for visits and appointments), that the same question always gives the same answer, that the follow-up of a chat carries over, that the system
prompt mentions the photos tool only when it is offered, and that the runner REFUSES a call to a tool that was not offered. No database, no network."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from app.agents.llm.interface import LlmRequest, LlmResponse, ToolCall, Usage
from app.assistant import prompts
from app.assistant.router import (
    CATALOGUE_TOOLS,
    CORE,
    VISIT_TOOLS,
    offered_tools,
    wants_catalogue,
    wants_visits,
)
from app.assistant.runner import AssistantRunner
from app.assistant.tools import TOOLS, State

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=UTC)

# the five questions of `make assistant-smoke` and the token test: none of them is about photos or visits
BASE_QUESTIONS = [
    "What needs me today?",
    "Who hasn't paid?",
    "Price 50 sarees, temple border",
    "Draft a reply to the waiting customer in Telugu",
    "What does the newest enquiry say?",
    "What is the price of Synthetic product?",
    "Which quotes are still drafts?",
    "Is any money held on a closed order?",
    "ఈ రోజు ఏమి పెండింగ్‌లో ఉంది?",
    "आज क्या बाकी है?",
    "ಇಂದು ಏನು ಬಾಕಿ ಇದೆ?",
    "இன்று என்ன நிலுவையில் உள்ளது?",
    "Make a follow-up draft for the lead",
    "ఈ చీర ధర ఎంత?",
    "इस साड़ी की कीमत क्या है?",
    "",
]
CATALOGUE_QUESTIONS = {
    "en": [
        "Send photos of the maroon Kanchi pattu to Ravi",
        "Show me red sarees",
        "Do you have any pics of georgette?",
        "What is in stock?",
        "Which designs do we have?",
        "Share the catalogue with Sita",
        "any wedding colour options? show me",
    ],
    "te": [
        "రవికి మెరూన్ చీర ఫోటోలు పంపండి",
        "కేటలాగ్ చూపించండి",
        "ఎరుపు రంగు చీరలు ఉన్నాయా?",
        "ఏ డిజైన్లు ఉన్నాయి",
        "స్టాక్ ఎంత ఉంది?",
        "ఈ చీరలు చూపించు",
    ],
    "hi": [
        "रवि को मरून कांजीवरम की फोटो भेजिए",
        "कैटलॉग दिखाइए",
        "लाल रंग की साड़ियां हैं क्या?",
        "कौन से डिज़ाइन हैं",
        "स्टॉक कितना है",
        "ये साड़ी दिखा दो",
    ],
    "kn": [
        "ರವಿಗೆ ಮರೂನ್ ಸೀರೆಯ ಫೋಟೋ ಕಳುಹಿಸಿ",
        "ಕ್ಯಾಟಲಾಗ್ ತೋರಿಸಿ",
        "ಕೆಂಪು ಬಣ್ಣದ ಸೀರೆ ಇದೆಯಾ",
        "ಯಾವ ಡಿಸೈನ್ ಇದೆ",
        "ಸ್ಟಾಕ್ ಎಷ್ಟು ಇದೆ",
    ],
    "ta": [
        "ரவிக்கு மெரூன் புடவையின் புகைப்படம் அனுப்புங்கள்",
        "கேட்டலாக் காட்டுங்கள்",
        "சிவப்பு நிற புடவை இருக்கா",
        "என்ன டிசைன் இருக்கு",
        "ஸ்டாக் எவ்வளவு",
    ],
}
VISIT_QUESTIONS = {
    "en": [
        "Book a visit for Lakshmi tomorrow at 11:00",
        "Is there a slot on Friday?",
        "She wants an appointment next week",
        "Can she come to the shop on Monday?",
        "propose a walk-in for Ravi",
    ],
    "te": ["రేపు లక్ష్మికి సందర్శన బుక్ చేయండి", "శుక్రవారం స్లాట్ ఉందా", "అపాయింట్‌మెంట్ కావాలి"],
    "hi": ["कल लक्ष्मी की मुलाकात बुक कीजिए", "शुक्रवार को स्लॉट है क्या", "अपॉइंटमेंट चाहिए"],
    "kn": ["ನಾಳೆ ಲಕ್ಷ್ಮಿಗೆ ಭೇಟಿ ಬುಕ್ ಮಾಡಿ", "ಶುಕ್ರವಾರ ಸ್ಲಾಟ್ ಇದೆಯಾ", "ಅಪಾಯಿಂಟ್ಮೆಂಟ್ ಬೇಕು"],
    "ta": ["நாளை லட்சுமிக்கு வருகை புக் செய்யுங்கள்", "வெள்ளிக்கிழமை ஸ்லாட் இருக்கா", "சந்திப்பு வேண்டும்"],
}


@pytest.mark.parametrize("question", BASE_QUESTIONS)
def test_an_ordinary_question_gets_only_the_core_tools(question: str) -> None:
    assert offered_tools(question) == CORE
    assert not wants_catalogue(question) and not wants_visits(question)


@pytest.mark.parametrize("language", sorted(CATALOGUE_QUESTIONS))
def test_a_question_about_photos_designs_colours_or_stock_offers_the_catalogue_tools(
    language: str,
) -> None:
    for question in CATALOGUE_QUESTIONS[language]:
        assert offered_tools(question) == CORE | CATALOGUE_TOOLS, (language, question)


@pytest.mark.parametrize("language", sorted(VISIT_QUESTIONS))
def test_a_question_about_a_visit_or_an_appointment_offers_the_visit_tool(language: str) -> None:
    for question in VISIT_QUESTIONS[language]:
        assert offered_tools(question) == CORE | VISIT_TOOLS, (language, question)


def test_a_question_about_both_offers_both() -> None:
    assert (
        offered_tools("Book a visit for Ravi and send him photos of the Kanchi pattu")
        == CORE | CATALOGUE_TOOLS | VISIT_TOOLS
    )


def test_a_bare_saree_is_not_a_trigger_but_a_saree_with_a_verb_of_showing_is() -> None:
    assert not wants_catalogue("What is the price of this saree?")
    assert not wants_catalogue("Price 50 sarees for the wedding")
    assert wants_catalogue("show me the sarees")
    assert wants_catalogue("sarees: what do you have?"), (
        "a saree and 'do you have' is a question about the stock"
    )
    assert not wants_catalogue("the saree is late")
    assert wants_catalogue("do we have a saree in green")


@pytest.mark.parametrize("text", ["I picked it up", "microphotography", "a pickup at noon"])
def test_a_latin_catalogue_word_must_start_at_a_word_boundary(text: str) -> None:
    assert not wants_catalogue(text)


def test_a_latin_visit_word_must_start_at_a_word_boundary() -> None:
    assert not wants_visits("revisit it later") and not wants_visits("a bookkeeping question")
    assert wants_visits("visits tomorrow") and wants_visits("Booking for Friday")


def test_case_and_zero_width_joiners_do_not_matter() -> None:
    assert wants_catalogue("SEND PHOTOS")
    assert wants_catalogue("ఫోటో‌లు పంపండి") and wants_catalogue("ఫోటోలు")
    assert wants_visits("అపాయింట్‌మెంట్") and wants_visits("అపాయింట్మెంట్")


def test_the_same_question_always_gives_the_same_tools() -> None:
    for question in ["Show me red sarees", "What needs me today?", "Book a visit"]:
        results = {
            offered_tools(question, [{"role": "user", "body": "earlier"}]) for _ in range(50)
        }
        assert len(results) == 1


def test_the_follow_up_of_a_chat_carries_the_group_over() -> None:
    history = [
        {"role": "user", "body": "Show me red sarees for Ravi"},
        {"role": "assistant", "body": "I found three red sarees."},
    ]
    assert offered_tools("yes, send them to him", history) == CORE | CATALOGUE_TOOLS
    assert offered_tools("yes, send them to him", []) == CORE, (
        "without the line before, it is just a sentence"
    )
    visit_history = [{"role": "user", "body": "Can Sita visit on Friday?"}]
    assert offered_tools("ok do it", visit_history) == CORE | VISIT_TOOLS
    unrelated = [{"role": "user", "body": "What needs me today?"}]
    assert offered_tools("and who hasn't paid", unrelated) == CORE


def test_every_tool_belongs_to_exactly_one_group_so_a_new_tool_must_be_placed() -> None:
    names = {t.name for t in TOOLS}
    assert CORE | CATALOGUE_TOOLS | VISIT_TOOLS == names, (
        "a new tool must be added to CORE or to a group in app/assistant/router.py"
    )
    assert (
        not (CORE & CATALOGUE_TOOLS)
        and not (CORE & VISIT_TOOLS)
        and not (CATALOGUE_TOOLS & VISIT_TOOLS)
    )


# ---------------------------------------------------------------------------------------------- the request
def _request(**over: Any) -> LlmRequest:
    base: dict[str, Any] = {
        "turn": 1,
        "delimiter": "ab12cd34ef56",
        "question": "What is waiting?",
        "language": "en",
        "history": [],
        "results": [],
        "notes": [],
        "today": NOW,
        "max_output_tokens": 1500,
    }
    base.update(over)
    return prompts.build_request(**base)


def test_the_request_describes_only_the_tools_offered() -> None:
    core = _request(offered=CORE)
    assert {t.name for t in core.tools} == CORE
    both = _request(offered=CORE | CATALOGUE_TOOLS | VISIT_TOOLS)
    assert {t.name for t in both.tools} == {t.name for t in TOOLS}
    assert [t.name for t in both.tools] == [t.name for t in TOOLS], (
        "in the fixed order of the registry"
    )
    assert {t.name for t in _request().tools} == {t.name for t in TOOLS}, (
        "no router (None) = every tool"
    )
    assert _request(offered=CORE, turn=3).tools == (), (
        "the answering turns carry no tool definitions, as before"
    )


def test_the_system_prompt_mentions_the_photos_tool_only_when_it_is_offered() -> None:
    without = _request(offered=CORE).blocks[0].text
    with_cat = _request(offered=CORE | CATALOGUE_TOOLS).blocks[0].text
    visits_only = _request(offered=CORE | VISIT_TOOLS).blocks[0].text
    assert "catalogue photos tool" not in without and "catalogue photos tool" not in visits_only
    assert "catalogue photos tool" in with_cat and with_cat == prompts.SYSTEM_PROMPT
    assert (
        "ACTION tools only leave DRAFTS that a person approves later. You cannot send, approve,"
        in without
    )
    assert len(without) < len(with_cat)
    assert prompts.SYSTEM_PROMPT_NO_CATALOGUE == without
    assert "never name a tool" in without and "never name a tool" in with_cat


# ---------------------------------------------------------------------------------------------- the runner refuses a tool that was not offered
class FakeDb:
    ai_mode = "normal"

    def __init__(self) -> None:
        self.steps: list[tuple[str, str]] = []
        self.finished: tuple[str, str | None] | None = None
        self.saved: dict[str, Any] | None = None
        self.reserved = 0

    def read_run(self) -> Any:
        return SimpleNamespace(
            status="running", cancel_requested_at=None, expires_at=NOW + timedelta(days=1)
        )

    def reserve_cost(self, key: str, **_: Any) -> None:
        self.reserved += 1

    def release_cost(self, key: str, *, reason: str) -> None: ...

    def record_usage(self, key: str, usage: Any) -> None: ...

    def record_step(self, key: str, name: str, sha: str, status: str, out: Any) -> None:
        self.steps.append((name, status))

    def save_reply(self, **kwargs: Any) -> None:
        self.saved = kwargs

    def finish(self, status: str, code: str | None) -> None:
        self.finished = (status, code)


class Model:
    model_id = "fake-selftest"

    def __init__(self, first_calls: tuple[ToolCall, ...]) -> None:
        self.first_calls = first_calls
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        if len(self.requests) == 1:
            return LlmResponse(tool_calls=self.first_calls, structured=None, usage=Usage(10, 5, 0))
        return LlmResponse(
            tool_calls=(),
            structured={
                "kind": "refusal",
                "answer": "I could not do that.",
                "language": "en",
                "sources": [],
            },
            usage=Usage(10, 5, 0),
        )


SEND = ToolCall(
    "send_catalogue_items",
    {
        "lead_id": str(uuid.uuid4()),
        "photo_ids": [str(uuid.uuid4())],
        "caption": "Hello there",
        "language": "en",
    },
)
VISIT = ToolCall(
    "propose_visit", {"lead_id": str(uuid.uuid4()), "date": "2026-10-12", "time": "11:00"}
)


def _run(
    question: str, first: tuple[ToolCall, ...], history: list[dict[str, Any]] | None = None
) -> tuple[Model, FakeDb]:
    db, model = FakeDb(), Model(first)
    ctx = SimpleNamespace(
        db=db, runtime=None, token="t", tenant=uuid.uuid4(), run_id=uuid.uuid4(), state=State()
    )  # noqa: S106
    runner = AssistantRunner(db=db, llm=model, ctx=ctx, now=lambda: NOW)  # type: ignore[arg-type]
    out = runner.run(
        question=question,
        language="en",
        history=history or [],
        emit=lambda *_: None,
        message_id=uuid.uuid4(),
    )
    assert out.status == "succeeded", out
    return model, db


def test_a_call_to_a_catalogue_tool_on_an_ordinary_question_is_refused_and_never_runs() -> None:
    model, db = _run("What needs me today?", (SEND,))
    assert {t.name for t in model.requests[0].tools} == CORE
    assert db.steps == [("refused_call", "refused")], "recorded as a refused call, not as the tool"
    assert prompts.NOTE_TOOL_REFUSED in " ".join(b.text for b in model.requests[1].blocks)


def test_a_call_to_the_visit_tool_on_an_ordinary_question_is_refused_too() -> None:
    _, db = _run("Who hasn't paid?", (VISIT,))
    assert db.steps == [("refused_call", "refused")]


def test_the_offer_is_decided_once_from_the_question_and_the_chat_so_it_is_the_same_on_every_turn() -> (
    None
):
    model, _ = _run("Show me red sarees", ())
    names = [{t.name for t in r.tools} for r in model.requests[:2]]
    assert names[0] == names[1] == CORE | CATALOGUE_TOOLS
    assert "catalogue photos tool" in model.requests[0].blocks[0].text
    model2, _ = _run(
        "yes, send them", (), [{"role": "user", "body": "Show me red sarees for Ravi"}]
    )
    assert {t.name for t in model2.requests[0].tools} == CORE | CATALOGUE_TOOLS
