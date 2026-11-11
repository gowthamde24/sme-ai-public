"""The outbound GOAL call frame (owner, 11 Nov 2026, after his brother's test calls). Fakes only: no model is asked, nobody is dialled.

Proven: an outbound goal call does NOT run on the inbound enquiry persona; the hard rules sit above the goal; nothing in what we ship invites or contains a promise the assistant cannot keep (a scan over every fixed line and every prompt, in
every tone and language); a spoken line that promises is replaced by a true one before the voice speaks it; the tone is chosen by code (casual only on the Owner's own test call, never on a Lead Desk call) and changes the register,
the fixed lines and what is spoken; every tone's opening says it is an AI."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import re
from types import SimpleNamespace
from typing import Any, cast

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.runtime import BrowserVoice
from app.conversation.fakes import FakeTts
from app.conversation.voices import default_config
from app.opening.honesty import claims_to_be_human
from app.talk_training.guard import GuardedTts
from app.tasks.dialer import OPENERS
from app.telephony import gate, persona, promises, tone
from app.telephony.inbound_routes import OutboundCall, phone_parts
from app.telephony.plivo_outbound import (
    GOAL_FRAME,
    PENDING,
    TEST_GOAL,
    TEST_OPENING,
    frame_goal,
    opening_for,
)
from tests.test_pl_inbound import OWNER
from tests.test_pl_outbound import placer

LANGS = ("en", "te", "hi", "kn")
GOAL = "Ask whether the saree stock arrived this week and whether they want the new catalogue photos."
INVITES = ("say the team will", "the team will do it", "note exactly", "will call them back", "get back to them", "will confirm the visit", "offers to pass on")


def voice() -> Any:
    return BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(greeting=True),
                        ledger=Ledger(Limits(greeting=True)), allowed_origins=(), client=cast(Any, SimpleNamespace()))


def goal_prompt(language: str = "te", chosen: str = "friendly", goal: str = GOAL) -> str:
    call = OutboundCall(row_id=__import__("uuid").uuid4(), language=language, purpose="visit_reminder", goal=frame_goal(goal), opening_line=opening_for("goal", language, chosen), tone=chosen)
    parts, _ = phone_parts(voice(), "Padma Silks", language, "haiku", None, outbound=call)
    return str(parts.system_for(language))


# ---------------------------------------------------------------------------------------------------------------------------------- not the enquiry persona
def test_an_outbound_goal_call_has_its_own_prompt_with_the_hard_rules_above_everything_else() -> None:
    text = goal_prompt()
    assert "HARD RULES" in text and text.index("THE GOAL OF THIS CALL") < text.index("HARD RULES") < text.index("LANGUAGES:") < text.index("TONE:"), "the goal, then the rules, then how to talk"
    for must in ("NEVER promise or hint at any action", "NO PERSONAL DATA", "NO EXTRAS", "FINISH THE GOAL FIRST", "HONESTY", "Never guess who the person is"):
        assert must in text, must
    assert "approved facts" not in text.lower() and "EXAMPLES of how calls in this language sound" not in text, "no enquiry-call examples, no facts block"
    inbound = persona.system_prompt(business="Padma Silks", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None)
    assert "HARD RULES" not in inbound and "say the team will" in inbound, "the inbound persona is unchanged"


def test_nothing_that_goes_to_the_model_on_a_goal_call_invites_a_promise() -> None:
    for language in LANGS:
        for chosen in tone.TONES:
            text = goal_prompt(language, chosen).lower()
            for phrase in INVITES:
                assert phrase not in text, (language, chosen, phrase)
    assert not any(p in GOAL_FRAME.lower() for p in INVITES) and "nobody will call the person afterwards" in GOAL_FRAME, "the frame I wrote on 10 Nov told the model to promise; now it says the opposite"
    assert not any(p in TEST_GOAL.lower() for p in INVITES)


# ---------------------------------------------------------------------------------------------------------------------------------- the scan: nothing we SAY is a promise
def shipped_lines() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for name in ("OPENERS_TE", "OPENERS_EN", "HONEST_TE", "HONEST_EN", "CHECK_IN_TE", "BYE_TE", "BYE_EN", "INTERRUPTED_TE", "ACKS_TE", "CANT_TE", "QUESTION_TE", "ACK_LINE_TE"):
        out += [(f"tone.{name}.{k}", v) for k, v in getattr(tone, name).items()]
    out += [("tone.CANT_EN", tone.CANT_EN), ("TEST_OPENING", TEST_OPENING["en"])]
    out += [(f"tone.EXAMPLES_TE.{k}", line) for k, lines in tone.EXAMPLES_TE.items() for line in lines]
    out += [(f"promises.SAFE.{lang}.{k}", v) for lang, d in promises.SAFE.items() for k, v in d.items()]
    out += [(f"OPENERS.{lang}", v) for lang, v in OPENERS.items()]
    return out


def test_no_fixed_line_we_ship_for_goal_calls_is_a_promise() -> None:
    lines = shipped_lines()
    assert len(lines) > 40
    for name, line in lines:
        assert promises.find(line) is None, (name, line)


def test_the_scan_catches_the_real_sentences_from_the_test_calls() -> None:
    caught = {
        "As soon as this call ends I will give your number to our team and they will talk to you.": {"callback", "pass_on"},
        "I'll note that down.": {"note"},
        "My team will call you tomorrow.": {"callback"},
        "Should they call this number?": {"ask_number"},
        "I will arrange a visit for you.": {"arrange"},
        "ఈ call ముగిసిన వెంటనే మా టీమ్ మీకు call చేస్తారు": {"callback"},
        "సరే, నేను note చేసుకుంటాను": {"note"},
        "మీ number మా టీమ్ కి ఇస్తాను": {"pass_on", "callback"},
        "ఈ number కి call చేయమంటారా?": {"ask_number"},
        "हमारी टीम आपको कॉल करेगी": {"callback"},
        "ನಮ್ಮ ಟೀಮ್ ನಿಮಗೆ ಕಾಲ್ ಮಾಡ್ತಾರೆ": {"callback"},
    }
    for sentence, kinds in caught.items():
        assert promises.find(sentence) in kinds, sentence
    for fine in ("Have you looked at this month's stock?", "We have silk sarees in stock.", "I can't arrange that on this call, you can ask the business directly.", "నువ్వు ఈ నెల stock గురించి ఏమైనా చూశావా?", "సరే, thank you, bye!"):
        assert promises.find(fine) is None, fine


# ---------------------------------------------------------------------------------------------------------------------------------- what is spoken
class Spy:
    sample_rate = 24000

    def __init__(self) -> None:
        self.said: list[str] = []

    async def stream(self, text: str, language: str, *a: Any, **k: Any):  # type: ignore[no-untyped-def]
        self.said.append(text)
        yield b"\x00\x00"


def speak(guard: GuardedTts, spy: Spy, text: str, language: str = "te") -> str:
    async def go() -> None:
        async for _ in guard.stream(text, language):
            pass

    asyncio.run(go())
    return spy.said[-1]


def test_a_sentence_that_promises_is_replaced_by_a_true_line_and_never_spoken_on_a_goal_call() -> None:
    spy = Spy()
    guard = GuardedTts(spy, [], goal_tone="friendly")
    assert speak(guard, spy, "ఈ call ముగిసిన వెంటనే మా టీమ్ మీకు call చేస్తారు") == promises.SAFE["te"]["friendly"]
    assert speak(guard, spy, "I'll note that down.", "en") == promises.SAFE["en"]["friendly"]
    assert speak(guard, spy, "హలో, మీరు ఈ నెల stock చూశారా?") == "హలో, మీరు ఈ నెల stock చూశారా?", "a sentence without a promise is spoken as it is"
    assert guard.promises_blocked == 2
    plain = GuardedTts(Spy(), [])
    inner = cast(Spy, plain._inner)  # noqa: SLF001
    assert speak(plain, inner, "ఈ call ముగిసిన వెంటనే మా టీమ్ మీకు call చేస్తారు") == "ఈ call ముగిసిన వెంటనే మా టీమ్ మీకు call చేస్తారు", "the inbound calls (a real hand-over exists there) are not touched"


def test_a_never_say_hit_on_a_goal_call_is_not_answered_with_i_will_check_with_the_team() -> None:
    spy = Spy()
    guard = GuardedTts(spy, ["discount"], goal_tone="friendly")
    said = speak(guard, spy, "We can give you a discount.", "en")
    assert said == promises.SAFE["en"]["friendly"] and promises.find(said) is None


def test_garu_is_taken_out_in_friendly_and_casual_and_andi_too_in_casual() -> None:
    spy = Spy()
    assert speak(GuardedTts(spy, [], goal_tone="friendly"), spy, "రమేష్ గారు, ఉందండీ.") == "రమేష్, ఉందండీ."
    assert "గారు" not in speak(GuardedTts(spy, [], goal_tone="casual"), spy, "రమేష్ గారు, చెప్పండి.")
    casual = speak(GuardedTts(spy, [], goal_tone="casual"), spy, "సరేనండీ, ఉందండీ. అవునండీ.")
    assert "అండీ" not in casual and "అండి" not in casual and casual.startswith("సరే, ఉంది. అవును"), casual
    assert speak(GuardedTts(spy, [], goal_tone="respectful"), spy, "రమేష్ గారు, ఉందండీ.") == "రమేష్ గారు, ఉందండీ.", "respectful is left as it is"


# ---------------------------------------------------------------------------------------------------------------------------------- the tone
def test_a_casual_goal_selects_casual_and_a_friendly_or_empty_goal_does_not() -> None:
    assert tone.tone_from_goal("Talk like a close friend, casual Telugu, never andi.") == "casual"
    assert tone.tone_from_goal("speak informally") == "casual" and tone.tone_from_goal("like a friend") == "casual"
    assert tone.tone_from_goal("Be friendly and brief.") == "friendly", "'friendly' is the default tone, not casual"
    assert tone.tone_from_goal("Be respectful and formal") == "respectful" and tone.tone_from_goal(None) == "friendly" and tone.tone_from_goal("") == "friendly"
    assert tone.tone_from_goal("casual but respectful") == "respectful", "when both are asked, the careful one wins"


def test_a_casual_goal_changes_the_register_of_the_prompt() -> None:
    casual, friendly, respectful = (goal_prompt("te", t) for t in ("casual", "friendly", "respectful"))
    assert "నువ్వు" in casual and "నువ్వు" not in friendly and "నువ్వు" not in respectful
    assert "polite particle 'అండీ' in most sentences" in respectful and "in most sentences" not in casual and "in most sentences" not in friendly
    for chosen, text in (("casual", casual), ("friendly", friendly)):
        examples = text.split("Examples of this tone")[1].split("ADDRESSING")[0]
        assert "అండీ" not in examples and "గారు" not in examples, f"no example in {chosen} pushes the particle"
    assert "సరే అండీ, bye" not in casual and "సరే అండీ, bye" not in friendly, "the example goodbye follows the tone too"
    assert casual != friendly != respectful


def test_every_tone_opening_says_it_is_an_ai_and_passes_the_gate_check() -> None:
    for language in ("te", "en", "hi", "kn", "ta", "ml"):
        for chosen in tone.TONES:
            line = (opening_for("goal", language, chosen) or "").replace("{business}", "Padma Silks").replace("{assistant}", "Priya")
            assert gate.has_ai_disclosure(line), (language, chosen, line)
            assert "{" not in line
    assert opening_for("goal", "te", "casual") != opening_for("goal", "te", "respectful")
    for chosen in tone.TONES:
        for language in ("te", "en"):
            honest = tone.honest_line(language, chosen)
            assert honest is not None and "AI assistant" in honest and not claims_to_be_human(honest) and promises.find(honest) is None


def test_casual_is_only_for_the_owners_own_test_call_never_a_lead_desk_task_call() -> None:
    out, _, _ = placer()
    for asked, owner_test, expected in (("casual", True, "casual"), ("casual", False, "friendly"), ("respectful", False, "respectful"), (None, False, "friendly"), (None, True, "friendly"), ("nonsense", True, "friendly")):
        placed = out.place("t", __import__("uuid").uuid4(), OWNER, language="te", kind="goal", goal=GOAL, tone=asked, owner_test=owner_test)
        assert PENDING.take_tone(placed.call_id) == expected, (asked, owner_test)
    assert tone.for_task_call("casual") == "friendly"


def test_the_owner_route_picks_the_tone_from_the_goal_and_a_task_call_never_does() -> None:
    from tests.fakes import TENANT_A, auth, make_client
    from tests.test_pl_outbound import outbound_service

    out, repo, api = placer()
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc)
    r = client.post(f"/v1/tenants/{TENANT_A.id}/calls/place", json={"to": OWNER, "language": "te", "goal": "Talk like a close friend, casual Telugu, ask about the stock."}, headers=auth("a_owner"))
    assert r.status_code == 202, r.text
    call_id = __import__("uuid").UUID(r.json()["call_id"])
    assert PENDING.take_tone(call_id) == "casual"
    from app.telephony.plivo_tasks import PlivoTaskDialer

    assert "owner_test" not in re.sub(r"\s+", " ", __import__("inspect").getsource(PlivoTaskDialer)), "the Lead Desk dialer never passes owner_test, so it can never be casual"
