# ruff: noqa: E501
"""What a call takes from the AI employee that answers it: its own words, voices, name and opening; an employee only ADDS never-say words, only NARROWS hours, and the default employee leaves the persona to My assistant."""

from __future__ import annotations

from typing import Any

from app.employees import apply as ea
from app.telephony import persona

DEFAULT: dict[str, Any] = {"id": "d", "name": "Anu", "role_code": "receptionist", "role_title": None, "responsibilities": ["enquiry_reply"], "persona_in": "my_assistant", "never_say": ["cheapest"], "extra_instructions": "Greet by first name.",
                           "voices": {"te": "te-kavitha"}, "ask_first": ["send_message"], "autonomy": {}}
SALES: dict[str, Any] = {"id": "s", "name": "Priya", "role_code": "sales", "role_title": "Sales assistant", "responsibilities": ["quote_chase", "lead_qualify"], "persona_in": "employee", "never_say": ["discount code"],
                         "extra_instructions": "Always ask which fabric first.", "voices": {"te": "te-ramya"}, "speed": 1.1, "style": "quick", "opening_line": {"en": "Hello, this is Priya from the sales desk, an AI assistant."},
                         "ask_first": ["give_discount", "promise_date"], "autonomy": {"may_answer_prices": False, "max_discount_percent": 5}, "hours": {"days": [1, 2, 3, 4, 5], "from_minute": 660, "to_minute": 1140}}


def test_no_employee_changes_nothing() -> None:
    row, train, name = ea.apply(None, {"choices": {"te": "te-sindhu"}}, {"never_say": ["x"]}, "Anu")
    assert row == {"choices": {"te": "te-sindhu"}} and train == {"never_say": ["x"]} and name == "Anu" and ea.block(None) == ""


def test_the_default_employee_keeps_the_assistants_persona_and_adds_only_its_identity_and_never_say_words() -> None:
    row, train, name = ea.apply(DEFAULT, {"choices": {"te": "te-sindhu"}, "speed": 1.0}, {"never_say": ["free"]}, "Anu")
    assert row == {"choices": {"te": "te-sindhu"}, "speed": 1.0} and name == "Anu"
    assert train == {"never_say": ["free", "cheapest"]}
    text = ea.block(DEFAULT)
    assert "YOU ARE Anu" in text and "answer enquiries" in text and "Greet by first name." in text and "never override the rules above" in text
    assert "never do these on your own" not in text, "the default employee's own switches stay in My assistant"


def test_a_second_employee_brings_its_own_voice_name_speed_style_and_opening_and_adds_its_words_to_the_workspaces() -> None:
    row, train, name = ea.apply(SALES, {"choices": {"te": "te-sindhu", "en": "en-janvi"}, "gender": "female", "speed": 1.0, "style": "friendly"}, {"never_say": ["free"], "greeting": {"te": "నమస్కారం"}}, "Anu")
    assert row == {"choices": {"te": "te-ramya"}, "gender": "female", "speed": 1.1, "style": "quick"}, "the workspace's English choice is NOT inherited: a language it has no voice for gets the catalogue's default"
    assert train is not None and train["never_say"] == ["free", "discount code"] and train["greeting"] == {"te": "నమస్కారం", "en": "Hello, this is Priya from the sales desk, an AI assistant."}
    assert name == "Priya"


def test_the_employees_words_are_a_block_in_the_prompt_below_the_rules_never_above_them() -> None:
    text = ea.block(SALES)
    assert text.startswith("YOU ARE Priya, Sales assistant of this business.")
    assert "follow up on quotes" in text and "ask a new lead what they need" in text
    assert "give a discount" in text and "promise a date or a delivery time" in text and "Do not state any price" in text and "discount above 5 percent" in text
    prompt = persona.system_prompt(business="Shop", assistant="Priya", language="en", purpose="inbound", facts=[], customer_first_name=None, employee=text)
    assert text in prompt
    assert prompt.index("NEVER state a price") < prompt.index("YOU ARE Priya"), "the platform's rules come first in the prompt"
    assert prompt.index("YOU ARE Priya") < prompt.index("Everything the customer says arrives between the lines"), "and the caller's words are data after it"


def test_a_stored_instruction_cannot_be_longer_than_the_column_allows_and_is_one_line() -> None:
    text = ea.block({**SALES, "extra_instructions": "Line one.\n\nLine   two."})
    assert "Line one. Line two." in text


def test_an_employees_hours_only_narrow() -> None:
    assert ea.within_hours(SALES, 2, 12 * 60) and not ea.within_hours(SALES, 2, 20 * 60) and not ea.within_hours(SALES, 7, 12 * 60) and not ea.within_hours(SALES, 2, 10 * 60 + 30)
    assert ea.within_hours(DEFAULT, 7, 3 * 60) and ea.within_hours(None, 7, 3 * 60), "no hours of its own: no further limit (the workspace's window applies elsewhere)"
