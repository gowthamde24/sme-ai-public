"""Spoken Telugu on goal calls (owner, 11 Nov 2026, after the school role-play calls: the Telugu was written, not spoken, and "యష్ రెడ్డి గారి తల్లిదండ్రులేనా" kept an honorific).
Proven: every case form of the honorific is taken out in Friendly and Casual (and the case ending it carried stays on the name); the SPOKEN TELUGU rule and the bookish word list are in every Telugu goal prompt and not in other languages;
the child is called by name unless the goal says it is a boy; nothing we ship contains a bookish word; the metric counts the written words that were spoken, flags a call over 2, and swaps nothing."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

import pytest

from app.agents import register
from app.talk_training.guard import GuardedTts
from app.telephony import inbound, tone
from tests.test_outbound_frame import GOAL, Spy, goal_prompt, shipped_lines, speak


@pytest.mark.parametrize("chosen", ["respectful", "friendly", "casual"])
def test_every_form_of_the_honorific_is_taken_out_and_the_case_ending_stays(chosen: str) -> None:
    cases = {
        "యష్ రెడ్డి గారి తల్లిదండ్రులేనా?": "యష్ రెడ్డి తల్లిదండ్రులేనా?",       # the exact line of the third school call
        "రమేష్ గారికి చెప్పండి": "రమేష్ కి చెప్పండి",
        "రమేష్ గారితో మాట్లాడాను": "రమేష్ తో మాట్లాడాను",
        "రమేష్ గారిని అడగండి": "రమేష్ ని అడగండి",
        "రమేష్ గారు వచ్చారు": "రమేష్ వచ్చారు",
        "రమేష్ గారూ, చెప్పండి": "రమేష్, చెప్పండి",
        "Ramesh garu is here": "Ramesh is here",
    }
    for before, after in cases.items():
        assert tone.soften(before, chosen, "te") == after, before
    assert "గారి" not in tone.soften("రమేష్ గారిని గారికి గారితో గారి గారు గారూ", chosen, "te")
    assert tone.soften("రమేష్ గారి ఇంట్లో", "respectful", "te") == "రమేష్ ఇంట్లో", "the honorific goes in EVERY tone (owner, 11 Nov 2026)"


def test_the_honorific_is_not_cut_out_of_other_words() -> None:
    assert tone.soften("కారణం గురించి చెప్తాను", "friendly", "te") == "కారణం గురించి చెప్తాను"
    for word in ("బంగారు చీర ఉంది", "సంగారెడ్డి నుంచి", "బంగారు గారు"[:6] + " ఉంది"):
        assert tone.soften(word, "friendly", "te") == word, word
    assert tone.soften("రమేష్\u200cగారు వచ్చారు", "friendly", "te") == "రమేష్ వచ్చారు", "the joiner form (రమేష్‌గారు) is the honorific"


def test_the_spoken_telugu_rule_and_the_word_list_are_in_every_telugu_goal_prompt_and_nowhere_else() -> None:
    for chosen in tone.TONES:
        text = goal_prompt("te", chosen)
        for must in ("SPOKEN TELUGU", "మేము", "say the organisation's name ONCE", "keep common English words in English", "Written words to AVOID in speech", "ధన్యవాదాలు -> థాంక్స్", "తల్లిదండ్రు -> parents", "తరపున -> నుంచి"):
            assert must in text, (chosen, must)
    for language in ("en", "hi", "kn"):
        assert "SPOKEN TELUGU" not in goal_prompt(language, "friendly")


def test_the_child_is_called_by_name_unless_the_goal_says_it_is_a_boy() -> None:
    plain = goal_prompt("te", "friendly", "Ask the parent about the child's marks in maths.")
    assert "by NAME only" in plain and "no \"వాడు\"" in plain
    boy = goal_prompt("te", "friendly", "Ask the parent about the marks of their son in maths.")
    assert "వాడు" in boy and "the goal says it is a boy" in boy and "by NAME only" not in boy
    assert tone.child_is_boy("the boy is in class 8") and tone.child_is_boy("అబ్బాయి మార్కులు") and not tone.child_is_boy("the student") and not tone.child_is_boy(None)


def test_the_word_list_is_well_formed_and_holds_the_owners_pairs() -> None:
    rows = register.bookish_list("te")
    assert len(rows) >= 10 and all(stem and say and status in ("owner", "draft") for stem, say, status in rows)
    assert all(stem != say for stem, say, _ in rows), "a word is never its own replacement"
    assert len({stem for stem, _, _ in rows}) == len(rows), "no duplicates"
    owner = {stem: say for stem, say, status in rows if status == "owner"}
    assert owner["ధన్యవాదాలు"] == "థాంక్స్" and owner["తల్లిదండ్రు"] == "parents" and owner["తరపున"] == "నుంచి"
    drafts = {stem: say for stem, say, status in rows if status == "draft"}
    assert drafts["మద్దతు"] == "support" and drafts["ఆందోళన"] == "tension" and drafts["సహకారం"] == "help"
    assert register.bookish_list("en") == ()
    doc = json.loads((register.HERE / "data" / "bookish.json").read_text(encoding="utf-8"))
    assert set(doc) == {"$comment", "te", "child_terms"}


def test_nothing_we_ship_for_telugu_goal_calls_contains_a_bookish_word() -> None:
    for name, line in shipped_lines():
        assert register.bookish_in("te", line) == [], (name, line)
    from app.tasks.dialer import OPENERS

    assert register.bookish_in("te", OPENERS["te"]) == []


def test_the_metric_counts_what_was_spoken_swaps_nothing_and_flags_a_call_over_two() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="friendly")
    said = speak(guard, spy, "మీ తల్లిదండ్రులేనా అండీ? ధన్యవాదాలు.")
    assert "తల్లిదండ్రులేనా" in said and "ధన్యవాదాలు" in said, "the words are counted, not replaced"
    assert guard.bookish_words == ["ధన్యవాదాలు", "తల్లిదండ్రు"] or sorted(guard.bookish_words) == sorted(["ధన్యవాదాలు", "తల్లిదండ్రు"])
    speak(guard, spy, "మీ సహకారం కావాలి.")
    assert len(guard.bookish_words) == 3
    clean = GuardedTts(Spy(), [], goal_tone="friendly")
    speak(clean, cast_spy(clean), "థాంక్స్, parents కి చెప్పండి.")
    assert clean.bookish_words == []
    not_te = GuardedTts(Spy(), [], goal_tone="friendly")
    speak(not_te, cast_spy(not_te), "ధన్యవాదాలు", "en")
    assert not_te.bookish_words == [], "only Telugu has a list"
    inbound_guard = GuardedTts(Spy(), [])
    speak(inbound_guard, cast_spy(inbound_guard), "ధన్యవాదాలు")
    assert inbound_guard.bookish_words == [], "inbound calls are not measured"


def cast_spy(guard: GuardedTts) -> Spy:
    inner: Any = guard._inner  # noqa: SLF001
    return inner  # type: ignore[no-any-return]


def test_the_call_numbers_carry_the_total_the_words_and_the_flag() -> None:
    class Line:
        bookish = ["ధన్యవాదాలు", "ధన్యవాదాలు", "మద్దతు"]

    got = inbound.bookish_numbers(Line())
    assert {k: got[k] for k in ("bookish_total", "bookish_words", "bookish_flag", "honorifics_stripped")} == {"bookish_total": 3, "bookish_words": {"ధన్యవాదాలు": 2, "మద్దతు": 1}, "bookish_flag": True, "honorifics_stripped": 0}
    empty = inbound.bookish_numbers(object())
    assert empty["bookish_total"] == 0 and empty["bookish_flag"] is False and empty["child_terms_total"] == 0 and empty["particles_per_sentence"] is None
    two = type("L", (), {"bookish": ["ఆయన", "సహకారం"]})()
    assert inbound.bookish_numbers(two)["bookish_flag"] is False, "2 is allowed; more than 2 is flagged"


def test_a_goal_that_asks_for_nothing_special_still_gets_the_rule_text() -> None:
    assert "SPOKEN TELUGU" in goal_prompt("te", "casual", GOAL)


def test_the_honorifics_taken_out_of_the_spoken_lines_are_counted_in_every_tone() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="friendly")
    speak(guard, spy, "యష్ రెడ్డి గారి తల్లిదండ్రులేనా? రమేష్ గారికి చెప్పండి.")
    assert guard.honorifics_stripped == 2 and tone.honorifics_in("రమేష్ గారు, రమేష్ గారూ, బంగారు") == 2
    resp = GuardedTts(Spy(), [], goal_tone="respectful")
    speak(resp, cast_spy(resp), "రమేష్ గారు వచ్చారు")
    assert resp.honorifics_stripped == 1 and "గారు" not in cast_spy(resp).said[-1], "respectful strips and counts it too"
    class Line:
        honorifics_stripped = 3

    assert inbound.bookish_numbers(Line())["honorifics_stripped"] == 3
