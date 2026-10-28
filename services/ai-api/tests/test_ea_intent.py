"""Job EA: the turn router (app/turns/intent.py). Every example is pinned: the same words always give the same kind, in English, Telugu, Hindi and Kannada."""

from __future__ import annotations

import pytest

from app.turns import intent
from app.turns.intent import classify, is_yes_no

SMALLTALK = ["how are you", "I'm tired today", "tell me a joke", "thanks", "Thank you!", "hello", "good morning", "who are you", "what's your name", "bye", "lol",
             "నమస్కారం", "ఎలా ఉన్నారు", "ధన్యవాదాలు", "नमस्ते", "आप कैसे हैं", "धन्यवाद", "ಹೇಗಿದ್ದೀರಿ", "ಧನ್ಯವಾದ", "ela unnaru", "bagunnara"]
GENERAL = ["explain GST on sarees", "write a Diwali offer message", "how do I price paver blocks", "translate this to Telugu: hello", "what is a margin", "give me ideas for a Sankranti sale",
           "capital of France", "make it shorter and friendlier", "दीपावली ऑफर मैसेज लिखो", "దీపావళి ఆఫర్ మెసేజ్ రాయండి", "ಈ ಸಂದೇಶವನ್ನು ಬರೆ", "tips to attract more shoppers"]
BUSINESS = ["how many enquiries today?", "who didn't reply", "what's the price of paver blocks", "write a follow-up for Ramesh", "show my unpaid orders", "which customers are overdue",
            "what needs me today", "message from Ramesh", "Is Ramesh coming", "ఈరోజు ఎంతమంది ఎంక్వైరీ చేశారు", "आज कितने ऑर्डर आए", "ಇಂದು ಎಷ್ಟು ಲೀಡ್ ಬಂದಿವೆ", "send the quote to Ramesh"]
ACTION = ["call the new leads", "call", "please message everyone who didn't pay", "Can you WhatsApp all pending customers", "remind Ramesh about the quote", "follow up with yesterday's leads",
          "కొత్త లీడ్స్‌కి కాల్ చేయండి", "నిన్నటి కస్టమర్లకు మెసేజ్ పంపండి", "नए लीड को कॉल करो", "ग्राहकों को व्हाट्सऐप भेजो", "ಹೊಸ ಲೀಡ್‌ಗಳಿಗೆ ಕಾಲ್ ಮಾಡಿ"]


@pytest.mark.parametrize(("kind", "examples"), [("smalltalk", SMALLTALK), ("general", GENERAL), ("business", BUSINESS), ("action", ACTION)])
def test_every_example_is_routed_to_its_kind(kind: str, examples: list[str]) -> None:
    wrong = {text: classify(text).kind for text in examples if classify(text).kind != kind}
    assert not wrong, f"expected {kind}: {wrong}"


def test_a_question_about_calls_is_not_an_instruction() -> None:
    assert classify("how many calls did we make today?").kind == "business"
    assert classify("call log of this week").kind == "business"
    assert classify("ఎన్ని కాల్స్ చేశారు").kind != "action"


def test_a_business_word_beats_a_general_verb_and_small_talk() -> None:
    assert classify("write a follow-up message for the pending leads").kind == "business"
    assert classify("hi, how many orders came in").kind == "business"
    assert classify("I'm tired, what is pending").kind == "business"


def test_a_short_follow_up_continues_the_turn_before() -> None:
    assert classify("and the week before?", previous="business").kind == "business"
    assert classify("make it shorter", previous="general").kind == "general"
    assert classify("ok and?", previous="smalltalk").kind == "smalltalk"
    assert classify("the second one", previous="action").kind == "business", "an action's follow-up is read from the records, the planner continues by its own question"
    assert classify("the second one", previous=None).kind == "general"


def test_unknown_words_choose_the_safe_path() -> None:
    assert classify("Ramesh 9876543210").kind == "business"
    assert classify("ఆ విషయం").kind == "business", "an Indian-script message with no signal goes to the cited path (it can say 'no record')"
    assert classify("random words here").kind == "general"
    assert classify("random words here").reason == "default"


def test_the_same_words_always_give_the_same_answer_and_zero_width_joiners_do_not_matter() -> None:
    assert classify("కాల్‌ చేయండి") == classify("కాల్ చేయండి")
    assert all(classify("how are you") == classify("how are you") for _ in range(3))


def test_a_bare_yes_or_no_is_recognised_for_a_plan_that_waits() -> None:
    for yes in ("yes", "Yes!", "ok", "go ahead", "do it", "no", "cancel", "haan", "avunu"):
        assert is_yes_no(yes), yes
    for other in ("yes please call only the first ten", "maybe", "call Ramesh"):
        assert not is_yes_no(other), other


def test_the_kinds_are_the_four_of_the_contract() -> None:
    assert intent.KINDS == ("smalltalk", "general", "business", "action")
