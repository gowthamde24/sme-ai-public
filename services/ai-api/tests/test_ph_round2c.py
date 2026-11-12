"""Owner's report on call 2 (pushy uncle), 12 Nov 2026: a refusal is said at most twice and then the call closes (no "anything else?"), the written "ధన్యవాదాలు" is swapped for "థాంక్స్ అండి", Telugu-script loanwords go back to Latin letters, and the prompt always says who is calling."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from app.talk_training.guard import GuardedTts
from app.telephony import persona, tone


class Spy:
    sample_rate = 24000

    def __init__(self) -> None:
        self.said: list[str] = []

    def stream(self, text: str, language: str, *args: Any, **kwargs: Any) -> Any:
        self.said.append(text)

        async def gen() -> Any:
            yield b""

        return gen()


def speak(guard: GuardedTts, *sentences: str, language: str = "te") -> None:
    for s in sentences:
        guard.stream(s, language)


def test_the_written_thanks_is_swapped_for_what_people_say_and_loanwords_stay_in_latin_letters() -> None:
    for chosen, expected in (("respectful", "మీ సమయానికి థాంక్స్ అండి"), ("friendly", "మీ సమయానికి థాంక్స్ అండి"), ("casual", "మీ సమయానికి థాంక్స్")):
        spy = Spy()
        guard = GuardedTts(spy, [], goal_tone=chosen)
        speak(guard, "మీ సమయానికి ధన్యవాదాలు")
        assert spy.said == [expected], chosen
        assert guard.bookish_words == [] and guard.everyday_swaps == 1, "the bookish word is not spoken any more, so the metric no longer sees it"
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="respectful")
    speak(guard, "పేరెంట్స్ తో మాట్లాడొచ్చా? స్కూల్ లో మార్క్స్ చూశారా?")
    assert spy.said == ["parents తో మాట్లాడొచ్చా? school లో marks చూశారా?"]
    assert tone.everyday("బంగారు స్కూలు", "respectful", "te") == ("బంగారు స్కూలు", 0), "a longer Telugu word that contains a loanword spelling is left alone"
    assert tone.everyday("thanks", "respectful", "en") == ("thanks", 0), "only Telugu is touched"
    assert guard.said_lines == spy.said, "the transcript shows what was said"


def test_a_refusal_is_said_twice_in_different_words_then_the_short_close_and_the_line_is_told_to_hang_up() -> None:
    spy, calls = Spy(), []
    guard = GuardedTts(spy, [], goal_tone="respectful")
    guard.on_refusals_exhausted = lambda: calls.append(1)
    first, second = tone.ONLY_PARENTS_TE["respectful"], tone.ONLY_PARENTS_2_TE["respectful"]
    speak(guard, first, second, first, first, first)   # the five pushes of the round 2 call (the model repeated the first line)
    assert spy.said[0] == first and spy.said[1] == second, "twice, in different words"
    assert spy.said[2:] == [tone.REFUSED_CLOSE_TE["respectful"]] * 3 and "ఇంకేమైనా" not in " ".join(spy.said)
    assert calls == [1], "the hang-up is asked once"
    assert guard.refusals == 5


def test_a_refusal_in_the_models_own_words_is_counted_by_its_tag_and_the_tag_is_never_spoken() -> None:
    spy, calls = Spy(), []
    guard = GuardedTts(spy, [], goal_tone="friendly")
    guard.on_refusals_exhausted = lambda: calls.append(1)
    speak(guard, "{refusal} క్షమించండి, ఆ విషయం చెప్పలేను.", "{refusal} నేను చెప్పలేను అండి.", "{refusal} మళ్ళీ చెప్పలేను.")
    assert all("{" not in s for s in spy.said)
    assert spy.said[2] == tone.REFUSED_CLOSE_TE["friendly"] and calls == [1]


def test_no_anything_else_after_a_refusal_but_it_is_left_alone_before_one() -> None:
    spy, calls = Spy(), []
    guard = GuardedTts(spy, [], goal_tone="respectful")
    guard.on_refusals_exhausted = lambda: calls.append(1)
    speak(guard, tone.CLOSE_TE["respectful"])
    assert spy.said == [tone.CLOSE_TE["respectful"]] and calls == [], "a normal close (no refusal before) is untouched"
    speak(guard, tone.ONLY_PARENTS_TE["respectful"], tone.CLOSE_TE["respectful"])
    assert spy.said[-1] == tone.REFUSED_CLOSE_TE["respectful"] and calls == [1], "after a refusal the invitation becomes the plain close and the call ends"
    spy2 = Spy()
    english = GuardedTts(spy2, [], goal_tone="friendly")
    speak(english, tone.ONLY_PARENTS_EN, "Anything else you would like to say?", language="en")
    assert spy2.said == [tone.ONLY_PARENTS_EN, tone.REFUSED_CLOSE_EN]


def test_the_goal_prompt_always_says_who_is_calling_names_the_refusal_rule_and_the_latin_letters() -> None:
    text = persona.outbound_goal_prompt(business="Gowtham High School", assistant="Priya", language="te", goal="Call the parents of Yashreddy from Gowtham High School about marks", tone="respectful", opening="x", introduced_as="నేను Gowtham తరఫున AI assistant ని.")
    assert "WHO YOU ARE IS NEVER PRIVATE" in text and "in your first reply at the latest" in text
    assert "REFUSE AT MOST TWICE" in text and tone.ONLY_PARENTS_TE["respectful"] in text and tone.ONLY_PARENTS_2_TE["respectful"] in text and tone.REFUSED_CLOSE_TE["respectful"] in text
    assert "{refusal}" in text and "NEVER invite more questions after a refusal" in text
    assert "LATIN LETTERS FOR ENGLISH WORDS" in text and "థాంక్స్ అండి" in text
