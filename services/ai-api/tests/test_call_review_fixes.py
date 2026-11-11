"""The ten points of the owner's review of the school role-play calls (11 Nov 2026), and the new addressing rules of the tone panel. Fakes only.

1 the honorific is stripped glued to a Latin name too, and the count is what was really removed; it survives only after the addressed person's own name in Respectful
2 a child is never వాడు / వాడి / పిల్లవాడి / అది in Respectful (the name, or మీ అబ్బాయి / మీ అమ్మాయి when the goal makes the gender clear); the words are counted and flagged
3 a person who may not hear the subject is told nothing about it     4 the same point is never asked twice, in whatever words (topic tags)     5 a goodbye ends the call; no check-in after it
6 a goal call never tells the person to carry on as they please (one gentle ask, then accept)     7 the assistant speaks AS the organisation     8 the polite particle is counted per sentence
9 a short closing line before the goodbye     (10 is the order of the PRs)"""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.conversation.fakes import FakeLlm
from app.talk_training.guard import GuardedTts
from app.telephony import inbound, persona, promises, tone
from app.telephony.plivo_outbound import PENDING, frame_goal
from tests.test_outbound_frame import GOAL, Spy, speak
from tests.test_ph_call import Call, parts_for
from tests.test_pl_inbound import OWNER
from tests.test_pl_outbound import placer

SCHOOL_GOAL = "Call the parent of Yash about his marks in maths; only a parent may hear this. Ask if he studies at home. Small ask: one hour of sitting with him every day."


def prompt(chosen: str, goal: str = SCHOOL_GOAL, name: str | None = None, gender: str | None = None) -> str:
    return persona.outbound_goal_prompt(business="Gowtham High School", assistant="Priya", language="te", goal=frame_goal(goal), tone=chosen, opening="x", person_name=name, person_gender=gender)


# ---------------------------------------------------------------------------------------------------------------------------------- 1 honorifics
def test_the_honorific_glued_to_a_latin_name_is_stripped_and_the_count_is_what_was_removed() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="friendly")
    said = speak(guard, spy, "మీరు Yashreddyగారి parents నా? Yashreddy గారి marks చూశారా?")
    assert "గారి" not in said and guard.honorifics_stripped == 2, (said, guard.honorifics_stripped)
    assert tone.soften("బంగారు చీర, సంగారెడ్డి", "friendly", "te") == "బంగారు చీర, సంగారెడ్డి"


def test_in_respectful_the_honorific_survives_only_after_the_addressed_persons_own_name() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful", addressed_name="Ramesh")
    said = speak(guard, spy, "Ramesh గారు, నమస్కారం. Yash గారి marks గురించి మాట్లాడొచ్చా?")
    assert "Ramesh గారు" in said and "Yash గారి" not in said and "Yash marks" in said
    assert guard.honorifics_stripped == 1, "only the one that was removed is counted; the kept one is not"
    nameless = GuardedTts(Spy(), [], goal_tone="respectful")
    assert "గారు" not in speak(nameless, cast_spy(nameless), "Ramesh గారు, నమస్కారం.") and nameless.honorifics_stripped == 1
    for other in ("friendly", "casual"):
        g = GuardedTts(Spy(), [], goal_tone=other, addressed_name="Ramesh")
        assert "గారు" not in speak(g, cast_spy(g), "Ramesh గారు, చెప్పండి."), other


def cast_spy(guard: GuardedTts) -> Spy:
    inner: Any = guard._inner  # noqa: SLF001
    return inner  # type: ignore[no-any-return]


# ---------------------------------------------------------------------------------------------------------------------------------- the addressing rules per tone
def test_sir_and_madam_are_allowed_only_in_respectful_with_a_known_gender_and_no_known_name_at_most_twice() -> None:
    spy = Spy()
    male = GuardedTts(spy, [], goal_tone="respectful", titles_gender="male")
    assert "sir" in speak(male, spy, "అవును sir, చెప్పండి.")
    assert "sir" in speak(male, spy, "సరే sir.")
    assert "sir" not in speak(male, spy, "ధర sir చెప్పలేను."), "the third is taken out"
    for chosen, gender in (("respectful", None), ("friendly", "male"), ("casual", "female")):
        g = GuardedTts(Spy(), [], goal_tone=chosen, titles_gender=gender)
        assert not re.search(r"sir|madam", speak(g, cast_spy(g), "అవును sir, చెప్పండి madam."), re.IGNORECASE), (chosen, gender)


def test_the_addressing_paragraph_follows_the_tone_the_name_and_the_gender() -> None:
    named = prompt("respectful", name="Ramesh")
    assert 'address them as "Ramesh గారు"' in named and "use no title (no sir, no madam)" in named and "మీ అబ్బాయి" in named
    unknown = prompt("respectful")
    assert "You do not know the person's name" in unknown and "the gender is not known" in unknown
    titled = prompt("respectful", gender="female")
    assert "madam" in titled and "at most twice" in titled
    friendly = prompt("friendly", name="Ramesh")
    assert "no \"గారు\", no sir, no madam" in friendly and "at most once" in friendly
    casual = prompt("casual")
    assert "నువ్వు" in casual and "no \"గారు\"" in casual
    assert tone.addressee_gender("Call his father about the marks") == "male" and tone.addressee_gender("Call the mother") == "female" and tone.addressee_gender(SCHOOL_GOAL) == "male" or tone.addressee_gender(SCHOOL_GOAL) is None
    assert tone.addressee_gender("Call the parent", "female") == "female" and tone.addressee_gender("Call the father and the mother") is None


# ---------------------------------------------------------------------------------------------------------------------------------- 2 the child
def test_a_child_is_never_called_వాడు_in_respectful_and_the_words_are_counted_and_flagged() -> None:
    plain = prompt("respectful", "Ask the parent about the child's marks in maths.")
    assert 'NEVER "వాడు"' in plain and "NAME only" in plain
    assert 'or "మీ అబ్బాయి"' in prompt("respectful", "Ask the parent about the marks of their son.") and 'or "మీ అమ్మాయి"' in prompt("respectful", "Ask about the marks of their daughter.")
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful")
    speak(guard, spy, "వాడు బాగా చదువుతున్నాడా? పిల్లవాడి marks చూశారా?")
    assert guard.child_terms == ["వాడు", "పిల్లవాడి"]

    class Line:
        child_terms = ["వాడు"]
        goal_tone = "respectful"

    assert inbound.bookish_numbers(Line())["child_terms_flag"] is True

    class Friendly(Line):
        goal_tone = "friendly"

    assert inbound.bookish_numbers(Friendly())["child_terms_flag"] is False, "flagged in Respectful only"
    for _name, line in [(n, ln) for n, ln in __import__("tests.test_outbound_frame", fromlist=["shipped_lines"]).shipped_lines() if n.endswith(".respectful")]:
        from app.agents import register

        assert register.child_terms_in("te", line) == [], line


# ---------------------------------------------------------------------------------------------------------------------------------- 3 who may hear it, 6 one gentle ask, 7 as the organisation, 9 closing
def test_the_hard_rules_cover_the_wrong_person_the_gentle_ask_speaking_as_the_school_and_the_closing() -> None:
    text = prompt("respectful")
    assert "WHO MAY HEAR IT" in text and "say NOTHING about why you called" in text and tone.ONLY_PARENTS_TE["respectful"] in text
    assert "ONE GENTLE ASK" in text and "ONE gentle, small ask" in text and "మీ సౌకర్యం ఎలాగో అలాగే ఉండండి" in text.split("NEVER drop the goal")[1][:200]
    assert "SPEAK AS THE ORGANISATION" in text and 'never send the person to "ask the school"' in text
    assert "ONE short closing line" in text and tone.CLOSE_TE["respectful"] in text and "ask them to repeat it ONCE instead of ending" in text
    for chosen in tone.TONES:
        assert "ask the school" not in " ".join(tone.EXAMPLES_TE[chosen]).lower() and "business ని నేరుగా" not in " ".join(tone.EXAMPLES_TE[chosen])
        assert tone.AS_THE_SCHOOL_TE[chosen] in prompt(chosen), "the owner's sample of speaking as the school is an example"
    assert promises.find(tone.AS_THE_SCHOOL_TE["respectful"]) is None and promises.find(tone.ONLY_PARENTS_TE["respectful"]) is None, "no promise in them"


def test_giving_up_the_goal_is_never_spoken() -> None:
    assert promises.find("సరే, మీ సౌకర్యం ఎలాగో అలాగే ఉండండి.") == "gives_up" and promises.find("Do as you please, just stay as you are.") == "gives_up"
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful")
    said = speak(guard, spy, "మీ సౌకర్యం ఎలాగో అలాగే ఉండండి.")
    assert "సౌకర్యం" not in said and said == tone.ACK_LINE_TE["respectful"] and guard.promises_blocked == 1
    assert promises.find("రోజూ ఒక గంట కూర్చోబెడితే చాలు, ప్రయత్నించండి.") is None, "the gentle ask itself is fine"


# ---------------------------------------------------------------------------------------------------------------------------------- 4 the same point, other words
def test_a_point_asked_again_in_other_words_is_caught_by_its_topic_tag_and_tags_are_never_spoken() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful")
    first = speak(guard, spy, "{q_parent} మీరు Yash కి parents నా?")
    assert first == "మీరు Yash కి parents నా?", "the tag is removed from what is spoken"
    n = len(spy.said)
    speak(guard, spy, "{q_parent} నేను మాట్లాడుతున్నది ఆయన తల్లిదండ్రులతోనేనా?")
    assert len(spy.said) == n and guard.repeats_blocked == 1, "the same point in other words is not spoken"
    assert speak(guard, spy, "{q_marks_home} ఇంట్లో చదువుతాడా?") == "ఇంట్లో చదువుతాడా?" and "{q_" not in spy.said[-1]
    assert "{q_" not in speak(guard, spy, "అవును. {q_x") and guard.repeats_blocked == 1, "a tag cut in pieces is never spoken"


def test_the_prompt_asks_for_the_tags_and_the_stored_transcript_never_shows_them() -> None:
    assert "{q_parent}" in prompt("friendly") and "NEVER a tag you already used" in prompt("friendly")
    from app.telephony.line import QUESTION_TAG

    assert QUESTION_TAG.sub("", "{q_parent} మీరు parents నా?") == "మీరు parents నా?"


# ---------------------------------------------------------------------------------------------------------------------------------- 5 goodbye ends the call
def test_a_goodbye_in_the_models_own_words_ends_the_call_and_no_check_in_or_second_goodbye_follows() -> None:
    from app.telephony.phone_llm import GOODBYE_AT_END

    for yes in ("సరే, thank you, bye!", "Okay, thank you, bye bye.", "సరే అండి, బై!", "Thanks, goodbye."):
        assert GOODBYE_AT_END.search(yes), yes
    for no in ("bye అని చెప్పొద్దు, ఇంకా చెప్పండి", "మీరు goodbye చెప్పక ముందే ఒక్కటి"):
        assert not GOODBYE_AT_END.search(no), no

    async def go() -> list[str]:
        call = await Call(parts_for("hmm okay", llm=FakeLlm(("సరే, ", "thank you, bye!")))).start()
        await call.after_opening()
        await call.say()
        out = await call.result(timeout=10)
        return [str(out.end_reason)] + [t["text"] for t in call.line.transcript if t["who"] == "assistant"]

    lines = asyncio.run(go())
    assert lines[0] in ("goodbye", "stopped"), lines
    assert not any("ఉన్నారా" in t for t in lines[1:]), "no 'are you there?' after the goodbye"
    assert sum(1 for t in lines[1:] if "bye" in t.lower()) == 1, "one goodbye"


# ---------------------------------------------------------------------------------------------------------------------------------- 8 particles
def test_the_polite_particle_is_counted_per_sentence_in_the_call_numbers() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful")
    speak(guard, spy, "నమస్కారం అండి. మీరు ఎలా ఉన్నారు? Marks గురించి మాట్లాడొచ్చా అండి? సరే.")
    assert (guard.particles, guard.sentences) == (2, 4)

    class Line:
        particles = (2, 4)

    got = inbound.bookish_numbers(Line())
    assert got["particles_total"] == 2 and got["sentences_total"] == 4 and got["particles_per_sentence"] == 0.5
    assert tone.particles_in("చెప్పండి") == 0, "the imperative ending is not the particle"


# ---------------------------------------------------------------------------------------------------------------------------------- the called person's name reaches the call
def test_the_called_persons_name_and_gender_travel_with_the_call() -> None:
    out, _, _ = placer()
    placed = out.place("t", __import__("uuid").uuid4(), OWNER, language="te", kind="goal", goal=GOAL, person_name="Ramesh", person_gender="male")
    assert PENDING.take_person(placed.call_id) == ("Ramesh", "male") and PENDING.take_person(placed.call_id) == (None, None)
