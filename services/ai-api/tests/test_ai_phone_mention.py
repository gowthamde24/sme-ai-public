"""Job AI (owner, 10-11 Nov 2026): the "mention that I'm an AI assistant in the greeting" switch reaches the PHONE path of an INBOUND call.

Pinned: the switch is ON by default and whenever it cannot be read; OFF changes the opening only in a language whose plain opening a native speaker has reviewed (English first), every other language is LOCKED ON;
the honest-answer rule is in the prompt whatever the switch says, and a plain opening adds a second, explicit rule; the call row stores whether the opening really said it was an AI; a call WE place
always says it (the switch does not touch it, and the gate still refuses an opening without it)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.browser_voice.limits import Ledger, Limits
from app.browser_voice.runtime import BrowserVoice
from app.conversation.fakes import FakeTts
from app.conversation.voices import default_config
from app.telephony import gate, persona
from app.telephony.inbound_routes import InboundService, OutboundCall, _prepare_for, phone_parts
from app.telephony.inbound_store import InboundStore
from tests.test_dv_browser_voice import arun
from tests.test_ph_inbound import FakeStore

TENANT = uuid.UUID(int=0x0B0F)
TRAINED = "Namaste! Welcome to {business}. This is {assistant}. How can I help you?"   # a trained greeting that does not say it is an AI


def voice() -> Any:
    return BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(greeting=True),
                        ledger=Ledger(Limits(greeting=True)), allowed_origins=(), client=cast(Any, SimpleNamespace()))


def opening(language: str, mention: bool, greeting: str | None = None) -> str:
    return persona.opening_line(language, business="Padma Silks", assistant=None, customer=None, inbound=True, greeting=greeting, mention_ai=mention)


# ---------------------------------------------------------------------------------------------------------------------------------- the opening
def test_on_is_what_it_always_was_and_off_gives_the_reviewed_plain_english_opening() -> None:
    standard = persona.INBOUND_OPENING["en"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    assert opening("en", True) == standard and gate.has_ai_disclosure(standard)
    plain = opening("en", False)
    assert plain == "Hello, this is Priya from Padma Silks. How can I help you?" and not gate.has_ai_disclosure(plain)


def test_off_uses_the_trained_greeting_as_it_is_and_on_still_puts_the_ai_mention_first() -> None:
    filled = TRAINED.replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    assert opening("en", False, TRAINED) == filled
    on = opening("en", True, TRAINED)
    assert on.startswith(persona.first_sentence(persona.INBOUND_OPENING["en"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT))) and on.endswith(filled)


@pytest.mark.parametrize("language", ["te", "hi", "kn", "ta", "ml", "mr"])
def test_a_language_without_a_reviewed_plain_opening_stays_on_whatever_the_switch_says(language: str) -> None:
    assert persona.mention_ai_applies(language, False) is True
    assert opening(language, False) == opening(language, True) and gate.has_ai_disclosure(opening(language, False))
    assert gate.has_ai_disclosure(persona.first_sentence(opening(language, False, "నమస్కారం, చెప్పండి.")))


def test_the_switch_never_touches_a_call_we_place() -> None:
    placed = persona.opening_line("en", business="Padma Silks", assistant=None, customer=None, owner_line=None, inbound=False, mention_ai=False)
    assert gate.has_ai_disclosure(placed), "a call WE place always says it is an AI"


# ---------------------------------------------------------------------------------------------------------------------------------- the model's rules
def prompt(mention: bool, language: str = "en") -> str:
    parts, _ = phone_parts(voice(), "Padma Silks", language, "haiku", None, mention_ai=mention)
    return parts.system_for(language)


@pytest.mark.parametrize("mention", [True, False])
def test_the_honest_answer_rule_is_in_the_prompt_whatever_the_switch_says(mention: bool) -> None:
    system = prompt(mention)
    assert "you say so at once if asked; never claim to be a person, never deny being an AI" in system
    assert persona.HONEST_AI["en"] in system


def test_a_plain_opening_adds_a_second_explicit_rule_and_an_ai_opening_does_not() -> None:
    off, on = prompt(False), prompt(True)
    assert "did NOT say that you are an AI" in off and "the business's AI assistant" in off and "This rule never changes" in off
    assert "did NOT say that you are an AI" not in on
    locked = prompt(False, "te")
    assert "did NOT say that you are an AI" not in locked, "a locked language still opened with the AI mention"


# ---------------------------------------------------------------------------------------------------------------------------------- from the store, the way the phone server prepares a call
class SwitchStore(FakeStore):
    def __init__(self, switch: Any = True, training: Any = None, *, raises: bool = False) -> None:
        super().__init__()
        self._switch, self._training, self._raises = switch, training, raises

    def mention_ai(self, tenant_id: uuid.UUID) -> Any:
        if self._raises:
            raise RuntimeError("database down")
        return self._switch

    def talk_training(self, tenant_id: uuid.UUID) -> Any:
        return self._training


def service(store: SwitchStore, language: str = "en") -> InboundService:
    return InboundService(secret=b"s" * 48, public_base="https://api.example.test", gate_settings=gate.Settings(mode="sandbox", outbound=False), store=cast(Any, store), calls=None, cost_paise_per_minute=100,
                          language=language, business="Stack19 Owner Test")


@arun
async def test_the_call_is_prepared_with_the_workspaces_switch_and_the_row_will_say_what_was_really_said() -> None:
    off = await _prepare_for(service(SwitchStore(False)), voice(), TENANT, business="Padma Silks")
    assert off.text == "Hello, this is Priya from Padma Silks. How can I help you?" and off.ai_disclosed is False
    on = await _prepare_for(service(SwitchStore(True)), voice(), TENANT, business="Padma Silks")
    assert on.ai_disclosed is True and gate.has_ai_disclosure(on.text or "")


@arun
async def test_off_on_a_locked_language_still_says_it_and_is_stored_as_disclosed() -> None:
    prepared = await _prepare_for(service(SwitchStore(False), "te"), voice(), TENANT, business="Padma Silks")
    assert prepared.ai_disclosed is True and gate.has_ai_disclosure(prepared.text or "")


@arun
async def test_an_unreadable_or_unclear_switch_is_on() -> None:
    for store in (SwitchStore(raises=True), SwitchStore(None), SwitchStore("maybe")):
        prepared = await _prepare_for(service(store), voice(), TENANT, business="Padma Silks")
        assert prepared.ai_disclosed is True and gate.has_ai_disclosure(prepared.text or "")


@arun
async def test_a_trained_greeting_without_the_mention_is_spoken_as_it_is_when_off_and_flagged_not_disclosed() -> None:
    prepared = await _prepare_for(service(SwitchStore(False, {"greeting": {"en": TRAINED}})), voice(), TENANT, business="Padma Silks")
    assert prepared.text == TRAINED.replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT) and prepared.ai_disclosed is False
    again = await _prepare_for(service(SwitchStore(True, {"greeting": {"en": TRAINED}})), voice(), TENANT, business="Padma Silks")
    assert again.ai_disclosed is True


# ---------------------------------------------------------------------------------------------------------------------------------- outbound is untouched; the store reads the database door
@arun
async def test_a_call_we_placed_ignores_the_switch_and_the_gate_still_requires_the_mention() -> None:
    out = OutboundCall(row_id=uuid.uuid4(), language="en", purpose="visit_reminder", goal=None, opening_line=None)
    prepared = await _prepare_for(service(SwitchStore(False)), voice(), TENANT, business="Padma Silks", outbound=out)
    assert prepared.ai_disclosed is True and gate.has_ai_disclosure(prepared.text or "")
    no_mention = gate.OutboundFacts(number="+919876543210", purpose="visit_reminder", now=__import__("datetime").datetime(2026, 11, 10, 4, 30, tzinfo=__import__("datetime").timezone.utc),
                                    hours=gate.Hours(days=frozenset(range(7)), from_minute=gate.WINDOW_FROM_MINUTE, to_minute=gate.WINDOW_TO_MINUTE), approval="task", approval_valid=True,
                                    can_contact=True, dnd="no", opening_line="Hello, this is Priya from Padma Silks.", active_calls_total=0)
    refused = gate.check_outbound(gate.Settings(mode="sandbox", sandbox_numbers=frozenset({"+919876543210"}), max_concurrent=1, outbound=True), no_mention)
    assert isinstance(refused, gate.Refused) and refused.reason == "no_ai_disclosure"


class Rpc:
    def __init__(self, answer: Any) -> None:
        self.answer = answer
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, args))
        return self.answer


@pytest.mark.parametrize(("answer", "expected"), [(True, True), (False, False), (None, True), ("x", True), ({}, True)])
def test_the_store_reads_the_database_door_and_only_a_plain_false_turns_it_off(answer: Any, expected: bool) -> None:
    rpc = Rpc(answer)
    store = InboundStore(cast(Any, rpc), cast(Any, SimpleNamespace(token=lambda: "tok")))
    assert store.mention_ai(TENANT) is expected and rpc.calls == [("phone_mention_ai_for_call", {"p_tenant_id": str(TENANT)})]


def test_the_row_is_begun_with_what_the_opening_really_said() -> None:
    rpc = Rpc({"id": str(uuid.uuid4())})
    store = InboundStore(cast(Any, rpc), cast(Any, SimpleNamespace(token=lambda: "tok")))
    store.begin(TENANT, "en", "exotel", ai_disclosed=False)
    store.begin(TENANT, "en")
    assert [c[1]["p_ai_disclosed"] for c in rpc.calls] == [False, True]
