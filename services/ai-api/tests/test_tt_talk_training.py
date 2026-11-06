"""How I talk to customers (owner, 5 Nov 2026; job calls-like-a-pro part 3): the Owner's training (greeting, address, questions, never-say, objections, examples), the defaults per business type,
the call's prompt, the greeting that always says it is an AI, and the never-say list as a HARD rule on every spoken line: 30 simulated calls with 10 Owner rules, 0 violations."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.talk_training.guard import GuardedTts, safe_line, violates
from app.talk_training.models import TalkTraining
from app.talk_training.prompt import blocks, greeting
from app.telephony import persona
from app.tenancy.repository import Forbidden, MfaRequired
from tests.aw_fakes import _uid
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/talk-training"
RULES: dict[str, Any] = {
    "greeting": {"en": "Namaste! Thanks for calling Lakshmi Silks, I am the AI assistant.", "te": "నమస్కారం! లక్ష్మి సిల్క్స్ కి కాల్ చేసినందుకు thanks."},
    "address": "garu",
    "questions": ["What is the saree for?", "Which colours do you like?", "When do you need it?"],
    "never_say": ["guaranteed", "best price in the market", "free delivery", "cash only"],
    "objections": [{"hears": "Too costly", "answer": "We have sarees in many ranges; the team can show you options that fit."}],
    "examples": [{"customer": "Do you have Kanjivaram?", "answer": "Yes, we keep Kanjivaram silks; would you like to visit or see photos?"}],
}


class FakeRepo:
    def __init__(self) -> None:
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        if _uid(token) not in ("a_owner", "a_admin"):
            raise Forbidden("42501")
        return self.rows.get(tenant_id)

    def save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        if _uid(token) != "a_owner":
            raise Forbidden("42501")
        self.rows[tenant_id] = {"doc": doc, "updated_at": "2026-11-05T12:00:00+00:00"}
        return self.rows[tenant_id]

    def reset(self, token: str, tenant_id: uuid.UUID) -> None:
        self.rows.pop(tenant_id, None)


class FakePacks:
    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"pack_id": "textiles"}


def world() -> tuple[Any, FakeRepo]:
    repo = FakeRepo()
    client, _ = make_client(talk_training=repo, packs=FakePacks())
    return client, repo


# ============================================================================ the API
def test_before_a_save_the_business_types_defaults_and_the_platforms_rules() -> None:
    client, _ = world()
    got = client.get(URL, headers=auth("a_owner"))
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["saved"] is False and body["training"]["address"] == "plain" and "saree" in body["training"]["questions"][0]
    assert body["training"] == body["defaults"] and any("AI" in r for r in body["rules"]) and body["wording"] == "draft"


def test_the_owner_saves_an_admin_reads_and_sales_does_not() -> None:
    client, repo = world()
    put = client.put(URL, json=RULES, headers=auth("a_owner"))
    assert put.status_code == 200, put.text
    assert put.json()["saved"] is True and put.json()["training"]["address"] == "garu"
    assert client.get(URL, headers=auth("a_admin")).json()["training"]["never_say"] == RULES["never_say"]
    assert client.put(URL, json=RULES, headers=auth("a_admin")).status_code == 403
    assert client.get(URL, headers=auth("a_sales")).status_code == 403
    reset = client.post(f"{URL}/reset", headers=auth("a_owner"))
    assert reset.status_code == 200 and reset.json()["saved"] is False and repo.rows == {}


def test_a_promise_or_an_amount_in_an_answer_is_refused_with_a_closed_reason() -> None:
    client, _ = world()
    for bad, reason in (({**RULES, "objections": [{"hears": "Too costly", "answer": "I promise a 10% discount for you."}]}, "price_or_promise"),
                        ({**RULES, "greeting": {"en": "Hello, prices start at Rs 5000"}}, "price_or_promise"),
                        ({**RULES, "never_say": [f"word {i}" for i in range(21)]}, "too_many_never_say"),
                        ({**RULES, "questions": [f"Question {i}?" for i in range(9)]}, "too_many_questions"),
                        ({**RULES, "address": "dear"}, "invalid"),
                        ({**RULES, "extra": 1}, "invalid")):
        got = client.put(URL, json=bad, headers=auth("a_owner"))
        assert got.status_code == 422 and got.json()["error"]["code"] == "talk_training_invalid" and got.json()["error"].get("reason") == reason, (reason, got.text)


def test_the_second_factor_is_the_databases_answer() -> None:
    client, repo = world()

    def needs_mfa(token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        raise MfaRequired("SM306")

    repo.save = needs_mfa  # type: ignore[method-assign]
    got = client.put(URL, json=RULES, headers=auth("a_owner"))
    assert got.status_code == 403 and "mfa" in got.json()["error"]["code"]


# ============================================================================ the call
def test_the_prompt_carries_the_training_and_the_greeting_always_says_it_is_an_ai() -> None:
    doc = TalkTraining.model_validate(RULES).model_dump(mode="json")
    system = persona.system_prompt(business="Lakshmi Silks", assistant=None, language="te", purpose="inbound", facts=[], customer_first_name=None, training=doc)
    assert "'garu'" in system and "What is the saree for?" in system and '"free delivery"' in system and "TONE and length only" in system
    assert "NEVER say 'sir' or 'madam'" in "\n".join(blocks({"address": "plain"}))
    en = persona.opening_line("en", business="Lakshmi Silks", assistant=None, customer=None, inbound=True, greeting=greeting(doc, "en"))
    te = persona.opening_line("te", business="Lakshmi Silks", assistant=None, customer=None, inbound=True, greeting=greeting(doc, "te"))
    assert en == RULES["greeting"]["en"], "the Owner's greeting already says AI"
    # owner, 6 Nov 2026: the AI disclosure is in the FIRST sentence, so a greeting without 'AI' comes AFTER the standard opening's first sentence
    assert te.endswith(RULES["greeting"]["te"]) and "AI" in persona.first_sentence(te), "a greeting without 'AI' follows the disclosure, never before it"
    assert persona.opening_line("hi", business="X", assistant=None, customer=None, inbound=True, greeting=greeting(doc, "hi")) == persona.INBOUND_OPENING["hi"].replace("{business}", "X").replace("{assistant}", persona.DEFAULT_ASSISTANT)


def test_never_say_matches_whole_words_whatever_the_case_spaces_or_punctuation() -> None:
    never = ["free delivery", "guaranteed"]
    assert violates("We give FREE   delivery!", never) and violates("It's guaranteed.", never)
    assert not violates("Delivery is free of damage checks", never) and not violates("unguaranteedness", never)
    assert safe_line("Free delivery for you!", never, "te").startswith("దాని గురించి") and safe_line("Hello", never, "te") == "Hello"


class Voice:
    sample_rate = 24000

    def __init__(self) -> None:
        self.spoken: list[str] = []

    async def prewarm(self) -> None:
        return None

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.spoken.append(text)
        yield b"\x00\x00"


def test_thirty_simulated_calls_with_ten_owner_rules_say_no_never_say_phrase() -> None:
    """A1 of the job: 10 rules set by the Owner, 30 simulated calls in te and en whose model drafts DO contain the phrases (the worst case): the voice speaks none of them."""
    never = ["guaranteed", "best price in the market", "free delivery", "cash only", "100% sure", "no returns", "lowest price", "today only", "final offer", "trust me"]
    drafts = [
        "Yes madam, this saree is guaranteed pure silk.", "We have the best price in the market.", "Free delivery anywhere in the city!", "Payment is cash only, please.",
        "I am 100% sure it will suit you.", "Sorry, no returns on this one.", "This is the lowest price.", "The offer is today only!", "That is my final offer.", "Trust me, it is good.",
        "మా దగ్గర best price in the market ఉంది.", "Free delivery ఇస్తాం.", "ఇది guaranteed silk.", "Final offer అండీ.", "Cash only అండీ.",
    ]
    clean = ["We have Kanjivaram and soft silk sarees.", "When do you need it?", "Which colours do you like?", "మీకు ఏ రంగులు ఇష్టం?", "The team will share photos if you ask."]
    voice = Voice()
    guarded = GuardedTts(voice, never)

    async def call(lines: list[str], language: str) -> None:
        for line in lines:
            async for _ in guarded.stream(line, language):
                pass

    for n in range(30):
        language = "te" if n % 2 else "en"
        lines = [drafts[n % len(drafts)], clean[n % len(clean)], drafts[(n * 7) % len(drafts)]]
        asyncio.run(call(lines, language))
    assert len(voice.spoken) == 90
    assert sum(violates(s, never) for s in voice.spoken) == 0, "never-say: 0 violations"
    assert guarded.blocked == 60 and sum(s in clean for s in voice.spoken) == 30, "every clean line is spoken as written"
