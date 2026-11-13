"""C15: a DRAFT of the Talk training from one sentence (POST /talk-training/draft). The model's answer is only data: every piece is checked by the rules of a saved training, laid over the pack's defaults,
nothing is saved, and with no model the draft is the defaults, labelled `template`."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

from app.talk_training import draft
from app.talk_training.models import TalkTraining
from tests.fakes import TENANT_A, auth, make_client
from tests.test_tt_talk_training import FakePacks, FakeRepo, FakeVoice

URL = f"/v1/tenants/{TENANT_A.id}/talk-training/draft"
SENTENCE = {"description": "We sell silk sarees in Hyderabad, friendly tone, we call customers garu", "language": "en"}
GOOD = {
    "greeting": "Namaste, this is the AI assistant of {business}. How can I help?",
    "tone": "friendly",
    "questions": ["Which occasion is the saree for?", "Which colours do you like?"],
    "never_say": ["cheap", "Cheap", "discount"],
    "say_like": [{"say": "pattu cheera", "instead_of": "silk saree"}, {"say": "Pattu Cheera"}],
    "objections": [{"hears": "It is too costly", "answer": "I understand, shall I show a few simpler designs?"}, {"hears": "Any offer?", "answer": "We have 20% off today"}],
    "examples": [{"customer": "Do you have red sarees?", "answer": "Yes, we have a few red ones. Which occasion?"}],
}


def world(reply: Any = None, *, down: bool = False) -> tuple[Any, FakeRepo, FakeVoice | None]:
    repo = FakeRepo()
    voice = FakeVoice([json.dumps(reply) if not isinstance(reply, str) else reply]) if reply is not None else None
    client, _ = make_client(talk_training=repo, packs=FakePacks(), browser_voice=None if down else voice)
    return client, repo, voice


def test_the_model_writes_a_draft_every_piece_is_checked_and_nothing_is_saved() -> None:
    client, repo, voice = world(GOOD)
    got = client.post(URL, json=SENTENCE, headers=auth("a_owner"))
    assert got.status_code == 200, got.text
    out = got.json()
    assert out["source"] == "ai" and out["saved"] is False and out["wording"] == "draft"
    t = out["training"]
    assert t["greeting"] == {"en": GOOD["greeting"]} and t["tone"] == "friendly"
    assert t["questions"] == GOOD["questions"]
    assert t["never_say"] == ["cheap", "discount"], "a repeat (any case) is dropped"
    assert t["say_like"] == [{"say": "pattu cheera", "instead_of": "silk saree"}]
    assert [o["hears"] for o in t["objections"]] == ["It is too costly"], "an answer with a percentage is dropped, never repaired"
    assert out["dropped"] == 3
    assert repo.rows == {}, "NOTHING is saved"
    assert voice is not None and "Synthetic" not in voice.systems[0] and "owner will read" in voice.systems[0] and "English" in voice.systems[0]
    TalkTraining.model_validate(t)


def test_a_greeting_with_an_unknown_placeholder_or_a_price_is_dropped_and_the_defaults_stay() -> None:
    for bad in ("Hello {name}, welcome", "Welcome, everything is Rs. 500 today", "x"):
        client, _, _ = world({"greeting": bad})
        out = client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()
        assert out["training"]["greeting"] == {} and out["dropped"] == 1 and out["source"] == "ai", bad
        assert out["training"]["questions"], "the pack's defaults stay under it"


def test_text_around_the_json_is_ignored_and_a_reply_that_is_not_json_gives_the_template() -> None:
    client, _, _ = world("Sure! Here you go:\n```json\n" + json.dumps({"questions": ["Which fabric?"]}) + "\n```")
    out = client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()
    assert out["source"] == "ai" and out["training"]["questions"] == ["Which fabric?"]
    client, _, _ = world("I cannot do that.")
    out = client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()
    assert out["source"] == "template" and out["dropped"] == 0 and out["training"]["questions"]


def test_without_a_model_the_draft_is_the_pack_defaults() -> None:
    client, _, _ = world(None)
    out = client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()
    assert out["source"] == "template" and out["training"] == client.get(URL.replace("/draft", ""), headers=auth("a_owner")).json()["defaults"]


def test_lists_are_cut_to_their_limits() -> None:
    client, _, _ = world({"questions": [f"Question number {i}?" for i in range(12)], "never_say": [f"word{i}" for i in range(30)], "examples": [{"customer": f"Customer {i}", "answer": f"Answer {i}"} for i in range(9)]})
    out = client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()
    t = out["training"]
    assert (len(t["questions"]), len(t["never_say"]), len(t["examples"])) == (8, 20, 5) and out["dropped"] == 4 + 10 + 4


def test_roles_validation_and_the_hourly_cap() -> None:
    client, _, _ = world(GOOD)
    assert client.post(URL, json=SENTENCE, headers=auth("a_admin")).status_code == 200
    assert client.post(URL, json=SENTENCE, headers=auth("a_sales")).status_code == 403
    assert client.post(URL, json=SENTENCE, headers=auth("a_viewer")).status_code == 403
    assert client.post(URL, json={"description": "x"}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={**SENTENCE, "language": "fr"}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json={**SENTENCE, "extra": 1}, headers=auth("a_owner")).status_code == 422
    assert client.post(URL, json=SENTENCE).status_code == 401
    from app.talk_training import routes

    routes._draft_turns.clear()
    for _ in range(routes.DRAFT_PER_HOUR):
        assert client.post(URL, json=SENTENCE, headers=auth("a_owner")).status_code == 200
    assert client.post(URL, json=SENTENCE, headers=auth("a_owner")).json()["error"]["code"] == "draft_busy"
    routes._draft_turns.clear()


def test_assemble_never_raises_on_odd_shapes() -> None:
    base = TalkTraining()
    for reply in ('{"questions": "not a list", "say_like": [1, null, {"say": 5}], "greeting": 7, "tone": "angry"}', "[1,2]", "{", ""):
        got = draft.assemble(reply, base, "en")
        assert got is None or isinstance(got[0], TalkTraining)
