"""Hand over to a person (owner, 5 Nov 2026; job calls-like-a-pro part 4): a caller who asks for a person (in en, te, hi, kn, ta, ml) hears the fixed "someone from the team will call you back", the
call ends as a hand-over, and Today shows it until a member marks it handled (POST /calls/{id}/handled). A3: every simulated "talk to a person" goes to the callback path."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.crm.repository import NotFoundError
from app.telephony import persona
from app.telephony.phone_llm import PhoneLlm
from app.telephony.service import CallsService
from app.telephony.triggers import person_requested, stop_requested
from app.today.service import needs_item
from tests.fakes import TENANT_A, auth, make_client
from tests.test_ph_calls_api import DONE_ID, NOW, FakeCallsRepo

ASKS = [
    ("en", "Can I talk to a real person please?"), ("en", "Connect me to the owner."), ("en", "I want to speak with someone from your team"), ("en", "Give me the manager"),
    ("en", "put me through to a human"), ("te", "మేనేజర్‌తో మాట్లాడాలి"), ("te", "ఎవరైనా మనిషి ఉన్నారా?"), ("te", "మీ ఓనర్ కి ఇవ్వండి"), ("te", "manishi tho matladali"),
    ("hi", "मालिक से बात कराइए"), ("hi", "किसी इंसान से बात करनी है"), ("hi", "manager se baat karni hai"), ("kn", "ಮ್ಯಾನೇಜರ್ ಜೊತೆ ಮಾತಾಡಬೇಕು"), ("ta", "மேனேஜரிடம் பேச வேண்டும்"), ("ml", "മാനേജരോട് സംസാരിക്കണം"),
]
NOT_ASKS = ["Are you a robot or a real person?", "I am a person who likes silk", "What is the price of this saree?", "The owner told me last week it was in stock", "Please call me back tomorrow", "Who am I speaking to?"]


@pytest.mark.parametrize(("language", "text"), ASKS)
def test_every_way_of_asking_for_a_person_is_heard(language: str, text: str) -> None:
    assert person_requested(text), text


@pytest.mark.parametrize("text", NOT_ASKS)
def test_ordinary_sentences_are_not_a_hand_over(text: str) -> None:
    events: list[str] = []
    llm = PhoneLlm(Model(), "Lakshmi Silks", lambda: "en", on_event=events.append)

    async def reply() -> str:
        return "".join([p async for p in llm.stream("system", [{"role": "user", "content": text}], "m")])

    asyncio.run(reply())
    assert events == [] and not stop_requested(text), "the identity question is answered honestly, not handed over"


class Model:
    def __init__(self) -> None:
        self.asked = 0

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.asked += 1
        yield "The model's own answer."


def test_a3_every_simulated_talk_to_a_person_goes_to_the_callback_path() -> None:
    for language, text in ASKS:
        events: list[str] = []
        model = Model()
        llm = PhoneLlm(model, "Lakshmi Silks", (lambda lang: lambda: lang)(language), on_event=events.append)

        async def reply(phone: PhoneLlm = llm, said: str = text) -> str:
            return "".join([p async for p in phone.stream("system", [{"role": "assistant", "content": "Hello"}, {"role": "user", "content": said}], "m")])

        said = asyncio.run(reply())
        assert events == ["handover"] and model.asked == 0, text
        assert said == persona.HANDOVER_ACK.get(language, persona.HANDOVER_ACK["en"]), "the fixed line, never the model's"


class HandledRepo(FakeCallsRepo):
    def handled(self, token: str, tenant_id: uuid.UUID, call_id: uuid.UUID) -> dict[str, Any]:
        if call_id not in self.rows:
            raise NotFoundError("23503")
        return {"call_id": call_id, "handled_at": NOW.isoformat()}


def test_a_member_marks_a_hand_over_call_handled() -> None:
    c, _ = make_client(calls=CallsService(HandledRepo(), clock=lambda: NOW))
    url = f"/v1/tenants/{TENANT_A.id}/calls"
    got = c.post(f"{url}/{DONE_ID}/handled", headers=auth("a_sales"))
    assert got.status_code == 200 and got.json()["call_id"] == str(DONE_ID), got.text
    assert c.post(f"{url}/{uuid.uuid4()}/handled", headers=auth("a_owner")).status_code == 404
    assert c.post(f"{url}/{DONE_ID}/handled", headers=auth("a_viewer")).status_code == 403


def test_today_says_it_plainly() -> None:
    item = needs_item({"kind": "person_requested", "id": str(uuid.uuid4()), "customer": "A caller", "city": None, "agent": "followup_desk", "ref": "call", "amount_paise": None,
                       "at": NOW.isoformat(), "target": {"type": "phone_call", "id": str(uuid.uuid4())}})
    assert item.kind == "person_requested" and "asked to talk to a person" in item.summary and item.target.type == "phone_call"
