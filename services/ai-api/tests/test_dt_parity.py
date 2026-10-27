"""Job DT, competitor parity (landing-v2 job C1 part 2): each module's decisions with fake backends. Nothing dials, sends or stores."""

from __future__ import annotations

import re
from datetime import date, datetime

import pytest

from app.parity import (
    analysis,
    inbound,
    language,
    memory,
    numbers,
    results,
    tools,
    transfer,
    webhooks,
    widget,
)

FACTS = [("hours", "Open Monday to Saturday, 10 am to 7 pm."), ("location", "First floor above the bookshop, near Benz Circle."), ("faq", "Batches have at most 25 students and study material is included.")]


def test_a_inbound_answers_from_approved_facts_only_and_a_missed_call_gets_an_instant_whatsapp() -> None:
    assert inbound.answer_inbound("What are your timings?", FACTS).text == FACTS[0][1]
    assert inbound.answer_inbound("where is the address", FACTS).text == FACTS[1][1]
    assert inbound.answer_inbound("How many students in a batch, is study material included?", FACTS).intent == "faq"
    no_hours = inbound.answer_inbound("when do you open", [FACTS[1]])
    assert no_hours.text is None and no_hours.needs_human, "no approved fact, no invented answer"
    assert inbound.answer_inbound("I want to book a demo", FACTS).intent == "booking"
    assert inbound.answer_inbound("blah", FACTS).needs_human
    plan = inbound.missed_call_plan("Vidya Coaching", "Vijaya", in_calling_hours=True)
    assert "AI assistant" in plan.whatsapp and "Vidya Coaching" in plan.whatsapp and plan.callback_in_minutes == 5
    assert inbound.missed_call_plan("X", "Vijaya", in_calling_hours=False).callback_in_minutes == 0


def test_b_and_j_language_is_detected_from_the_script_and_a_switch_needs_two_turns_and_keeps_the_voice() -> None:
    samples = {"te": "నాకు రేపు రావాలి", "kn": "ನಾನು ನಾಳೆ ಬರುತ್ತೇನೆ", "ta": "நான் நாளை வருகிறேன்", "ml": "ഞാൻ നാളെ വരാം", "bn": "আমি কাল আসব", "hi": "मुझे कल आना है", "mr": "मला उद्या यायचे आहे", "en": "please send the details"}
    for lang, text in samples.items():
        assert language.detect_language(text) == lang, lang
    assert language.detect_language("ok") is None
    assert language.detect_language("Naku repu randi") == "en", "known limit: romanised Telugu or Hindi reads as Latin text; the speech recogniser's language tag is what a real call uses"
    assert language.detect_language("నాకు price కావాలి please send") == "te", "everyday mixing: the other script wins"
    assert language.switch_decision("en", ["te"], auto_switch=True).switched is False, "one stray sentence is not a switch"
    done = language.switch_decision("en", ["te", "te"], auto_switch=True)
    assert done.switched and done.language == "te" and done.voice_persona_changed is False
    assert language.switch_decision("en", ["te", "te"], auto_switch=False).switched is False


def test_c_caller_memory_is_a_short_brief_and_none_for_a_first_contact() -> None:
    assert memory.caller_brief([], []) is None
    brief = memory.caller_brief([{"kind": "call", "at": "2026-10-20", "summary": "Asked about 3 BHK in Gachibowli", "outcome": "interested"}, {"kind": "chat", "at": "2026-10-21", "summary": "Sent brochure"}], ["Send the price list on Friday"])
    assert brief is not None and "3 BHK" in brief and "interested" in brief and "Open promises: Send the price list" in brief and len(brief) <= memory.MAX_CHARS


def test_d_tools_book_send_look_up_and_the_webhook_tool_is_guarded() -> None:
    b = tools.FakeBackends()
    assert tools.book_slot(b, "2026-11-01", "11:00", "Ravi").ok and tools.book_slot(b, "2026-11-01", "11:00", "Ravi").result == "no_slot", "a slot is taken once"
    assert tools.send_whatsapp(b, "Here are the details").ok and b.sent == ["Here are the details"]
    assert tools.look_up(b, "price", "paver-60mm").result == "Rs 38 per piece" and tools.look_up(b, "price", "nothing").result == "not_found"
    ok = tools.webhook_tool(b, "https://api.example.test/hook", {"lead": 1}, resolved_ip="93.184.216.34")
    assert ok.ok and b.posted[-1][2] == tools.WEBHOOK_TIMEOUT_SECONDS
    for url, ip, want in (("http://a.test/x", "93.184.216.34", "bad_url"), ("https://a.test/x", "169.254.169.254", "blocked_address"), ("https://a.test/x", "10.0.0.5", "blocked_address"), ("https://a.test/x", "::1", "blocked_address"), ("https://a.test/x", "nonsense", "bad_url")):
        assert tools.webhook_tool(b, url, {}, resolved_ip=ip).result == want, (url, ip)
    assert len(b.posted) == 1, "a blocked call is never made"


def test_e_a_transfer_bridges_or_falls_back_to_a_hot_lead_handoff() -> None:
    class Bridge:
        def __init__(self, picks_up: bool) -> None:
            self.picks_up, self.rang = picks_up, 0

        def ring_and_bridge(self, phone: str, seconds: int) -> bool:
            self.rang += 1
            return self.picks_up

    assert transfer.transfer("+910000000001", True, Bridge(True)) == transfer.TransferOutcome("bridged", "connected")
    assert transfer.transfer("+910000000001", True, Bridge(False)) == transfer.TransferOutcome("handoff", "no_answer")
    quiet = Bridge(True)
    assert transfer.transfer("+910000000001", False, quiet) == transfer.TransferOutcome("handoff", "outside_hours") and quiet.rang == 0
    assert transfer.transfer(None, True, quiet).reason == "no_staff"


def test_f_results_are_classified_and_retried_by_the_owners_rules() -> None:
    S = results.Signals
    assert results.classify_call_result(S(answered=True, machine_detected=True)) == "voicemail"
    assert results.classify_call_result(S(sip_code=486)) == "busy" and results.classify_call_result(S(sip_code=503)) == "switched_off"
    assert results.classify_call_result(S(sip_code=404)) == "wrong_number" and results.classify_call_result(S()) == "no_answer" and results.classify_call_result(S(answered=True)) == "answered"
    rules = {"busy": results.Retry(2, 15), "no_answer": results.Retry(3, 60)}
    now = datetime(2026, 11, 2, 10, 0)
    assert results.next_attempt("busy", 0, rules, now) == datetime(2026, 11, 2, 10, 15)
    assert results.next_attempt("busy", 2, rules, now) is None, "the count is used up"
    assert results.next_attempt("switched_off", 0, rules, now) == datetime(2026, 11, 2, 11, 0), "switched off follows the no-answer rule"
    assert results.next_attempt("wrong_number", 0, rules, now) is None and results.next_attempt("answered", 0, rules, now) is None


def test_g_webhooks_are_signed_replay_checked_retried_and_keys_are_stored_only_as_hashes() -> None:
    body = webhooks.envelope("lead.outcome", "w1", {"lead": "l1", "outcome": "booked"}, event_id="e1", at="2026-11-02T10:00:00+05:30")
    sig = webhooks.sign("whsec_test", 1_800_000_000, body)
    assert webhooks.verify("whsec_test", 1_800_000_000, body, sig, now=1_800_000_100)
    assert not webhooks.verify("whsec_test", 1_800_000_000, body, sig, now=1_800_001_000), "too old"
    assert not webhooks.verify("other", 1_800_000_000, body, sig, now=1_800_000_100) and not webhooks.verify("whsec_test", 1_800_000_000, body + b" ", sig, now=1_800_000_100)
    with pytest.raises(ValueError):
        webhooks.envelope("lead.deleted", "w1", {}, event_id="e", at="t")
    assert [webhooks.retry_after(i) for i in range(6)] == [0, 60, 300, 1800, 7200, None]
    key, digest, prefix = webhooks.new_api_key("server-pepper")
    assert key.startswith("s19_") and prefix == key[:8] and webhooks.check_api_key(key, digest, "server-pepper") and not webhooks.check_api_key(key + "x", digest, "server-pepper") and key not in digest
    assert not webhooks.check_api_key(key, digest, "another-pepper"), "a copy of the table without the pepper checks nothing"
    csv_bytes = webhooks.leads_csv([{"lead_id": "1", "name": "=HYPERLINK(\"x\")", "phone": "+00 000 000 1", "source": "website_form"}])
    assert b"'=HYPERLINK" in csv_bytes and csv_bytes.startswith(b"lead_id,name")
    with pytest.raises(webhooks.NotConnected):
        webhooks.push_to_crm("zoho", [])
    with pytest.raises(ValueError):
        webhooks.push_to_crm("salesforce", [])


def test_h_numbers_rotate_skip_spam_flags_and_respect_the_channel_limit() -> None:
    pool = numbers.NumberPool([numbers.Number("+911"), numbers.Number("+912"), numbers.Number("+913", spam_flagged=True)], daily_ceiling=2, channels=2)
    first, second = pool.start_call(), pool.start_call()
    assert {first.e164, second.e164} == {"+911", "+912"} and pool.start_call() is None, "channels are full"  # type: ignore[union-attr]
    pool.end_call()
    assert pool.start_call() is not None
    pool.flag_spam("+911")
    assert pool.pick() is not None and pool.pick().e164 == "+912"  # type: ignore[union-attr]


def test_i_analysis_gives_summary_fields_sentiment_qa_and_retention() -> None:
    t = [("assistant", "Hello Ravi, I'm Vijaya, the AI assistant of Vidya Coaching. Do you have a minute?"), ("customer", "Yes, my son is in Class 10 and needs Maths. Please send the fees."), ("assistant", "Sure, I will send them. Which batch suits you?"), ("customer", "Evening is good, thank you"), ("assistant", "Thank you, have a nice day.")]
    a = analysis.analyse(t, {"class": re.compile(r"Class (\d+)")}, mention_ai_required=True)
    assert a.captured == {"class": "10"} and a.sentiment == "positive" and a.qa_score == 100 and "5 turns" in a.summary
    liar = analysis.analyse([("assistant", "Hello, I'm Vijaya."), ("customer", "are you real?"), ("assistant", "I'm a real person.")], {}, mention_ai_required=True)
    assert liar.qa_score < 60, "not saying AI and claiming to be human both cost points"
    assert analysis.keep_until(date(2026, 11, 1), 90) == date(2026, 1, 30).replace(year=2027) and analysis.keep_until(date(2026, 11, 1), 0) is None
    with pytest.raises(ValueError):
        analysis.keep_until(date(2026, 11, 1), 45)


def test_k_widget_sessions_are_signed_short_lived_and_tied_to_one_website() -> None:
    token = widget.make_session("s3", "w1", "https://shop.example", now=1_800_000_000)
    assert widget.read_session("s3", token, "https://shop.example", now=1_800_000_100) == "w1"
    assert widget.read_session("s3", token, "https://evil.example", now=1_800_000_100) is None, "another website cannot reuse it"
    assert widget.read_session("s3", token, "https://shop.example", now=1_800_000_000 + widget.TTL_SECONDS + 1) is None
    assert widget.read_session("other", token, "https://shop.example", now=1_800_000_100) is None and widget.read_session("s3", "garbage", "https://shop.example") is None
    assert widget.FakeMedia().greeting("Hello")["mode"] == "fake"
