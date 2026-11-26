"""The voice picker (job voice-picker): the catalogue, the per-workspace choice, the pre-rendered samples, the preview. Fakes only: no socket, no key."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.conversation.picker import out
from app.conversation.preview import PREVIEW_DAILY_CHARS, CallVoicePreview
from app.conversation.voices import (
    CALL_LANGUAGES,
    DEFAULT_FILE,
    TAGS,
    VOICED_LANGUAGES,
    VoiceChoice,
    default_config,
    parse_config,
)
from app.voice.interface import VoiceError
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant"


class FakeChoices:
    """The workspace repository's two voice methods (and an empty opening line, which the preview reads)."""

    def __init__(self) -> None:
        self.choices: dict[str, str] = {}
        self.gender = "female"
        self.calls: list[tuple[str, str | None]] = []

    def voice_choices(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"choices": dict(self.choices), "gender": self.gender}

    def set_voice_gender(self, token: str, tenant_id: uuid.UUID, gender: str) -> dict[str, Any]:
        self.calls.append(("gender", gender))
        if gender != self.gender:
            self.choices.clear()
        self.gender = gender
        return self.voice_choices(token, tenant_id)

    def set_voice_choice(self, token: str, tenant_id: uuid.UUID, language: str, voice_id: str | None) -> dict[str, Any]:
        self.calls.append((language, voice_id))
        if voice_id is None:
            self.choices.pop(language, None)
        else:
            self.choices[language] = voice_id
        return self.voice_choices(token, tenant_id)

    def opening(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"mention_ai": False, "lines": [], "campaign_overrides": []}


# ---- the catalogue ------------------------------------------------------------------------------------------------------------------------------------


# the voices that existed before voice v2 (no workspace's choice may break); every voice of the catalogue also has its sample and its filler lines rendered (scripts/voice_catalogue_build.py, scripts/voice_filler_bank.py)
RENDERED = {"en-janvi", "hi-sanya", "hi-esha", "hi-meera", "kn-disha", "kn-divya", "kn-prakash", "te-ramya", "te-sindhu"}


def test_the_catalogue_has_native_voices_of_both_genders_in_all_six_languages_with_one_default_each() -> None:
    cfg = default_config()
    assert CALL_LANGUAGES == ("te", "en", "hi", "kn", "ta", "ml", "mr")
    assert VOICED_LANGUAGES == ("te", "en", "hi", "kn", "ta", "ml") and not cfg.has_voices("mr"), "Marathi (job M1) is a call language with no voice yet"
    for lang in VOICED_LANGUAGES:
        for gender in ("female", "male"):
            group = cfg.voices_of(lang, gender)
            assert group, (lang, gender)
            assert [c.default for c in group].count(True) == 1 and group[0].default, "the default comes first"
            assert 1 <= sum(c.recommended for c in group if c.listed) <= 4, (lang, gender)   # (the best three by a round trip, plus the Bulbul default of te and hi)
            assert cfg.default_for(lang, gender).id == group[0].id
    assert {lang: cfg.default_for(lang).name for lang in CALL_LANGUAGES[:4]} == {"te": "Kavitha", "en": "Janvi", "hi": "Kavya", "kn": "Chaitra"}, "owner, 21 Nov 2026: Bulbul v4 is the default for te, hi and kn; English stays Cartesia"
    assert cfg.catalogue["kn-prakash"].gender == "male"
    for c in cfg.catalogue.values():
        assert c.id.startswith(f"{c.language}-") and {c.voices.primary.engine, c.voices.fallback.engine} == {"cartesia", "sarvam_v4"} and 0 < len(c.label) <= 20, "one engine first, the OTHER one behind it (either direction)"
        assert c.tags and set(c.tags) <= set(TAGS) and (c.label == c.tags[0].capitalize() or c.provider == "sarvam"), c.id
    assert RENDERED <= set(cfg.catalogue), "the voices that already had audio are still in the catalogue (no workspace's choice breaks)"


def test_a_fallback_voice_keeps_the_gender_of_the_voice_it_backs_up() -> None:
    cfg = default_config()
    assert all(c.voices.fallback.gender == c.gender for c in cfg.catalogue.values())
    assert cfg.catalogue["kn-prakash"].voices.fallback.voice == "chetan_kn_conversation"  # the male one
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    bad = copy.deepcopy(raw)
    next(e for e in bad["catalogue"] if e["id"] == "kn-prakash")["fallback"]["gender"] = "female"
    with pytest.raises(ValueError, match="same gender"):
        parse_config(bad)


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda r: r["catalogue"].append(copy.deepcopy(r["catalogue"][0])), "unique"),
        (lambda r: [e.update(default=False) for e in r["catalogue"] if e["language"] == "te" and e["gender"] == "female"], "exactly one female default"),
        (lambda r: [e.update(default=True) for e in r["catalogue"] if e["language"] == "te" and e["gender"] == "male"], "exactly one male default"),
        (lambda r: r["catalogue"][0].update(id="en-" + r["catalogue"][0]["id"][3:]), "must start with it"),
        (lambda r: r["catalogue"][0].update(tags=["loud"]), "tags are at most three"),
        (lambda r: r["catalogue"][0].update(label="x" * 21), "label of at most 20"),
        (lambda r: r["catalogue"][0]["fallback"].update(engine="cartesia"), "different engine"),
    ],
)
def test_a_broken_catalogue_is_refused(mutate: Any, message: str) -> None:
    raw = json.loads(DEFAULT_FILE.read_text(encoding="utf-8"))
    mutate(raw)
    with pytest.raises(ValueError, match=message):
        parse_config(raw)


def test_every_catalogue_voice_has_a_pre_rendered_sample_file_of_sane_size() -> None:
    for c in default_config().catalogue.values():
        if c.provider == "sarvam":
            continue   # a new Sarvam voice has no pre-rendered file until scripts/voice_blind_samples.py is run by the owner's go-ahead (Sarvam budget); the live preview speaks it
        assert c.sample_file.is_file(), c.id
        assert 20_000 < c.sample_file.stat().st_size < 400_000 and c.sample_file.read_bytes()[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"), c.id


# ---- resolving a choice -------------------------------------------------------------------------------------------------------------------------------


def test_the_default_speaks_when_nothing_is_chosen_the_choice_when_it_is_valid_and_the_default_again_when_it_is_stale() -> None:
    cfg = default_config()
    assert cfg.resolve("te").id == "te-kavitha", "the Bulbul v4 voice is the default (owner, 21 Nov 2026)"
    assert cfg.resolve("te", "te-ramya").id == "te-ramya", "a saved Cartesia choice keeps speaking"
    assert cfg.resolve("te", "te-sindhu").id == "te-sindhu", "since 21 Nov 2026 every voice is listed: a saved Cartesia choice of the long list keeps speaking"
    assert cfg.resolve("te", "hi-kavya").id == "te-kavitha", "a voice of another language is ignored"
    assert cfg.resolve("te", "te-removed-voice").id == "te-kavitha", "a voice no longer in the catalogue is ignored"
    assert cfg.resolve("te", "te-charan").id == "te-kavitha", "a male voice is ignored in a female workspace"
    assert cfg.resolve("te", "te-charan", "male").id == "te-charan" and cfg.resolve("te", None, "male").id == "te-tarun" and cfg.resolve("te", "te-kavitha", "male").id == "te-tarun"
    assert cfg.for_language("kn", "kn-prakash", "male").fallback.voice == "chetan_kn_conversation" and cfg.for_language("kn").fallback.voice == cfg.catalogue["kn-disha"].voices.primary.voice, "the Bulbul default has a Cartesia woman behind it"


# ---- the API ------------------------------------------------------------------------------------------------------------------------------------------


def world() -> tuple[Any, FakeChoices]:
    repo = FakeChoices()
    client, _ = make_client(workspace=repo)
    return client, repo


def test_any_member_reads_the_catalogue_with_sample_urls_and_the_default_active() -> None:
    client, _ = world()
    r = client.get(f"{BASE}/voices", headers=auth("a_viewer"))
    body = r.json()
    assert r.status_code == 200 and body["gender"] == "female" and [x["language"] for x in body["languages"]] == ["te", "en", "hi", "kn", "ta", "ml"]
    te = body["languages"][0]
    assert te["default_id"] == "te-kavitha" and te["chosen_id"] is None and te["active_id"] == "te-kavitha"
    assert {v["gender"] for v in te["voices"]} == {"female", "male"} and len(te["voices"]) == te["total"] >= 14, "every voice of the language: the screen filters"
    by_provider = {v["id"]: v["provider"] for v in te["voices"]}
    assert by_provider["te-ramya"] == "cartesia" and by_provider["te-kavitha"] == "sarvam" and by_provider["te-charan"] == "cartesia" and by_provider["te-tarun"] == "sarvam" and {"cartesia", "sarvam"} == set(by_provider.values())
    first = te["voices"][0]
    assert (first["id"], first["default"], first["chosen"]) == ("te-kavitha", True, False) and first["sample_url"] == "/v1/voice-samples/te-kavitha.mp3"
    assert set(first) == {"id", "name", "label", "gender", "tags", "recommended", "default", "chosen", "sample_url", "sample_text", "provider", "sample_ready", "to_confirm", "sounds_like", "best_for"} and first["tags"] and first["recommended"] is True
    assert len({v["sample_text"].replace(v["name"], "{name}") for v in te["voices"]}) == 1, "the SAME sentence for every voice of a language (only the voice's own name differs)"
    assert client.get(f"{BASE}/voices", headers=auth("b_owner")).status_code == 404, "another business reads nothing of ours"


def test_owner_and_admin_choose_others_are_refused_and_the_choice_is_ticked_and_active() -> None:
    client, repo = world()
    put = {"language": "te", "voice_id": "te-ramya"}
    for user in ("a_sales", "a_viewer"):
        assert client.put(f"{BASE}/voices", json=put, headers=auth(user)).status_code == 403, user
    assert not repo.calls
    for user in ("a_owner", "a_admin"):
        r = client.put(f"{BASE}/voices", json=put, headers=auth(user))
        te = r.json()["languages"][0]
        assert r.status_code == 200 and te["chosen_id"] == "te-ramya" and te["active_id"] == "te-ramya" and [v["id"] for v in te["voices"] if v["chosen"]] == ["te-ramya"], user
    again = client.get(f"{BASE}/voices", headers=auth("a_viewer")).json()["languages"][0]
    assert again["chosen_id"] == "te-ramya" and again["default_id"] == "te-kavitha"


@pytest.mark.parametrize(
    "body",
    [
        {"language": "te", "voice_id": "te-nobody"},  # not in the catalogue
        {"language": "te", "voice_id": "hi-kavya"},  # another language's voice
        {"language": "te", "voice_id": "TE-Ramya"},  # badly formed
        {"language": "bn", "voice_id": "bn-x"},  # a language outside the call set
        {"language": "mr", "voice_id": "mr-x"},  # a call language with no voice in the catalogue yet (job M1)
        {"gender": "male", "language": "te", "voice_id": "te-charan"},  # both forms at once
        {"gender": "other"},
        {},
        {"language": "te", "voice_id": "../../etc/passwd"},
        {"language": "te", "voice_id": "te-ramya", "extra": 1},
        {"voice_id": "te-ramya"},
    ],
)
def test_an_id_that_is_not_a_catalogue_voice_of_that_language_is_refused_and_nothing_is_stored(body: dict[str, Any]) -> None:
    client, repo = world()
    assert client.put(f"{BASE}/voices", json=body, headers=auth("a_owner")).status_code == 422
    assert not repo.calls and repo.choices == {}


def test_null_goes_back_to_the_default() -> None:
    client, repo = world()
    h = auth("a_owner")
    client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": "hi-sanya"}, headers=h)
    r = client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": None}, headers=h)
    hi = r.json()["languages"][2]
    assert hi["chosen_id"] is None and hi["active_id"] == "hi-kavya" and repo.calls[-1] == ("hi", None)


def test_the_gender_flips_the_workspace_clears_the_choices_and_a_voice_of_the_other_gender_is_refused() -> None:
    client, repo = world()
    h = auth("a_owner")
    assert client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-ramya"}, headers=h).status_code == 200
    r = client.put(f"{BASE}/voices", json={"gender": "male"}, headers=h)
    body = r.json()
    te = body["languages"][0]
    assert r.status_code == 200 and body["gender"] == "male" and te["chosen_id"] is None and te["default_id"] == "te-tarun" and te["active_id"] == "te-tarun"
    assert client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-nobody"}, headers=h).status_code == 422, "an unknown voice"
    assert client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": "te-tarun"}, headers=h).status_code == 422, "a voice of another language"
    assert client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-charan"}, headers=h).json()["languages"][0]["chosen_id"] == "te-charan"
    assert client.put(f"{BASE}/voices", json={"gender": "male"}, headers=h).json()["languages"][0]["chosen_id"] == "te-charan", "the same gender again keeps the choices"
    for user in ("a_sales", "a_viewer"):
        assert client.put(f"{BASE}/voices", json={"gender": "female"}, headers=auth(user)).status_code == 403
    assert repo.gender == "male"
    assert client.get(f"{BASE}/voices", headers=auth("a_viewer")).json()["gender"] == "male"


def test_every_language_of_the_call_set_can_be_chosen_including_tamil_and_malayalam() -> None:
    client, _ = world()
    for lang, vid in (("ta", "ta-janani"), ("ml", "ml-latha"), ("en", "en-shalini"), ("kn", "kn-chaitra")):
        r = client.put(f"{BASE}/voices", json={"language": lang, "voice_id": vid}, headers=auth("a_owner"))
        assert r.status_code == 200 and next(x for x in r.json()["languages"] if x["language"] == lang)["chosen_id"] == vid, lang


def test_a_stored_choice_that_left_the_catalogue_reads_as_no_choice() -> None:
    cfg = default_config()
    body = out(cfg, {"te": "te-gone", "hi": "kn-disha", "kn": "kn-prakash"}).model_dump()
    by = {x["language"]: x for x in body["languages"]}
    assert by["te"]["chosen_id"] is None and by["te"]["active_id"] == "te-kavitha"
    assert by["hi"]["chosen_id"] is None, "a voice of another language is not a choice"
    assert by["kn"]["chosen_id"] is None, "a male voice is not a choice in a female workspace"
    assert out(cfg, {"kn": "kn-prakash"}, "male").model_dump()["languages"][3]["chosen_id"] == "kn-prakash"


# ---- the samples (no sign-in) -------------------------------------------------------------------------------------------------------------------------


def test_a_sample_is_a_static_file_for_anyone_and_only_a_catalogue_id_becomes_a_path() -> None:
    client, _ = world()
    r = client.get("/v1/voice-samples/kn-prakash.mp3")
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg" and "max-age" in r.headers["cache-control"] and len(r.content) > 20_000
    for name in ("kn-nobody.mp3", "kn-prakash", "kn-prakash.wav", "..%2F..%2Fetc%2Fpasswd.mp3", "TE-Ramya.mp3", ".mp3"):
        assert client.get(f"/v1/voice-samples/{name}").status_code == 404, name


# ---- the preview --------------------------------------------------------------------------------------------------------------------------------------


class Engine:
    sample_rate = 24000

    def __init__(self, name: str, fail: bool = False) -> None:
        self.name, self.fail = name, fail
        self.texts: list[str] = []

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.texts.append(text)
        if self.fail:
            raise VoiceError("http_500")
        yield b"\x00\x01" * 400


def preview(*, primary_fails: bool = False) -> tuple[CallVoicePreview, list[tuple[str, str]]]:
    built: list[tuple[str, str]] = []
    engines: dict[tuple[str, str], Engine] = {}

    def factory(choice: VoiceChoice, language: str) -> Engine:
        built.append((choice.engine, choice.voice))
        return engines.setdefault((choice.engine, choice.voice), Engine(choice.voice, fail=primary_fails and choice.engine == "cartesia"))

    return CallVoicePreview(default_config(), factory, today=lambda: "2026-10-28"), built


def test_the_preview_speaks_the_chosen_voice_the_default_when_unset_and_never_another_voice_when_the_primary_fails() -> None:
    svc, built = preview()
    tid = uuid.uuid4()
    wav, engine, voice_id = asyncio.run(svc.speak(tid, "kn", "kn-prakash", "ನಮಸ್ಕಾರ ಸರ್", "male"))
    assert wav[:4] == b"RIFF" and engine == "cartesia" and voice_id == "kn-prakash" and built[0] == ("cartesia", default_config().catalogue["kn-prakash"].voices.primary.voice)
    svc2, built2 = preview()
    asyncio.run(svc2.speak(tid, "kn", None, "ನಮಸ್ಕಾರ ಸರ್"))
    assert built2[0] == ("sarvam_v4", default_config().catalogue["kn-chaitra"].voices.primary.voice), "unset: the default is the Bulbul v4 voice (21 Nov 2026)"
    svc3, built3 = preview(primary_fails=True)
    with pytest.raises(VoiceError) as err3:
        asyncio.run(svc3.speak(tid, "kn", "kn-prakash", "ನಮಸ್ಕಾರ ಸರ್", "male"))
    assert err3.value.code == "tts_unavailable" and not [b for b in built3 if b[0] == "sarvam_v4"], "no fallback voices (owner, 26 Nov 2026): the chosen voice is the only one that speaks; a preview of it never plays another"


def test_the_same_voice_and_text_are_spoken_once_and_the_daily_cap_stops_a_workspace() -> None:
    svc, built = preview()
    tid = uuid.uuid4()
    asyncio.run(svc.speak(tid, "en", None, "Hello there"))
    asyncio.run(svc.speak(tid, "en", None, "Hello there"))
    assert len(built) == 1, "the second click is served from the cache"
    with pytest.raises(VoiceError) as err:
        asyncio.run(svc.speak(tid, "en", None, "x" * (PREVIEW_DAILY_CHARS + 1)))
    assert err.value.code == "rate_limited"


def test_the_preview_route_needs_owner_or_admin_speaks_the_opening_line_and_is_404_when_the_service_is_off() -> None:
    repo = FakeChoices()
    svc, built = preview()
    client, _ = make_client(workspace=repo, call_voice=svc)
    q = f"{BASE}/voices/preview?language=en"
    assert client.get(q, headers=auth("a_sales")).status_code == 403
    r = client.get(q, headers=auth("a_owner"))
    assert r.status_code == 200 and r.content[:4] == b"RIFF" and r.headers["x-voice-engine"] == "cartesia" and built
    repo.choices["te"] = "te-kavitha"
    assert client.get(f"{BASE}/voices/preview?language=te", headers=auth("a_admin")).status_code == 200
    assert ("sarvam_v4", default_config().catalogue["te-kavitha"].voices.primary.voice) in built
    assert r.headers["x-voice-id"] == "en-janvi" and client.get(f"{BASE}/voices/preview?language=te", headers=auth("a_owner")).headers["x-voice-id"] == "te-kavitha"
    assert client.get(f"{BASE}/voices/preview?language=bn", headers=auth("a_owner")).status_code == 422
    assert client.get(f"{BASE}/voices/preview?language=mr", headers=auth("a_owner")).status_code == 404, "job M1: a call language with no voice yet has no preview"
    off, _ = make_client(workspace=FakeChoices())
    assert off.get(q, headers=auth("a_owner")).status_code == 404


def test_picking_a_voice_of_the_other_gender_sets_the_assistants_gender_in_the_same_call() -> None:
    """Planner, 21 Nov 2026: the owner picks the voice they like; pronouns and wording follow the voice's gender."""
    client, repo = world()
    h = auth("a_owner")
    assert repo.gender == "female"
    r = client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-tarun"}, headers=h)   # a man's voice in a woman's workspace
    body = r.json()
    assert r.status_code == 200 and body["gender"] == "male" and repo.gender == "male"
    assert body["languages"][0]["chosen_id"] == "te-tarun" and body["languages"][0]["active_id"] == "te-tarun"
    assert ("gender", "male") in repo.calls and ("te", "te-tarun") in repo.calls
    other = next(x for x in body["languages"] if x["language"] == "hi")
    assert other["chosen_id"] is None and other["default_id"].startswith("hi-"), "the other languages went back to the new gender's defaults"
    r = client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-kavitha"}, headers=h)   # and back
    assert r.status_code == 200 and r.json()["gender"] == "female" and repo.gender == "female"
    before = len(repo.calls)
    assert client.put(f"{BASE}/voices", json={"language": "te", "voice_id": "te-ramya"}, headers=h).status_code == 200
    assert ("gender", "female") not in repo.calls[before:], "the same gender does not flip anything"
