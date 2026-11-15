"""15 Nov eval fixes: the words that open the work router, and a message whose OWN words look like a question is still an instruction."""

# ruff: noqa: E501

from __future__ import annotations

import pytest

from app.assistant_work.router import touches
from app.turns.intent import classify


@pytest.mark.parametrize("text", [
    "నా IndiaMART కనెక్ట్ చేయి",
    "నా వెబ్‌సైట్ ఫారమ్ టెస్ట్ చేయి",
    "నా Google Sheet డిస్కనెక్ట్ చేయి",
    "Show Kalyani's chat",
    "Open Anitha Hegde's conversation",
])
def test_source_and_chat_words_reach_the_work_router(text: str) -> None:
    assert touches(text)


@pytest.mark.parametrize("text", ["show me my leads", "How many chat messages came today?", "What is my balance"])
def test_plain_questions_do_not_open_the_router(text: str) -> None:
    assert not touches(text)


@pytest.mark.parametrize("text", [
    "అనిత హెగ్డేకి మెసేజ్ పంపు: ఎలా ఉన్నారు?",
    "Message Anitha Hegde: how are you?",
])
def test_a_message_with_how_are_you_in_its_words_is_still_an_instruction(text: str) -> None:
    assert classify(text).kind == "action"


def test_a_real_question_with_a_colon_stays_a_question() -> None:
    assert classify("ఎవరికి పంపాలి: Anitha లేదా Ravi?").kind != "action"


def test_a_leads_filter_that_loses_a_period_says_so() -> None:
    from app.assistant_work.client_actions import drops_period
    from app.assistant_work.routed import w

    assert drops_period("filter", {"page": "leads", "status": "new"}, "Filter leads to new ones from this week")
    assert drops_period("filter", {"page": "leads", "status": "new"}, "ఈ వారం కొత్త లీడ్స్ చూపించు")
    assert not drops_period("filter", {"page": "leads", "status": "new"}, "Filter leads to new ones")
    assert not drops_period("filter", {"page": "calls", "when": "today"}, "calls from today")   # the Calls filter has a day of its own
    assert not drops_period("theme", {"mode": "dark"}, "dark mode today")
    for lang in ("en", "te", "hi", "kn"):
        assert "{" not in w("period_dropped", lang)


@pytest.mark.parametrize("text, name", [
    ("Show Bhavani Reddy's chat", "Bhavani Reddy"),
    ("open Kalyani's conversation", "Kalyani"),
    ("Please show me Anitha Hegde’s chat.", "Anitha Hegde"),
])
def test_show_a_persons_chat_is_routed_by_code(text: str, name: str) -> None:
    from app.assistant_work.router import shortcut

    routed = shortcut(text)
    assert routed is not None and routed.decision == "do" and routed.action == "client"
    assert routed.args["client_action"] == "open_record" and routed.args["client_args"] == {"type": "chat", "target": name}


@pytest.mark.parametrize("text", ["Show my chat history", "show all chats", "Show the chat", "What is in Kalyani's chat?", "Show Kalyani's chat and call her"])
def test_other_shapes_still_go_to_the_model(text: str) -> None:
    from app.assistant_work.router import shortcut

    assert shortcut(text) is None


def test_the_client_action_card_carries_its_note_only_when_there_is_one() -> None:
    from app.assistant_work.client_actions import card

    assert "note" not in card("filter", {"page": "leads", "status": "new"})
    assert card("filter", {"page": "leads", "status": "new"}, "Showing these leads.")["note"] == "Showing these leads."

@pytest.mark.parametrize("text", [
    "Namaskara, Hegiddeeri?", "Namaskara, hegiddiri?", "Namaskara hegiddira", "namaskara chennagiddira?", "Namaste, aap kaise hain?", "Dhanyavadagalu",
])
def test_a_greeting_written_in_latin_letters_is_small_talk_so_it_gets_the_fast_model(text: str) -> None:
    assert classify(text).kind in ("smalltalk", "general"), text


def test_a_business_sentence_in_latin_letters_is_not_small_talk() -> None:
    assert classify("Anitha Hegde ki visit book cheyyi").kind != "smalltalk"


@pytest.mark.parametrize("text", [
    "Cancel Anitha Hegde's visit on Saturday at 4:30 pm", "Book Anitha Hegde for a visit on Saturday at 11", "Move Anitha Hegde's visit to Sunday 4 pm",
    "Archive the lead Ravi Teja", "Stop messaging Bindu Menon", "Bhavani Reddy has agreed to get WhatsApp messages", "Mark Kalyani as qualified",
])
def test_record_words_are_recognised_so_not_mine_gets_a_second_try_that_cannot_say_it(text: str) -> None:
    from app.assistant_work.router import _RECORDY, FINAL_RECORD

    assert _RECORDY.search(text)
    assert FINAL_RECORD.input_schema["properties"]["decision"]["enum"] == ["do", "clarify"]


@pytest.mark.parametrize("text", ["What is my balance", "Show Kalyani's chat", "Start a campaign for the new silk collection", "Send the quote to the customer on WhatsApp"])
def test_other_requests_do_not_get_the_forced_record_retry(text: str) -> None:
    from app.assistant_work.router import _RECORDY

    assert not _RECORDY.search(text)


@pytest.mark.parametrize("text", [
    "What are the shop hours?", "What time does the shop open?", "When do we close the store?", "Angadi tereyuva samaya enu?", "Namma angadi eshtu gantege tereyuttade?",
    "Aapki dukaan kab khulti hai?", "Mana dukanam enni gantalaku teruchukuntundi?",
])
def test_a_question_about_the_shops_own_hours_is_about_the_business_so_it_gets_the_records(text: str) -> None:
    assert classify(text).kind == "business", text


@pytest.mark.parametrize("text", ["Hello, how are you today?", "Namaskara, Hegiddeeri?", "Tell me a joke", "What is the capital of India?"])
def test_small_talk_and_general_questions_stay_on_the_fast_tier(text: str) -> None:
    assert classify(text).kind in ("smalltalk", "general"), text

@pytest.mark.parametrize("name", ["All customers", "all my customers", "Everyone", "all leads", "every customer", "అందరూ", "सभी"])
def test_a_group_word_is_never_looked_up_as_a_persons_name(name: str) -> None:
    from app.tasks.planner import is_group_word

    assert is_group_word(name)


@pytest.mark.parametrize("name", ["Anitha Hegde", "Kalyani", "Ravi Teja", "Allu Arjun", "Sarvesh"])
def test_a_persons_name_is_not_a_group_word(name: str) -> None:
    from app.tasks.planner import is_group_word

    assert not is_group_word(name)
