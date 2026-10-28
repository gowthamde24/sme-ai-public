"""The streaming conversation loop (job natural-voice): clause cutting, routing, end-of-turn timing per language, the CI LATENCY EVAL (fake parts, a timing budget per component, and the streaming property), fillers,
barge-in. No socket, no key, no model: the fakes of app/conversation/fakes.py."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import statistics
import time
from typing import Any

import httpx
import pytest

from app.conversation.chunker import HARD_MAX, ClauseBuffer
from app.conversation.endpointing import EnergyEndpointer, endpoint_ms
from app.conversation.fakes import (
    FakeAudioSource,
    FakeLlm,
    FakePlayout,
    FakeStt,
    FakeTts,
    silence,
    tone,
)
from app.conversation.fillers import FILLERS, FillerBank
from app.conversation.parts import Session
from app.conversation.pipeline import Conversation
from app.conversation.providers import AnthropicStream, CartesiaStreamTts
from app.conversation.router import route


def run(coro: Any) -> Any:
    return asyncio.run(coro)


# ---- clause cutting ---------------------------------------------------------------------------------------------------------------------------------


def pieces(*deltas: str) -> list[str]:
    buf, out = ClauseBuffer(), []
    for d in deltas:
        out += buf.feed(d)
    return out + buf.flush()


def test_the_first_clause_goes_at_the_first_comma_and_later_ones_at_sentence_ends() -> None:
    got = pieces("హా అండీ, ", "ఆ saree రెండు వేల ఆరు వందలండీ, చాలా బాగుంది. ", "Photos పంపనా?")
    assert got == ["హా అండీ,", "ఆ saree రెండు వేల ఆరు వందలండీ, చాలా బాగుంది.", "Photos పంపనా?"]


def test_a_comma_in_a_later_sentence_does_not_cut() -> None:
    assert pieces("First one is done. ", "Second one, with a comma, is long enough to stay whole.") == ["First one is done.", "Second one, with a comma, is long enough to stay whole."]


def test_a_reply_with_no_mark_is_cut_at_a_space_before_100_characters_for_the_first_piece() -> None:
    long = "word " * 40
    out = pieces(long)
    assert len(out[0]) <= 100 and out[0].endswith("word")
    assert all(len(p) <= HARD_MAX for p in out)
    assert " ".join(out).split() == long.split()


def test_a_decimal_point_is_not_a_sentence_end_and_the_danda_is() -> None:
    assert pieces("It costs 2.5", " lakh. Fine.") == ["It costs 2.5 lakh.", "Fine."]
    assert pieces("సరే అండీ। ", "చూద్దాం") == ["సరే అండీ।", "చూద్దాం"]


def test_nothing_is_dropped_and_nothing_empty_is_sent() -> None:
    text = "Hmm… సరే అండీ! No problem. "
    out = pieces(*text)  # one character at a time
    assert all(out) and "".join(out).replace(" ", "") == text.replace(" ", "")


# ---- routing ----------------------------------------------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("said", ["ok", "అవును", "ఓకే సరే", "హలో", "हाँ जी", "ಹೌದು", "thanks"])
def test_yes_no_and_small_talk_go_to_the_fast_model(said: str) -> None:
    assert route(said) == "fast"


@pytest.mark.parametrize("said", ["ఆ saree ధర ఎంత?", "what is the price", "book a visit for Friday", "2 వేలు కదా", "कितना लगेगा", "ಬೆಲೆ ಎಷ್ಟು", "Can you tell me about the fee structure for the new batch starting in June please"])
def test_prices_bookings_numbers_and_long_questions_go_to_the_strong_model(said: str) -> None:
    assert route(said) == "strong"


# ---- end of turn ------------------------------------------------------------------------------------------------------------------------------------


def test_silence_that_ends_a_turn_is_300_to_450_ms_by_default_and_per_language() -> None:
    assert {lang: endpoint_ms(lang) for lang in ("te", "hi", "kn", "ta", "ml", "en")} == {"te": 350, "hi": 350, "kn": 380, "ta": 420, "ml": 420, "en": 300}
    assert all(300 <= endpoint_ms(lang) <= 450 for lang in ("te", "hi", "kn", "ta", "ml", "en"))
    assert endpoint_ms("te", 50) == 200 and endpoint_ms("te", 5000) == 800 and endpoint_ms("xx") == 350


def test_the_energy_detector_ends_the_turn_exactly_when_the_silence_is_long_enough() -> None:
    frames = [silence(20)] * 5 + [tone(20)] * 30 + [silence(20)] * 40
    events = EnergyEndpointer(silence_ms=350).run(frames)
    assert [e for _, e in events] == ["speech_start", "speech_end"]
    start, end = events[0][0], events[1][0]
    assert start == 5 + 5  # 120 ms of sound (6 frames; the sixth, index 10) confirms speech
    assert end == 35 + 18 - 1  # the 18th quiet frame after the last loud one (index 52) closes the turn: 18 x 20 ms is the first multiple of the frame at or over 350 ms


def test_a_short_noise_is_not_speech() -> None:
    assert EnergyEndpointer().run([tone(20)] * 3 + [silence(20)] * 40) == []


# ---- the latency eval (CI): fake parts, a budget per component ---------------------------------------------------------------------------------------

# the fakes wait exactly these long; the loop may add at most the SLACK on top of each (scheduler jitter on a busy CI machine included)
STT_FINAL, LLM_FIRST, LLM_GAP, TTS_FIRST = 0.03, 0.08, 0.12, 0.05
SLACK_MS = 60


def make(llm: FakeLlm | None = None, tts: FakeTts | None = None, playout: FakePlayout | None = None, **kw: Any) -> tuple[Conversation, FakeLlm, FakeTts, FakePlayout]:
    llm = llm or FakeLlm(first_token_delay=LLM_FIRST, gap=LLM_GAP)
    tts = tts or FakeTts(first_audio_delay=TTS_FIRST)
    playout = playout or FakePlayout()
    conv = Conversation(
        stt=FakeStt(final_delay=STT_FINAL), llm=llm, tts=tts, playout=playout, session=Session(system="s", language="te"), models={"fast": "fast-model", "strong": "strong-model"}, **kw
    )
    return conv, llm, tts, playout


def test_every_component_stays_inside_its_budget_and_the_first_audio_beats_the_end_of_the_reply() -> None:
    async def go() -> list[Any]:
        out = []
        for _ in range(7):
            conv, llm, tts, playout = make()
            tm = await conv.run_turn(FakeAudioSource())
            out.append((tm, llm, playout))
        return out

    runs = run(go())
    for tm, llm, playout in runs:
        assert tm.stt_final_ms is not None and STT_FINAL * 1000 <= tm.stt_final_ms <= STT_FINAL * 1000 + SLACK_MS
        assert tm.llm_first_token_ms is not None and LLM_FIRST * 1000 <= tm.llm_first_token_ms <= LLM_FIRST * 1000 + SLACK_MS
        assert tm.tts_first_audio_ms is not None and TTS_FIRST * 1000 <= tm.tts_first_audio_ms <= TTS_FIRST * 1000 + SLACK_MS
        # streaming: the first audio left after the first clause (LLM first token + TTS first audio), not after the whole reply (3 pieces with two gaps of 120 ms)
        assert tm.after_final_ms is not None and tm.after_final_ms <= (LLM_FIRST + TTS_FIRST) * 1000 + SLACK_MS
        assert tm.first_audio_at is not None and tm.done_at is not None
        assert (tm.done_at - tm.first_audio_at) * 1000 >= LLM_GAP * 1000  # the rest of the reply was still being written after the caller already heard audio
        assert llm.finished and playout.bytes_written > 0 and tm.clauses == 3
    totals = [tm.after_final_ms for tm, _, _ in runs if tm.after_final_ms is not None]
    assert statistics.median(totals) < 700 and max(totals) < 1200  # the product targets: p50 < 700 ms, p95 < 1.2 s


def test_the_first_clause_reaches_the_voice_before_the_model_finishes() -> None:
    async def go() -> tuple[list[str], bool]:
        conv, llm, tts, _ = make(llm=FakeLlm(first_token_delay=0.01, gap=0.15), tts=FakeTts())
        seen: list[str] = []
        original = tts.stream

        async def spy(text: str, language: str) -> Any:
            seen.append(text)
            if len(seen) == 1:
                assert not llm.finished  # the model is still writing when the voice gets the first clause
            async for chunk in original(text, language):
                yield chunk

        tts.stream = spy  # type: ignore[method-assign]
        await conv.run_turn(FakeAudioSource())
        return seen, llm.finished

    seen, finished = run(go())
    assert seen[0] == "హా అండీ," and finished


def test_the_voice_connection_is_opened_while_the_model_is_thinking() -> None:
    conv, _, tts, _ = make()
    run(conv.run_turn(FakeAudioSource()))
    assert tts.prewarmed == 1


def test_the_router_picks_the_model_and_the_history_grows() -> None:
    async def go() -> tuple[list[str], list[dict[str, str]]]:
        conv, llm, _, _ = make(llm=FakeLlm(), tts=FakeTts())
        conv.stt = FakeStt(text="ఓకే")
        await conv.run_turn(FakeAudioSource())
        conv.stt = FakeStt(text="ఆ saree ధర ఎంత?")
        await conv.run_turn(FakeAudioSource())
        return llm.models, conv.session.history

    models, history = run(go())
    assert models == ["fast-model", "strong-model"]
    assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"] and history[2]["content"] == "ఆ saree ధర ఎంత?"


# ---- fillers ----------------------------------------------------------------------------------------------------------------------------------------


def bank(language: str = "te", voice: str = "v") -> FillerBank:
    async def render(text: str) -> bytes:
        return silence(60)

    b = FillerBank(seed=1)
    run(b.prepare(language, voice, render))
    return b


def test_a_filler_in_the_same_voice_plays_when_the_model_is_slow_and_not_when_it_is_fast() -> None:
    async def go(first_token: float, b: FillerBank) -> bool:
        conv, _, _, playout = make(llm=FakeLlm(first_token_delay=first_token), tts=FakeTts(), fillers=b, voice="v", filler_after_ms=60)
        tm = await conv.run_turn(FakeAudioSource())
        if tm.filler_played:
            assert playout.writes[0][1] == len(silence(60))  # the filler is the FIRST thing on the line
        return tm.filler_played

    assert run(go(0.2, bank())) is True
    assert run(go(0.0, bank())) is False


def test_there_is_at_most_one_filler_per_turn_and_not_the_same_one_twice_in_a_row() -> None:
    b = bank()
    picks = [b.pick("te", "v") for _ in range(6)]
    assert all(p is not None for p in picks)
    texts = [p[0] for p in picks if p]
    assert all(a != b2 for a, b2 in zip(texts, texts[1:], strict=False))
    assert set(texts) <= set(FILLERS["te"])
    assert b.pick("te", "other-voice") is None  # a filler is only ever played in the voice it was rendered in


def test_every_language_has_fillers_and_they_are_short() -> None:
    assert set(FILLERS) == {"te", "hi", "kn", "ta", "ml", "en"}
    assert all(len(t) <= 20 for fs in FILLERS.values() for t in fs)


# ---- barge-in ---------------------------------------------------------------------------------------------------------------------------------------


def test_the_caller_can_interrupt_and_the_line_goes_quiet_within_200_ms_of_the_first_sound() -> None:
    # run the reply and the listener side by side
    async def both() -> tuple[float, float, Any, FakeLlm, FakePlayout, Any]:
        llm = FakeLlm(pieces=["One sentence is here. "] * 8, first_token_delay=0.0, gap=0.05)
        conv, llm, tts, playout = make(llm=llm, tts=FakeTts(chunks=10, chunk_gap=0.03, chunk_ms=100))
        reply = asyncio.ensure_future(conv.respond("ఆ saree ధర ఎంత?"))
        while not playout.writes:
            await asyncio.sleep(0.005)
        caller = FakeAudioSource(speech_ms=400, trailing_ms=0, pace=0.02)
        ms = await conv.watch_for_interrupt(caller.frames())
        tm = await reply
        assert caller.speech_started_at is not None and playout.stopped_at
        return (playout.stopped_at[-1] - caller.speech_started_at) * 1000, ms or -1, tm, llm, playout, conv

    heard_quiet_ms, interrupt_ms, tm, llm, playout, conv = run(both())
    assert heard_quiet_ms <= 200 + SLACK_MS and interrupt_ms >= 0  # the frames arrive every 20 ms, 100 ms of sound confirms speech: ~120 ms in all
    assert tm.interrupted and llm.cancelled and not llm.finished
    stop = playout.stopped_at[-1]
    assert all(t <= stop for t, _ in playout.writes)  # nothing at all reached the line after the stop
    assert not playout.active


def test_nothing_happens_when_there_is_nothing_to_interrupt() -> None:
    conv, _, _, _ = make()
    assert run(conv.interrupt()) is None


def test_a_cough_is_not_an_interruption() -> None:
    async def go() -> float | None:
        conv, _, _, playout = make(tts=FakeTts(chunks=6, chunk_gap=0.02))
        reply = asyncio.ensure_future(conv.respond("ఆ saree ధర ఎంత?"))
        while not playout.writes:
            await asyncio.sleep(0.005)

        async def frames() -> Any:
            for f in [tone(20)] * 3 + [silence(20)] * 5:  # 60 ms of noise
                yield f
                await asyncio.sleep(0.005)

        result = await conv.watch_for_interrupt(frames())
        await reply
        return result

    assert run(go()) is None


# ---- the real parts, against a fake network ----------------------------------------------------------------------------------------------------------


def test_the_model_stream_yields_the_text_pieces_and_a_failure_is_a_constant_code() -> None:
    sse = "\n".join(
        f"data: {json.dumps(e)}"
        for e in [
            {"type": "message_start"},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "హా "}},
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "అండీ"}},
            {"type": "message_stop"},
        ]
    )
    sent: dict[str, Any] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        sent["body"], sent["key"] = json.loads(req.content), req.headers.get("x-api-key")
        return httpx.Response(200, text=sse)

    async def go(status: int) -> list[str]:
        def h(req: httpx.Request) -> httpx.Response:
            return handler(req) if status == 200 else httpx.Response(status, text="secret provider text")

        client = httpx.AsyncClient(transport=httpx.MockTransport(h))
        return [d async for d in AnthropicStream("k", client=client).stream("sys", [{"role": "user", "content": "x"}], "m")]

    assert run(go(200)) == ["హా ", "అండీ"] and sent["body"]["stream"] is True and sent["body"]["model"] == "m" and sent["key"] == "k"
    with pytest.raises(Exception) as err:
        run(go(429))
    assert str(err.value) == "llm_http_429" and "secret" not in repr(err.value)


def test_the_cartesia_stream_yields_whole_samples_only() -> None:
    audio = bytes(range(10))

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        assert body["output_format"]["encoding"] == "pcm_s16le" and body["language"] == "te" and req.headers["x-api-key"] == "k"
        return httpx.Response(200, content=audio)

    async def go() -> bytes:
        tts = CartesiaStreamTts("k", voice_id="v", client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        return b"".join([c async for c in tts.stream("హా", "te")])

    assert run(go()) == audio and len(run(go())) % 2 == 0


def test_the_measuring_clock_is_the_loops_own() -> None:
    assert abs(Conversation(stt=FakeStt(), llm=FakeLlm(), tts=FakeTts(), playout=FakePlayout(), session=Session("s", "te"), models={"fast": "a", "strong": "b"}).clock() - time.perf_counter()) < 1.0


# ---- the speaking style of a call -------------------------------------------------------------------------------------------------------------------


def call_prompt(**kw: Any) -> str:
    from app.opening.prompt import call_system_prompt

    base: dict[str, Any] = {"business": "Lakshmi Sarees", "assistant": "Vijaya", "language": "te", "opening_line": "నమస్కారం అండీ, నేను విజయ, లక్ష్మి సారీస్ నుంచి.", "goal": "reply", "facts": ["Open 10 to 7."]}
    return call_system_prompt(**{**base, **kw})


def test_the_old_call_prompt_is_unchanged_when_no_speaking_style_is_given() -> None:
    plain = call_prompt()
    assert "HOW TO SOUND ON A CALL" not in plain and "HOW TO TALK" not in plain


@pytest.mark.parametrize("language", ["te", "hi", "kn", "ta", "ml", "en"])
def test_the_call_style_is_strict_short_one_filler_mirroring_and_never_a_list(language: str) -> None:
    prompt = call_prompt(language=language, speaking_style="everyday_mixed")
    for needle in ("At most 2 short sentences", "ONE question at a time", "at most ONE per turn", "Mirror the caller", "Never read out a list", "never digit by digit"):
        assert needle in prompt
    assert len(prompt.split("HOW TO SOUND ON A CALL")[1]) < 2400  # the block is paid for by the token on every turn


def test_the_assistant_is_not_told_to_announce_it_is_an_ai_unless_the_owners_switch_is_on_and_the_honesty_rule_is_always_there() -> None:
    from app.opening.honesty import HONESTY_RULE

    off = call_prompt(speaking_style="everyday_mixed", mention_ai=False)
    on = call_prompt(speaking_style="everyday_mixed", mention_ai=True)
    assert "Do NOT say that you are an AI assistant on your own" in off and "answer truthfully" in off
    assert "already told the caller you are an AI assistant" in on and "Do NOT say that you are an AI assistant on your own" not in on
    assert HONESTY_RULE in off and HONESTY_RULE in on and HONESTY_RULE in call_prompt()


def test_the_owner_set_opening_line_is_in_the_prompt_unchanged() -> None:
    opening = "నమస్కారం అండీ, నేను విజయ, లక్ష్మి సారీస్ నుంచి."
    assert f"Your opening line was: {opening}" in call_prompt(speaking_style="everyday_mixed", opening_line=opening)


def test_the_model_is_told_not_to_think_first_and_the_between_tools_form_is_tried_when_it_asks_for_it() -> None:
    from app.conversation.providers import SarvamChatStream

    bodies: list[dict[str, Any]] = []
    delta = f"data: {json.dumps({'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': 'సరే'}})}"

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        bodies.append(body)
        if body["thinking"]["type"] == "disabled":
            return httpx.Response(400, text='send "thinking": {"type": "between_tools"} instead')
        return httpx.Response(200, text=delta)

    async def go() -> list[str]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        return [d async for d in AnthropicStream("k", client=client).stream("s", [{"role": "user", "content": "x"}], "m")]

    assert run(go()) == ["సరే"] and [b["thinking"]["type"] for b in bodies] == ["disabled", "between_tools"]

    chat = "\n".join(["data: " + json.dumps({"choices": [{"delta": {"content": "హా "}}]}), "data: " + json.dumps({"choices": [{"delta": {}}]}), "data: " + json.dumps({"choices": [{"delta": {"content": "అండీ"}}]}), "data: [DONE]"])

    async def go2() -> list[str]:
        client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, text=chat) if req.headers.get("api-subscription-key") == "k" else httpx.Response(401)))
        return [d async for d in SarvamChatStream("k", client=client).stream("s", [{"role": "user", "content": "x"}], "sarvam-105b")]

    assert run(go2()) == ["హా ", "అండీ"]


def test_the_first_sound_counts_the_filler_and_the_first_audio_does_not() -> None:
    from app.conversation.parts import TurnTimings

    tm = TurnTimings(end_of_speech_at=1.0, first_audio_at=2.5, filler_at=1.7)
    assert tm.first_sound_ms == pytest.approx(700) and tm.total_ms == pytest.approx(1500)
    assert TurnTimings(end_of_speech_at=1.0, first_audio_at=1.4).first_sound_ms == pytest.approx(400)
