"""Every voice of Sarvam Bulbul v4 and Cartesia for our languages is in the catalogue and offered (owner, 21 Nov 2026: "we also need all those from Sarvam and Cartesia"): the data holds together, the list endpoint filters and stays quick. No network."""

# ruff: noqa: E501

from __future__ import annotations

import time
from collections import Counter

import pytest

from app.conversation.picker import out
from app.conversation.voices import default_config
from tests.fakes import TENANT_A, auth
from tests.test_nv_picker import world

CFG = default_config()
BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant"


def test_every_voice_is_listed_and_the_numbers_are_the_documented_ones() -> None:
    voices = list(CFG.catalogue.values())
    assert all(v.listed for v in voices if v.id != "en-shubh") and len(voices) >= 230   # en-shubh: unlisted 24 Nov 2026, the voice check showed Sarvam refuses it
    by = Counter((v.language, v.provider) for v in voices)
    # docs.sarvam.ai (20 Nov 2026): Bulbul v4 Flash has 4 Telugu, 4 Kannada, 4 Tamil, 116 Hindi and 62 English speakers in the languages we call (the Hindi-English `enhi` ones, Marathi and Malayalam are not added)
    assert by[("te", "sarvam")] == 4 and by[("kn", "sarvam")] == 4 and by[("ta", "sarvam")] == 4
    assert by[("hi", "sarvam")] == 116 and by[("en", "sarvam")] == 62 + 1, "62 English speakers plus shubh_enhi_customer, the Hindi-English one that was already the English man's voice"
    assert by[("ml", "sarvam")] == 0 and by[("mr", "sarvam")] == 0 and not CFG.has_voices("mr")
    assert sum(1 for v in voices if v.provider == "cartesia") == 45, "the 45 Cartesia voices of the catalogue builder"
    speakers = [v.voices.primary.voice for v in voices if v.provider == "sarvam"]
    assert len(speakers) == len(set(speakers)), "no Sarvam speaker twice"


def test_one_default_per_language_and_gender_and_the_bulbul_defaults_of_the_first_change_stay() -> None:
    for language in ("te", "en", "hi", "kn", "ta", "ml"):
        for gender in ("female", "male"):
            assert sum(v.default for v in CFG.voices_of(language, gender)) == 1, (language, gender)
    assert {lang: CFG.default_for(lang).id for lang in ("te", "hi", "kn", "en")} == {"te": "te-kavitha", "hi": "hi-kavya", "kn": "kn-chaitra", "en": "en-janvi"}


def test_every_sarvam_voice_is_a_v4_flash_persona_of_its_language_with_a_cartesia_voice_of_the_same_language_and_gender_behind_it() -> None:
    cartesia = {v.voices.primary.voice: v for v in CFG.catalogue.values() if v.provider == "cartesia"}
    for v in CFG.catalogue.values():
        if v.provider != "sarvam":
            continue
        assert v.voices.primary.engine == "sarvam_v4" and v.voices.primary.model == "bulbul:v4-flash" and v.to_confirm, v.id
        assert v.voices.primary.voice.split("_")[1] in (v.language, "enhi"), (v.id, "a persona of its own language")
        back = cartesia[v.voices.fallback.voice]
        assert v.voices.fallback.engine == "cartesia" and v.voices.fallback.gender == v.gender == back.gender and back.language == v.language, v.id
        assert 0 < len(v.label) <= 20 and v.tags and v.id.startswith(f"{v.language}-"), v.id


def test_a_sarvam_voice_without_a_documented_gender_says_it_was_read_from_the_name() -> None:
    import json

    from app.conversation.voices import DEFAULT_FILE

    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))["catalogue"]
    by_name = [e for e in raw if e.get("gender_source") == "name"]
    assert len(by_name) == 183 and all(e["provider"] == "sarvam" for e in by_name)


def test_the_list_is_quick_with_every_voice_and_the_filters_work() -> None:
    began = time.perf_counter()
    for _ in range(20):
        everything = out(CFG, {})
    per_call = (time.perf_counter() - began) / 20
    assert per_call < 0.25, f"{per_call:.3f}s for a list of {sum(len(x.voices) for x in everything.languages)} voices"
    hi = next(x for x in everything.languages if x.language == "hi")
    assert hi.total == len(hi.voices) >= 120
    women = out(CFG, {}, only_gender="female").languages
    assert all(v.gender == "female" for x in women for v in x.voices) and next(x for x in women if x.language == "hi").total == hi.total
    sarvam = out(CFG, {}, provider="sarvam").languages
    assert all(v.provider == "sarvam" for x in sarvam for v in x.voices) and not next(x for x in sarvam if x.language == "ml").voices
    found = out(CFG, {}, q="ISHITA").languages
    assert {v.name for x in found for v in x.voices} == {"Ishita"} and next(x for x in found if x.language == "hi").voices
    assert not any(x.voices for x in out(CFG, {}, q="zzzz").languages)
    assert [v.id for v in next(x for x in out(CFG, {}, q="kabir").languages if x.language == "hi").voices] == ["hi-kabir"]
    assert out(CFG, {}, only_gender="male", provider="cartesia", q="calm").languages[0].voices, "the three filters combine"


@pytest.mark.parametrize("query", ["gender=female", "provider=sarvam", "q=ritu", "gender=male&provider=cartesia&q=calm"])
def test_the_endpoint_takes_the_filters(query: str) -> None:
    client, _ = world()
    r = client.get(f"{BASE}/voices?{query}", headers=auth("a_viewer"))
    assert r.status_code == 200
    languages = r.json()["languages"]
    assert [x["language"] for x in languages] == ["te", "en", "hi", "kn", "ta", "ml"] and all("total" in x for x in languages)
    for x in languages:
        assert len(x["voices"]) <= x["total"]
        for v in x["voices"]:
            if "gender=female" in query:
                assert v["gender"] == "female"
            if "provider=sarvam" in query:
                assert v["provider"] == "sarvam"
            if "q=ritu" in query:
                assert "ritu" in (v["id"] + v["name"]).lower()
    # the defaults are still named whatever the filter hides
    assert next(x for x in languages if x["language"] == "te")["default_id"] == "te-kavitha"


@pytest.mark.parametrize("query", ["gender=other", "provider=google", "q=" + "x" * 41])
def test_a_bad_filter_is_a_422(query: str) -> None:
    client, _ = world()
    assert client.get(f"{BASE}/voices?{query}", headers=auth("a_viewer")).status_code == 422


def test_any_listed_voice_of_the_workspaces_gender_can_be_chosen_including_the_long_list() -> None:
    client, _ = world()
    for language, vid in (("hi", "hi-ishita_devotional"), ("en", "en-simran_conversation"), ("te", "te-pooja_conversation"), ("kn", "kn-suchitra_narration")):
        r = client.put(f"{BASE}/voices", json={"language": language, "voice_id": vid}, headers=auth("a_owner"))
        assert r.status_code == 200 and next(x for x in r.json()["languages"] if x["language"] == language)["chosen_id"] == vid, (language, vid, r.text[:120])
    # a man's voice in a female workspace flips the workspace to male in the same call (planner, 21 Nov 2026); a nobody is still a 422
    flipped = client.put(f"{BASE}/voices", json={"language": "ta", "voice_id": "ta-vijay_narration"}, headers=auth("a_owner"))
    assert flipped.status_code == 200 and flipped.json()["gender"] == "male"
    assert client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": "hi-nobody_ads"}, headers=auth("a_owner")).status_code == 422
