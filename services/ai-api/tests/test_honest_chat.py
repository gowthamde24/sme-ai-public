"""The step that only talks never promises a look-up or an action and never says it cannot (owner, 14 Nov 2026), and the gate sends look-ups, sends and a plain yes to an offer to the step that has the tools."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.assistant.honest import NOTHING_DONE, promises_or_refuses, strip_deferred_promise
from app.turns.intent import classify
from app.turns.service import is_ok, offered_action


@pytest.mark.parametrize("text", [
    "I'll check your contacts for Kalyani now… I'll tell you what I find.", "I can't see Kalyani's contact or send WhatsApp messages from here.", "Let me check that for you.",
    "Sure, I will look into it and get back to you.", "I don't have access to your records.", "I'm unable to open your leads.", "చూస్తాను, కొంచెం ఆగండి", "देखती हूँ, एक मिनट", "ನೋಡುತ್ತೇನೆ, ಸ್ವಲ್ಪ ಕಾಯಿರಿ",
])
def test_a_promise_or_a_refusal_is_caught(text: str) -> None:
    assert promises_or_refuses(text)


@pytest.mark.parametrize("text", [
    "GST is a tax on goods and services.", "Here is a short message you can send:\n\nHi Ravi, I'll call you tomorrow at 5.", 'Try this: "Hi Kalyani, I will send the details today."', "I will keep it short: silk lasts for years.",
    "Kalyani is in your leads: added today.", "A good offer message is short and friendly.",
])
def test_ordinary_answers_and_drafted_messages_are_not(text: str) -> None:
    assert not promises_or_refuses(text)


def test_the_fixed_line_promises_nothing_and_says_how_to_ask_in_every_language() -> None:
    for language, line in NOTHING_DONE.items():
        assert line and not promises_or_refuses(line), language


@pytest.mark.parametrize("text", [
    "check if kalyani's contact is there or not?", "is kalyani saved", "find kalyani", "search Ravi Teja", "do I have kalyani's number", "Check if Kalyani is in my contacts", "కళ్యాణి కాంటాక్ట్ ఉందా?",
])
def test_looking_a_person_up_goes_to_the_records(text: str) -> None:
    assert classify(text, None).kind == "business", text


@pytest.mark.parametrize("text", ["send kalyani a whatsapp", "send Anitha Hegde a message", "Send Ravi a reminder"])
def test_sending_to_a_named_person_is_an_action(text: str) -> None:
    assert classify(text, None).kind == "action", text


@pytest.mark.parametrize("text", ["what is GST", "explain contact lens", "write a message to my contacts about Diwali", "translate hello to Telugu", "find a supplier for sarees", "hi how are you"])
def test_general_help_and_small_talk_stay_in_the_step_that_talks(text: str) -> None:
    assert classify(text, None).kind in ("general", "smalltalk"), text


def test_a_plain_yes_to_a_drafted_message_means_do_it() -> None:
    history = [{"role": "user", "body": "Draft a WhatsApp for Kalyani: how are you"}, {"role": "assistant", "body": "Hi Kalyani, how are you?"}]
    for text in ("yes do it", "Yes, send it", "ok", "send it"):
        assert is_ok(text) and offered_action(text, history, {"kind": "answer", "task_id": None}), text
    assert not offered_action("thanks", history, {"kind": "answer", "task_id": None})
    assert not offered_action("yes", [{"role": "user", "body": "how is my day"}, {"role": "assistant", "body": "Fine"}], {"kind": "answer", "task_id": None}), "nothing was offered"
    assert not offered_action("yes", history, {"kind": "confirm_action", "task_id": "x"}), "a card waits: the yes belongs to the card"


# ---- a look-up that WAS done must not end on a promise to look again (owner, 17 Nov 2026)
@pytest.mark.parametrize(("before", "after"), [
    ("Lakshmi, I could not find a Ravi in your contacts. The search came back with no details, so I cannot tell you his city. Could you send me his full name or phone number? I will check again.",
     "Lakshmi, I could not find a Ravi in your contacts. The search came back with no details, so I cannot tell you his city. Could you send me his full name or phone number?"),
    ("Kalyani is in Bengaluru. I'll check the rest and let you know.", "Kalyani is in Bengaluru."),
    ("Nothing came back. Let me look into it again.", "Nothing came back."),
])
def test_a_deferred_lookup_promise_is_cut_from_an_answer(before: str, after: str) -> None:
    assert strip_deferred_promise(before) == after


@pytest.mark.parametrize("text", [
    "Tell me a customer's name, a date or a product and I will look again, or ask me to draft a follow-up.",   # conditional on what the person says next
    "Send me his surname and I will check.", "If you give me the city, I will search for him.", "Would you like me to check the other Kalyanis?", "Kalyani Gowda is in Bengaluru. Shall I look up her enquiries?",
    'Here is a message: "Hi Ravi, I will check and call you."', "Calling Anitha now.",
])
def test_a_conditional_offer_a_question_a_draft_or_an_action_is_left_alone(text: str) -> None:
    assert strip_deferred_promise(text) == text.strip()


def test_an_answer_that_was_only_a_promise_becomes_empty() -> None:
    assert strip_deferred_promise("I will check again.") == ""


@pytest.mark.parametrize("text", [
    "do you have access to my contacts?", "can you see my contacts?", "are you able to access my WhatsApp?", "do you have access to my leads", "Can you read my customers?",
])
def test_a_question_about_what_the_assistant_can_reach_is_answered_from_the_fixed_words(text: str) -> None:
    got = classify(text)
    assert got.kind == "general" and "about" in got.reason, got
