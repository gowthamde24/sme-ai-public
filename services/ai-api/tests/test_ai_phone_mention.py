"""Job AI, rewritten 21 Nov 2026 (owner decision of 20 Nov): "Say 'AI assistant' when greeting" is a SETTING of the Talk training document (`say_ai_when_greeting`), DEFAULT OFF = the name only; the old per-workspace switch of ADR 0116 (read here
as `store.mention_ai`) is no longer read by a call.

Pinned: OFF gives the name-only opening in every language, ON the standard opening with the AI words; the honest-answer rule is in the prompt whatever the setting says (and when the opening did not say it, an explicit second rule); the call row stores
whether the opening really said it was an AI; a call WE place follows the setting too, and the gate asks for the words only when the setting is ON."""

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
UND = {"at": "2026-11-26", "by": "owner"}   # the written undertaking an OFF needs (lawyer's opinion, 25 Nov 2026)
TRAINED = "Namaste! Welcome to {business}. This is {assistant}. How can I help you?"   # a trained greeting that does not say it is an AI


def voice() -> Any:
    return BrowserVoice(config=default_config(), factory=lambda choice, language: FakeTts(), sarvam_key="k", anthropic_key="k", fast_model="m", turn_model="claude", limits=Limits(greeting=True),
                        ledger=Ledger(Limits(greeting=True)), allowed_origins=(), client=cast(Any, SimpleNamespace()))


def opening(language: str, mention: bool, greeting: str | None = None) -> str:
    return persona.opening_line(language, business="Padma Silks", assistant=None, customer=None, inbound=True, greeting=greeting, mention_ai=mention)


# ---------------------------------------------------------------------------------------------------------------------------------- the opening
def test_off_is_the_name_only_and_on_is_the_standard_opening_in_english() -> None:
    standard = persona.INBOUND_OPENING["en"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    assert opening("en", True) == standard and gate.has_ai_disclosure(standard)
    assert opening("en", False) == "Hello, this is Priya from Padma Silks. How can I help you?" and not gate.has_ai_disclosure(opening("en", False))


def test_a_trained_greeting_is_used_as_the_owner_wrote_it_when_off_and_gets_the_ai_words_first_when_on() -> None:
    filled = TRAINED.replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT)
    standard_first = persona.first_sentence(persona.INBOUND_OPENING["en"].replace("{business}", "Padma Silks").replace("{assistant}", persona.DEFAULT_ASSISTANT))
    assert opening("en", False, TRAINED) == filled
    on = opening("en", True, TRAINED)
    assert on.startswith(standard_first) and on.endswith(filled)


@pytest.mark.parametrize("language", ["te", "hi", "kn", "ta", "ml", "mr"])
def test_every_language_has_a_name_only_opening_and_the_setting_decides(language: str) -> None:
    assert persona.mention_ai_applies(language, False) is False and persona.mention_ai_applies(language, True) is True
    assert opening(language, False) != opening(language, True) and not gate.has_ai_disclosure(opening(language, False)) and gate.has_ai_disclosure(opening(language, True))
    assert "Padma Silks" in opening(language, False) and persona.DEFAULT_ASSISTANT in opening(language, False)


def test_a_call_we_place_follows_the_setting_too() -> None:
    off = persona.opening_line("en", business="Padma Silks", assistant=None, customer=None, owner_line=None, inbound=False, mention_ai=False)
    on = persona.opening_line("en", business="Padma Silks", assistant=None, customer=None, owner_line=None, inbound=False, mention_ai=True)
    assert not gate.has_ai_disclosure(off) and gate.has_ai_disclosure(on)


# ---------------------------------------------------------------------------------------------------------------------------------- the model's rules
def prompt(mention: bool, language: str = "en") -> str:
    parts, _ = phone_parts(voice(), "Padma Silks", language, "haiku", None, mention_ai=mention)
    return parts.system_for(language)


@pytest.mark.parametrize("mention", [True, False])
def test_the_honest_answer_rule_is_in_the_prompt_whatever_the_setting_says(mention: bool) -> None:
    system = prompt(mention)
    assert "you say so at once if asked; never claim to be a person, never deny being an AI" in system
    assert persona.HONEST_AI["en"] in system


def test_when_the_opening_did_not_say_it_the_prompt_says_to_answer_plainly_the_moment_the_customer_asks() -> None:
    for language in ("en", "te"):
        assert "did NOT say that you are an AI" in prompt(False, language) and "the moment the customer asks" in prompt(False, language)
        assert "did NOT say that you are an AI" not in prompt(True, language)


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
async def test_the_call_says_it_is_the_ai_assistant_by_default_and_the_old_switch_is_ignored() -> None:
    for switch in (True, False, None, "maybe"):
        prepared = await _prepare_for(service(SwitchStore(switch)), voice(), TENANT, business="Padma Silks")
        assert prepared.ai_disclosed is True and gate.has_ai_disclosure(prepared.text or "") and "Padma Silks" in (prepared.text or ""), switch


@arun
async def test_with_the_setting_on_the_call_says_it_and_is_stored_as_disclosed_in_every_language() -> None:
    for language in ("en", "te", "hi", "kn"):
        prepared = await _prepare_for(service(SwitchStore(False, {"say_ai_when_greeting": True}), language), voice(), TENANT, business="Padma Silks")
        assert prepared.ai_disclosed is True and gate.has_ai_disclosure(prepared.text or ""), language


@arun
async def test_off_with_the_undertaking_is_the_name_only_in_a_language_other_than_english_and_off_without_it_stays_on() -> None:
    prepared = await _prepare_for(service(SwitchStore(True, {"say_ai_when_greeting": False, "ai_off_undertaking": UND}), "te"), voice(), TENANT, business="Padma Silks")
    assert prepared.ai_disclosed is False and not gate.has_ai_disclosure(prepared.text or "")
    kept = await _prepare_for(service(SwitchStore(True, {"say_ai_when_greeting": False}), "te"), voice(), TENANT, business="Padma Silks")
    assert kept.ai_disclosed is True, "an OFF without the stored undertaking is read as not chosen: ON"


@arun
async def test_an_unreadable_training_document_is_the_default_on() -> None:
    prepared = await _prepare_for(service(SwitchStore(raises=True)), voice(), TENANT, business="Padma Silks")
    assert prepared.ai_disclosed is True


@arun
async def test_a_trained_greeting_is_spoken_as_written_when_off_and_gets_the_words_first_when_on() -> None:
    off = await _prepare_for(service(SwitchStore(True, {"greeting": {"en": TRAINED}, "say_ai_when_greeting": False, "ai_off_undertaking": UND})), voice(), TENANT, business="Padma Silks")
    assert off.ai_disclosed is False and "Namaste" in (off.text or "")
    on = await _prepare_for(service(SwitchStore(False, {"greeting": {"en": TRAINED}, "say_ai_when_greeting": True})), voice(), TENANT, business="Padma Silks")
    assert on.ai_disclosed is True and gate.has_ai_disclosure(persona.first_sentence(on.text or ""))


# ---------------------------------------------------------------------------------------------------------------------------------- a call we place follows the setting; the gate asks for the words only when it is ON
@arun
async def test_a_call_we_placed_follows_the_setting_and_the_gate_asks_only_when_it_is_on() -> None:
    out = OutboundCall(row_id=uuid.uuid4(), language="en", purpose="visit_reminder", goal=None, opening_line=None)
    off = await _prepare_for(service(SwitchStore(True, {"say_ai_when_greeting": False, "ai_off_undertaking": UND})), voice(), TENANT, business="Padma Silks", outbound=out)
    assert off.ai_disclosed is False and not gate.has_ai_disclosure(off.text or "")
    on = await _prepare_for(service(SwitchStore(False, {"say_ai_when_greeting": True})), voice(), TENANT, business="Padma Silks", outbound=out)
    assert on.ai_disclosed is True and gate.has_ai_disclosure(on.text or "")
    facts = dict(number="+919876543210", purpose="visit_reminder", now=__import__("datetime").datetime(2026, 11, 10, 4, 30, tzinfo=__import__("datetime").timezone.utc),
                 hours=gate.Hours(days=frozenset(range(7)), from_minute=gate.WINDOW_FROM_MINUTE, to_minute=gate.WINDOW_TO_MINUTE), approval="task", approval_valid=True, can_contact=True, dnd="no",
                 opening_line="Hello, this is Priya from Padma Silks.", active_calls_total=0)
    settings = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({"+919876543210"}), max_concurrent=1, outbound=True)
    refused = gate.check_outbound(settings, gate.OutboundFacts(**facts, say_ai=True))
    assert isinstance(refused, gate.Refused) and refused.reason == "no_ai_disclosure"
    assert isinstance(gate.check_outbound(settings, gate.OutboundFacts(**facts, say_ai=False)), gate.Allowed)


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
