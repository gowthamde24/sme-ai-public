"""Phone calls, part 3: one call from the opening line to the finished row, against the simulator and fake speech parts (no account, no model, no network)."""

# ruff: noqa: E501
from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.session import Parts
from app.conversation.fakes import FakeLlm, FakeStt, FakeTts
from app.telephony import outcome, persona, triggers
from app.telephony.call_session import CallPlan, CallVoiceSession, run_call
from app.telephony.line import PhoneLine
from app.telephony.outcome import CallOutcome
from app.telephony.phone_llm import PhoneLlm
from app.telephony.simulator import QueueWire, SimulatedExotel
from tests.test_dv_browser_voice import arun, until

TENANT, CALL = uuid.uuid4(), uuid.uuid4()
OPENING = persona.opening_line("en", business="Sri Textiles", assistant=None, customer=None)


class FakeCallStore:
    def __init__(self, boom: bool = False) -> None:
        self.progress: list[tuple[uuid.UUID, str | None]] = []
        self.finished: list[tuple[uuid.UUID, CallOutcome, float]] = []
        self.boom = boom

    def mark_in_progress(self, call_id: uuid.UUID, provider_call_sid: str | None) -> None:
        self.progress.append((call_id, provider_call_sid))

    def finish(self, call_id: uuid.UUID, outcome: CallOutcome, duration_s: float) -> None:
        if self.boom:
            raise RuntimeError("database down")
        self.finished.append((call_id, outcome, duration_s))


def parts_for(text: str = "what time do you open?", llm: Any = None, language: str = "en") -> Parts:
    return Parts(stt_for=lambda lang: FakeStt(text, silence_ms=300), tts=FakeTts(chunks=3, chunk_ms=100), llm=llm or FakeLlm(("We open at nine. ", "Come any time.")), system_for=lambda lang: "system",
                 greeting_for=lambda lang: persona.opening_line(lang, business="Sri Textiles", assistant=None, customer=None), models={"fast": "fast-model", "strong": "ask"})


class Call:
    """A call in progress: the session task, the simulated telephone, the store."""

    def __init__(self, parts: Parts, plan: CallPlan | None = None, store: FakeCallStore | None = None, **kw: Any) -> None:
        self.store = store or FakeCallStore()
        self.parts, self.kw = parts, kw
        self.plan = plan or CallPlan(call_id=CALL, tenant_id=TENANT, direction="outbound", language="en", business="Sri Textiles", max_call_s=60)
        self.hooks: dict[str, int] = {"dnc": 0, "handover": 0}
        self.task: asyncio.Future[CallOutcome] | None = None
        self.line: PhoneLine
        self.sim: SimulatedExotel

    async def start(self) -> Call:
        ours, theirs = QueueWire.pair()
        self.sim = SimulatedExotel(theirs, pace=0)
        self.line = PhoneLine(ours, hang_up_wait_s=2.0)
        await self.sim.connect()
        assert await self.line.open(2.0) is not None

        def dnc() -> None:
            self.hooks["dnc"] += 1

        def handover() -> None:
            self.hooks["handover"] += 1

        self.task = asyncio.ensure_future(run_call(self.plan, self.line, self.parts, self.store, ledger=Ledger(Limits()), on_do_not_call=dnc, on_handover=handover, **self.kw))
        return self

    async def after_opening(self) -> None:
        """The caller can only be heard once the assistant has finished its opening line."""
        await until(lambda: any(t["who"] == "assistant" for t in self.line.transcript) and bool(self.sim.heard.marks), 5)
        await until(lambda: not self.line.playing(), 5)
        await asyncio.sleep(0.4)   # and for the session to start listening

    async def say(self, ms: int = 600) -> None:
        await self.sim.speak_for(ms)
        await self.sim.quiet_for(700)

    async def result(self, timeout: float = 8.0) -> CallOutcome:
        assert self.task is not None
        out = await asyncio.wait_for(self.task, timeout)
        await self.sim.close()
        return out


@arun
async def test_the_assistant_opens_by_saying_it_is_an_ai_and_the_call_is_recorded_as_a_transcript() -> None:
    call = await Call(parts_for()).start()
    await call.after_opening()
    assert call.line.transcript[0]["who"] == "assistant" and "AI" in call.line.transcript[0]["text"]
    await call.say()
    await until(lambda: sum(1 for t in call.line.transcript if t["who"] == "assistant") >= 2, 5)
    await call.sim.hang_up()
    out = await call.result()
    who = [t["who"] for t in out.transcript]
    assert who[:3] == ["assistant", "caller", "assistant"] and out.state == "completed" and out.end_reason == "caller_hung_up"
    assert not out.do_not_call and not out.handover
    assert len(call.store.finished) == 1 and call.store.progress == [(CALL, "CAsim0001")]


@arun
async def test_do_not_call_me_again_is_acknowledged_the_line_closed_and_the_number_flagged() -> None:
    call = await Call(parts_for("please do not call me again")).start()
    await call.after_opening()
    await call.say()
    out = await call.result()
    assert out.do_not_call and out.category == "do_not_call" and out.outcome == "negative" and call.hooks["dnc"] == 1
    assert persona.STOP_ACK["en"] in [t["text"] for t in out.transcript], "the assistant said it would not call again"
    assert out.end_reason == "goodbye"


@arun
async def test_key_2_means_stop_calling_and_key_1_means_a_person_should_call_back() -> None:
    call = await Call(parts_for("hmm")).start()
    await call.after_opening()
    await call.sim.press("2")
    out = await call.result()
    assert out.do_not_call and call.hooks["dnc"] == 1 and call.hooks["handover"] == 0
    call = await Call(parts_for("hmm")).start()
    await call.after_opening()
    await call.sim.press("1")
    out = await call.result()
    assert out.handover and not out.do_not_call and out.category == "call_back_later" and call.hooks["handover"] == 1 and persona.HANDOVER_ACK["en"] in [t["text"] for t in out.transcript]


@arun
async def test_a_voicemail_greeting_ends_the_call_and_is_recorded_as_voicemail() -> None:
    call = await Call(parts_for("the person you are calling is not available, please leave a message after the tone")).start()
    await call.after_opening()
    await call.say()
    out = await call.result()
    assert out.state == "voicemail" and out.outcome == "no_answer" and not out.do_not_call


@arun
async def test_the_leave_a_message_action_says_one_short_line_that_says_it_is_an_ai() -> None:
    plan = CallPlan(call_id=CALL, tenant_id=TENANT, direction="outbound", language="en", business="Sri Textiles", max_call_s=60, voicemail_action="leave_message")
    call = await Call(parts_for("leave a message after the beep"), plan).start()
    await call.after_opening()
    await call.say()
    out = await call.result()
    left = [t["text"] for t in out.transcript if "missed you" in t["text"]]
    assert out.state == "voicemail" and left and "AI" in left[0] and "Sri Textiles" in left[0]


@arun
async def test_the_longest_call_ends_it_politely_with_its_own_reason() -> None:
    plan = CallPlan(call_id=CALL, tenant_id=TENANT, direction="outbound", language="en", business="Sri Textiles", max_call_s=2)
    call = await Call(parts_for("hmm"), plan).start()
    out = await call.result(10)
    assert out.end_reason == "longest_call" and out.state == "completed"


@arun
async def test_a_call_nobody_speaks_in_ends_on_silence_and_says_nothing_was_said() -> None:
    call = await Call(parts_for("hmm")).start()
    await call.after_opening()
    await call.sim.quiet_for(100)
    await call.sim.hang_up()
    out = await call.result()
    assert out.outcome == "unclear" and not any(t["who"] == "caller" for t in out.transcript)


@arun
async def test_the_model_adds_a_summary_and_the_answers_but_never_to_a_stop_request() -> None:
    summarizer = FakeLlm(('{"summary": "Wants to visit on Saturday.", "outcome": "positive", "category": "visit_booked", "callback_at": null, "captured": {"visit_day": "Saturday"}}',))
    call = await Call(parts_for(), outcome_llm=summarizer, model="fast-model", today=lambda: "2026-11-02").start()
    await call.after_opening()
    await call.say()
    await until(lambda: sum(1 for t in call.line.transcript if t["who"] == "assistant") >= 2, 5)
    await call.sim.hang_up()
    out = await call.result()
    assert out.summary == "Wants to visit on Saturday." and out.category == "visit_booked" and out.outcome == "positive" and out.captured == {"visit_day": "Saturday"}
    asked = FakeLlm(("{}",))
    stop = await Call(parts_for("do not call me again"), outcome_llm=asked, model="fast-model").start()
    await stop.after_opening()
    await stop.say()
    out2 = await stop.result()
    assert out2.do_not_call and out2.summary is None and asked.models == [], "the model is not even asked about a stop request"


@arun
async def test_a_database_that_fails_at_the_end_does_not_break_the_call() -> None:
    call = await Call(parts_for(), store=FakeCallStore(boom=True)).start()
    await call.after_opening()
    await call.sim.hang_up()
    out = await call.result()
    assert out.state == "completed"


@arun
async def test_the_cost_is_the_started_minutes_at_the_configured_rate() -> None:
    assert outcome.cost_paise(0, 100) == 0 and outcome.cost_paise(1, 100) == 100 and outcome.cost_paise(60, 100) == 100 and outcome.cost_paise(61, 100) == 200 and outcome.cost_paise(90, 0) == 0


# ---- the persona, the honesty rules, the triggers, the outcome checks -------------------------------------------------------------------------


@arun
async def test_asked_whether_it_is_a_robot_the_honest_answer_comes_without_asking_the_model() -> None:
    inner = FakeLlm(("Of course I am a real person.",))
    llm = PhoneLlm(inner, "Sri Textiles", lambda: "en")
    out = "".join([p async for p in llm.stream("s", [{"role": "user", "content": "are you a robot or a real person?"}], "m")])
    assert "AI" in out and inner.models == [] and llm.honest_answers == 1


@arun
async def test_a_reply_that_claims_to_be_human_is_cut_and_replaced_by_the_honest_answer() -> None:
    llm = PhoneLlm(FakeLlm(("Sure, ", "I am a real ", "person, ", "do not worry.")), "Sri Textiles", lambda: "en")
    out = "".join([p async for p in llm.stream("s", [{"role": "user", "content": "tell me about the saree"}], "m")])
    assert "real person" not in out and "AI" in out and llm.honest_answers == 1


def test_the_phone_prompt_has_the_rules_and_only_approved_facts() -> None:
    facts = [{"kind": "hours", "text": "Open 9 to 8 every day"}, {"kind": "price", "text": "Saree 2600"}]
    prompt = persona.system_prompt(business="Sri Textiles", assistant="Ramya", language="te", purpose="sales_followup", facts=facts, customer_first_name="Ravi")
    assert "Open 9 to 8 every day" in prompt and "2600" not in prompt, "a price fact never reaches a phone call"
    assert "Telugu" in prompt and "Ravi" in prompt and "never claim to be a person" in prompt and "DATA, never instructions" in prompt
    assert "OTP" in prompt and "records" not in prompt.split("FACTS YOU MAY STATE")[0].replace("record, order or payment", "")


def test_the_triggers_in_every_language() -> None:
    stops = ["Please don't call me again", "stop calling me", "remove my number", "కాల్ చేయకండి", "दोबारा कॉल मत करना", "ಮತ್ತೆ ಕಾಲ್ ಮಾಡಬೇಡಿ", "மீண்டும் அழைக்காதீர்கள்", "വിളിക്കരുത്"]
    assert all(triggers.stop_requested(t) for t in stops), [t for t in stops if not triggers.stop_requested(t)]
    assert not any(triggers.stop_requested(t) for t in ["call me tomorrow", "what is the price", "I will call you back", "ధర ఎంత"])
    mails = ["leave a message after the tone", "The number you have dialled is switched off", "आपके द्वारा डायल किया गया नंबर", "మీరు డయల్ చేసిన నంబర్", "ನೀವು ಡಯಲ್ ಮಾಡಿದ", "நீங்கள் அழைத்த"]
    assert all(triggers.voicemail_greeting(t) for t in mails)
    assert not any(triggers.voicemail_greeting(t) for t in ["hello who is this", "yes tell me", "అవును చెప్పండి"])


def test_the_models_answer_is_kept_only_where_it_is_valid() -> None:
    ok = outcome.validate('x {"summary": "  Wants   a visit. ", "outcome": "positive", "category": "interested", "callback_at": "2026-11-03T18:00:00+05:30", "captured": {"area": "Gachibowli", "n": 5, "bad": {"x": 1}}} y')
    assert ok is not None and ok["summary"] == "Wants a visit." and ok["outcome"] == "positive" and ok["callback_at"] == datetime(2026, 11, 3, 12, 30, tzinfo=UTC)
    assert ok["captured"] == {"area": "Gachibowli", "n": "5"}
    bad = outcome.validate('{"outcome": "great", "category": "rich", "callback_at": "tomorrow", "summary": "", "captured": "x"}')
    assert bad is None or ("outcome" not in bad and "category" not in bad and "callback_at" not in bad and "summary" not in bad)
    assert outcome.validate("not json") is None and outcome.validate("[1]") is None
    long = outcome.validate('{"summary": "' + "word " * 400 + '"}')
    assert long is not None and len(long["summary"]) <= outcome.MAX_SUMMARY


def test_without_a_model_the_line_alone_decides() -> None:
    nobody = outcome.deterministic(answered=False, transcript=[], end_reason=None, voicemail=False, stop_requested=False, handover=False)
    assert nobody.state == "no_answer" and nobody.outcome == "no_answer"
    quiet = outcome.deterministic(answered=True, transcript=[{"who": "assistant", "text": "Hello"}], end_reason="silence", voicemail=False, stop_requested=False, handover=False)
    assert quiet.state == "completed" and quiet.outcome == "unclear" and quiet.end_reason == "silence"


@arun
async def test_the_phone_model_answers_the_fixed_cases_itself_and_tells_the_session() -> None:
    events: list[str] = []
    inner = FakeLlm(("model said this",))

    def llm(action: str = "hang_up") -> PhoneLlm:
        return PhoneLlm(inner, "Sri Textiles", lambda: "te", on_event=events.append, voicemail_action=action)

    async def ask(model: PhoneLlm, *texts: str) -> str:
        messages = [{"role": "user", "content": t} for t in texts]
        return "".join([p async for p in model.stream("s", messages, "m")])

    assert await ask(llm(), "దయచేసి మళ్ళీ కాల్ చేయకండి") == persona.STOP_ACK["te"] and events == ["stop"]
    events.clear()
    assert await ask(llm(), "leave a message after the tone") == "" and events == ["voicemail"]
    events.clear()
    assert "Sri Textiles" in await ask(llm("leave_message"), "leave a message after the tone") and events == ["voicemail"]
    events.clear()
    assert await ask(llm(), "hi", "tell me", "more", "leave a message after the tone") == "model said this" and events == [], "a mailbox greeting is only believed in the first lines"
    assert inner.models == ["m"], "the model was asked only for the ordinary turn"


def test_call_first_the_whatsapp_signal_is_only_asked_or_agreed() -> None:
    """Owner, 5 Nov 2026: the ONE signal that lets a WhatsApp go after a call is the customer's own request (asked) or yes when they could not talk (agreed)."""
    import json

    from app.telephony.outcome import prompt, validate

    asked = validate('{"summary": "Wants photos.", "outcome": "positive", "category": "interested", "captured": {"product": "silk"}, "whatsapp": "asked"}')
    assert asked is not None and asked["captured"] == {"product": "silk", "whatsapp": "asked"}
    agreed = validate('{"outcome": "unclear", "category": "call_back_later", "whatsapp": "agreed"}')
    assert agreed is not None and agreed["captured"] == {"whatsapp": "agreed"}
    for word in ("yes", "maybe", True, None):
        got = validate(json.dumps({"outcome": "positive", "category": "interested", "whatsapp": word, "captured": {"whatsapp": "asked"}}))
        assert got is not None and "whatsapp" not in got.get("captured", {}), "only the top-level asked/agreed counts; a captured key of that name is dropped"
    system, _ = prompt([{"who": "caller", "text": "send me photos on WhatsApp"}], "te", "2026-11-05")
    assert '"asked" ONLY' in system and "Never \"asked\" or \"agreed\" because the assistant mentioned WhatsApp" in system


# ---- the record of a call (owner, 7 Nov 2026) -----------------------------------------------------------------------------------------------
class _TurnLine:
    def __init__(self) -> None:
        self.transcript: list[dict[str, Any]] = []
        self.taken_over = False

    def elapsed(self) -> float:
        return 6.0

    add_turn = PhoneLine.add_turn
    translator = None


def _session_on(line: _TurnLine) -> Any:
    session: Any = CallVoiceSession.__new__(CallVoiceSession)
    session.socket = type("S", (), {"_line": line})()
    return session


def test_a_telugu_turn_streamed_in_pieces_is_one_line_and_a_barge_in_keeps_what_was_heard(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.browser_voice.session as S

    async def whole(self: Any, text: str, tm: Any) -> None:
        tm.spoken_text, tm.reply_text, tm.interrupted = "చెప్పండి అండీ, ఏం కావాలి?", "చెప్పండి అండీ, ఏం కావాలి?", False

    monkeypatch.setattr(S.VoiceSession, "_answer", whole)
    line = _TurnLine()
    asyncio.run(_session_on(line)._answer("హలో", SimpleNamespace()))
    assert line.transcript == [{"who": "assistant", "text": "చెప్పండి అండీ, ఏం కావాలి?", "t": 6.0}], "one line for the turn"

    async def cut(self: Any, text: str, tm: Any) -> None:
        line.transcript.append({"who": "caller", "text": "ఆగండి", "t": 7.0})   # they spoke over it
        tm.spoken_text, tm.reply_text, tm.interrupted = "చెప్పండి అండీ…", "చెప్పండి అండీ, ఏం కావాలి?", True

    monkeypatch.setattr(S.VoiceSession, "_answer", cut)
    line = _TurnLine()
    asyncio.run(_session_on(line)._answer("హలో", SimpleNamespace()))
    assert [t["text"] for t in line.transcript] == ["చెప్పండి అండీ…", "ఆగండి"], "what was heard, cut between words, before the words said over it"

    async def nothing_heard(self: Any, text: str, tm: Any) -> None:
        tm.spoken_text, tm.reply_text, tm.interrupted = "", "చెప్పండి", True

    monkeypatch.setattr(S.VoiceSession, "_answer", nothing_heard)
    line = _TurnLine()
    asyncio.run(_session_on(line)._answer("హలో", SimpleNamespace()))
    assert line.transcript == [], "cut before a word was heard: no line"


@arun
async def test_the_models_streaming_pieces_never_become_lines() -> None:
    plan = CallPlan(call_id=CALL, tenant_id=TENANT, direction="inbound", language="en", business="Sri Textiles", max_call_s=60, caller_ending="998")
    call = await Call(parts_for(llm=FakeLlm(("చ", "ెప్పండి", " అండీ."))), plan).start()
    await call.after_opening()
    await call.say()
    await until(lambda: sum(1 for t in call.line.transcript if t["who"] == "assistant") >= 2, 5)
    await call.sim.hang_up()
    out = await call.result()
    said = [t["text"] for t in out.transcript if t["who"] == "assistant"][1:]
    assert said == ["చెప్పండి అండీ."] and out.captured.get("caller_ending") == "998"


def test_the_summary_is_one_short_english_line_with_the_callers_name_when_they_gave_it() -> None:
    system, _ = outcome.prompt([{"who": "caller", "text": "హలో"}], "te", "2026-11-07")
    assert "at most 14 words in English" in system and "caller_name" in system and "ONLY when neither" in system
    got = outcome.validate('{"summary": "Asked about silk sarees, wants a visit", "outcome": "positive", "caller_name": " Ramesh  Kumar "}')
    assert got is not None and got["captured"] == {"name": "Ramesh Kumar"} and got["outcome"] == "positive"
    for bad in ('{"summary": "x", "caller_name": "98765"}', '{"summary": "x", "caller_name": "a@b.c"}', '{"summary": "x", "caller_name": null}'):
        assert "name" not in ((outcome.validate(bad) or {}).get("captured") or {}), bad


def test_the_prompt_tells_the_model_the_opening_was_said_and_writes_the_ai_assistant_word_in_script() -> None:
    opening = persona.opening_line("te", business="Stack19", assistant="Priya", customer=None, inbound=True)
    with_opening = persona.system_prompt(business="Stack19", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None, opening=opening)
    assert "ALREADY SAID" in with_opening and opening in with_opening and "Never introduce yourself" in with_opening
    assert "ALREADY SAID" not in persona.system_prompt(business="Stack19", assistant="Priya", language="te", purpose="inbound", facts=[], customer_first_name=None), "a call with no opening says nothing of it"
    assert 'Write "AI assistant" as "AI అసిస్టెంట్"' in with_opening and "leave a space between a Latin-letter word" in with_opening
    for lang, word in persona.AI_ASSISTANT_WORD.items():
        assert word.startswith("AI ") and word in persona.system_prompt(business="Stack19", assistant="Priya", language=lang, purpose="inbound", facts=[], customer_first_name=None), lang


def test_the_phone_parts_give_the_model_the_same_opening_the_caller_hears() -> None:
    from app.browser_voice.runtime import BrowserVoice
    from app.conversation.voices import default_config
    from app.telephony.inbound_routes import phone_parts

    bv: Any = BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(greeting=True), ledger=Ledger(Limits(greeting=True)), allowed_origins=(), client=httpx.AsyncClient())
    parts, _ = phone_parts(bv, "Stack19", "te", "haiku")
    heard = parts.greeting_for("te")
    assert heard and heard in parts.system_for("te") and "ALREADY SAID" in parts.system_for("te")


def test_a_latin_word_glued_to_a_telugu_word_gets_its_space_in_the_transcript_and_the_voice_text() -> None:
    from app.pronunciation.speech import SpeechText
    from app.text_spacing import space_scripts

    glued = "నమస్కారం అండీ, నేను Stack19 నుంచిAI assistant ని మాట్లాడుతున్నాను"
    assert space_scripts(glued) == "నమస్కారం అండీ, నేను Stack19 నుంచి AI assistant ని మాట్లాడుతున్నాను"
    assert space_scripts("నేను AI అసిస్టెంట్\u200cని") == "నేను AI అసిస్టెంట్\u200cని", "the zero-width joiner of an ending is left alone"
    assert space_scripts("2వ తేదీ") == "2వ తేదీ" and space_scripts("hello world") == "hello world"
    assert " AI " in SpeechText().prepare(glued, "te", "sarvam_v4")
    line: Any = PhoneLine.__new__(PhoneLine)
    line.transcript, line.translator = [], None
    line.add_turn(glued, index=0, t=1.0)
    assert line.transcript[0]["text"].count("నుంచి AI") == 1


@arun
async def test_the_last_turn_gets_its_english_even_when_the_caller_hangs_up_right_after() -> None:
    from app.telephony.translate import LineTranslator

    class English:
        async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> Any:
            await asyncio.sleep(0.2)   # a translation that is still on its way when the call ends
            yield "Tell me, what do you need?"

    call = await Call(parts_for(llm=FakeLlm(("చెప్పండి, ", "ఏం కావాలి?")))).start()
    call.line.translator = LineTranslator(English(), "fast")
    await call.after_opening()
    await call.say()
    await until(lambda: sum(1 for t in call.line.transcript if t["who"] == "assistant") >= 2, 5)
    await call.sim.hang_up()
    out = await call.result()
    last = [t for t in out.transcript if t["who"] == "assistant"][-1]
    assert last["text"] == "చెప్పండి, ఏం కావాలి?" and last.get("text_en") == "Tell me, what do you need?", "the final line has its English too"
