"""The panel "How your assistant speaks" (owner decision 11 Nov 2026; docs/contracts/how-assistant-speaks.md): one object composed of the Talk training document and the speaking style.
Read by Owner and Admin, written by the Owner with a second factor, every part checked before anything is written, nothing lost from the old "How to address customers"."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.packs.registry import PackRegistry
from app.speaking.service import SpeakingService
from tests.ds_fakes import FakeSpeakingRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.test_pack_tone import PACKS
from tests.test_tt_talk_training import FakeRepo

URL = f"/v1/tenants/{TENANT_A.id}/how-assistant-speaks"


class Packs:
    def __init__(self, pack_id: str = "textiles") -> None:
        self.pack_id = pack_id

    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"pack_id": self.pack_id}


class Profiles:
    def my_profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"display_name": "Gowtham Reddy"}


def world(pack_id: str = "textiles", doc: dict[str, Any] | None = None) -> tuple[Any, FakeRepo, FakeSpeakingRepository]:
    training, speaking = FakeRepo(), FakeSpeakingRepository()
    if doc is not None:
        training.rows[TENANT_A.id] = {"doc": doc, "updated_at": "2026-11-05T12:00:00+00:00"}
    client, _ = make_client(talk_training=training, speaking=SpeakingService(speaking), packs=Packs(pack_id), pack_registry=PackRegistry(PACKS), workspace=Profiles())
    return client, training, speaking


def test_nothing_saved_the_business_type_decides_and_formal_is_not_offered() -> None:
    client, _, _ = world("textiles")
    body = client.get(URL, headers=auth("a_owner")).json()
    assert body["tone"] == {"value": "friendly", "source": "pack_default", "pack_default": "friendly", "options": ["respectful", "friendly"]}
    assert body["words"]["options"]["styles"] == ["everyday_mixed", "everyday_pure"] and set(body["words"]["languages"]) == {"te", "en", "hi", "kn", "ta", "ml"}
    assert body["words"]["languages"]["te"] == {"style": "everyday_mixed", "region": "neutral", "saved": False, "examples": "approved"}
    assert body["introduce_as"]["kind"] == "business" and body["introduce_as"]["owner_name"] == "Gowtham" and body["introduce_as"]["options"] == ["business", "owner", "custom"]
    assert "AI assistant" in body["introduce_as"]["preview"]["te"] or "AI assistant" in body["introduce_as"]["preview"]["en"]
    assert body["pack_defaults"] == {"tone": "friendly", "words": "everyday_mixed", "region": "neutral"} and body["legacy_address"] is None and body["updated_at"] is None
    school = world("education")[0].get(URL, headers=auth("a_owner")).json()
    assert school["tone"]["value"] == "respectful" and school["tone"]["source"] == "pack_default" and school["pack_defaults"]["tone"] == "respectful"


def test_the_old_address_value_is_mapped_and_nothing_is_lost() -> None:
    for old, value, source in (("plain", "respectful", "pack_default"), ("garu", "respectful", "migrated"), ("sir_madam", "respectful", "migrated"), ("ji", "respectful", "migrated")):
        client, _, _ = world("education", {"address": old})
        got = client.get(URL, headers=auth("a_owner")).json()
        assert (got["tone"]["value"], got["tone"]["source"], got["legacy_address"]) == (value, source, old), old
    friendly_school_never_touched, _, _ = world("textiles", {"address": "plain"})
    assert friendly_school_never_touched.get(URL, headers=auth("a_owner")).json()["tone"]["value"] == "friendly"
    client, training, _ = world("education", {"address": "garu"})
    assert client.put(URL, json={"tone": "friendly"}, headers=auth("a_owner")).json()["tone"] == {"value": "friendly", "source": "saved", "pack_default": "respectful", "options": ["respectful", "friendly"]}
    assert training.rows[TENANT_A.id]["doc"]["address"] == "garu", "the old value stays in the document"


def test_only_the_owner_with_a_second_factor_writes_and_owner_and_admin_read() -> None:
    client, training, _ = world()
    assert client.get(URL, headers=auth("a_admin")).status_code == 200
    for user in ("a_sales", "a_viewer"):
        assert client.get(URL, headers=auth(user)).status_code == 403, user
    assert client.get(URL).status_code == 401
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.put(URL, json={"tone": "respectful"}, headers=auth(user)).status_code in (403, 404), user
    assert client.put(URL, json={"tone": "respectful"}, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert training.rows == {}
    assert client.get(URL, headers=auth("a_admin")).json()["introduce_as"]["owner_name"] is None, "an Admin's profile is not the Owner's name"
    assert client.put(URL, json={"tone": "respectful"}, headers=auth("a_owner")).json()["tone"]["value"] == "respectful"


def test_a_subset_changes_only_that_part_and_null_resets_it() -> None:
    client, training, speaking = world("education")
    done = client.put(URL, json={"tone": "friendly", "words": {"te": {"style": "everyday_pure", "region": "telangana"}}, "introduce_as": {"kind": "custom", "text": "Gowtham High School's AI assistant"}}, headers=auth("a_owner")).json()
    assert done["tone"]["value"] == "friendly" and done["tone"]["source"] == "saved"
    assert done["words"]["languages"]["te"] == {"style": "everyday_pure", "region": "telangana", "saved": True, "examples": "approved"}
    assert done["introduce_as"]["kind"] == "custom" and "AI assistant" in done["introduce_as"]["preview"]["en"] and "Gowtham High School" in done["introduce_as"]["preview"]["en"]
    assert training.rows[TENANT_A.id]["doc"]["questions"], "the business type's own questions are kept when the first save writes the document"
    # another part alone: the rest is untouched
    again = client.put(URL, json={"words": {"ta": {"style": "everyday_pure"}}}, headers=auth("a_owner")).json()
    assert again["words"]["languages"]["te"]["region"] == "telangana" and again["words"]["languages"]["ta"]["saved"] is True
    assert again["tone"]["value"] == "friendly" and again["introduce_as"]["kind"] == "custom"
    # null puts it back
    reset = client.put(URL, json={"tone": None, "words": {"te": None}, "introduce_as": None}, headers=auth("a_owner")).json()
    assert reset["tone"] == {"value": "respectful", "source": "pack_default", "pack_default": "respectful", "options": ["respectful", "friendly"]}
    assert reset["words"]["languages"]["te"]["saved"] is False and reset["words"]["languages"]["ta"]["saved"] is True and reset["introduce_as"]["kind"] == "business"
    assert set(speaking.saved) == {"ta"}


def test_a_saved_formal_is_shown_as_everyday_pure_until_saved_again() -> None:
    client, _, speaking = world()
    speaking.saved = {"te": {"style": "formal", "region": "neutral"}}
    shown = client.get(URL, headers=auth("a_owner")).json()["words"]["languages"]["te"]
    assert shown["style"] == "everyday_pure" and shown["saved"] is True
    client.put(URL, json={"words": {"ta": {"style": "everyday_pure"}}}, headers=auth("a_owner"))
    assert speaking.saved["te"]["style"] == "formal", "a language that was not touched is not rewritten"
    assert client.put(URL, json={"words": {"te": {"style": "formal"}}}, headers=auth("a_owner")).status_code == 422, "formal is not offered any more"


def test_every_refusal_is_a_422_that_names_the_field_and_nothing_is_written() -> None:
    client, training, speaking = world()
    casual = client.put(URL, json={"tone": "casual"}, headers=auth("a_owner"))
    assert casual.status_code == 422 and casual.json()["error"]["fields"] == ["tone"]
    region = client.put(URL, json={"words": {"hi": {"style": "everyday_mixed", "region": "telangana"}}}, headers=auth("a_owner"))
    assert region.status_code == 422 and region.json()["error"]["fields"] == ["words.hi.region"]
    for bad, reason in (({"kind": "custom", "text": "Gowtham the human"}, "person_word"), ({"kind": "custom", "text": "just a bot here"}, "no_ai_assistant"), ({"kind": "owner", "text": "Bob99"}, "digit"),
                        ({"kind": "custom", "text": "Call 9 AI assistant"}, "digit"), ({"kind": "custom", "text": "see http://x.in AI assistant"}, "link"), ({"kind": "owner"}, "missing_text"), ({"kind": "business", "text": "x"}, "text_not_allowed")):
        r = client.put(URL, json={"tone": "respectful", "introduce_as": bad}, headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["fields"] == ["introduce_as"] and r.json()["error"]["reason"] == reason, (bad, r.text)
    assert client.put(URL, json={"nonsense": 1}, headers=auth("a_owner")).status_code == 422
    assert training.rows == {} and speaking.saved == {}, "a refused body writes nothing, not even its valid parts"


def test_another_workspace_is_not_reachable() -> None:
    from tests.fakes import TENANT_B

    client, _, _ = world()
    assert client.get(f"/v1/tenants/{TENANT_B.id}/how-assistant-speaks", headers=auth("a_owner")).status_code == 404
