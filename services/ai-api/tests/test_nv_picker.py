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
        self.calls: list[tuple[str, str | None]] = []

    def voice_choices(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"choices": dict(self.choices)}

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


def test_the_catalogue_is_the_approved_list_with_one_default_per_language() -> None:
    cfg = default_config()
    names = {lang: [c.name for c in cfg.voices_of(lang)] for lang in CALL_LANGUAGES}
    assert names == {"en": ["Janvi"], "te": ["Ramya", "Sindhu"], "hi": ["Sanya", "Esha", "Meera"], "kn": ["Disha", "Divya", "Prakash"]}
    assert {lang: cfg.default_for(lang).name for lang in CALL_LANGUAGES} == {"en": "Janvi", "te": "Ramya", "hi": "Sanya", "kn": "Disha"}
    assert [c.name for c in cfg.voices_of("hi")][0] == "Sanya"  # the default first
    assert cfg.catalogue["kn-prakash"].gender == "male" and cfg.catalogue["kn-prakash"].label == "Male"
    for c in cfg.catalogue.values():
        assert c.id == f"{c.language}-{c.name.lower()}" and c.voices.primary.engine == "cartesia" and c.voices.fallback.engine == "sarvam_v4" and 0 < len(c.label) <= 20


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
        (lambda r: [e.update(default=False) for e in r["catalogue"] if e["language"] == "te"], "exactly one default"),
        (lambda r: r["catalogue"][2].update(default=True), "exactly one default"),
        (lambda r: r["catalogue"][0].update(id="te-janvi"), "must start with it"),
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
        assert c.sample_file.is_file(), c.id
        assert 20_000 < c.sample_file.stat().st_size < 400_000 and c.sample_file.read_bytes()[:3] in (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"), c.id


# ---- resolving a choice -------------------------------------------------------------------------------------------------------------------------------


def test_the_default_speaks_when_nothing_is_chosen_the_choice_when_it_is_valid_and_the_default_again_when_it_is_stale() -> None:
    cfg = default_config()
    assert cfg.resolve("te").id == "te-ramya"
    assert cfg.resolve("te", "te-sindhu").id == "te-sindhu"
    assert cfg.resolve("te", "hi-esha").id == "te-ramya", "a voice of another language is ignored"
    assert cfg.resolve("te", "te-removed-voice").id == "te-ramya", "a voice no longer in the catalogue is ignored"
    assert cfg.for_language("kn", "kn-prakash").fallback.voice == "chetan_kn_conversation" and cfg.for_language("kn").fallback.voice == "chaitra_kn_conversation"


# ---- the API ------------------------------------------------------------------------------------------------------------------------------------------


def world() -> tuple[Any, FakeChoices]:
    repo = FakeChoices()
    client, _ = make_client(workspace=repo)
    return client, repo


def test_any_member_reads_the_catalogue_with_sample_urls_and_the_default_active() -> None:
    client, _ = world()
    r = client.get(f"{BASE}/voices", headers=auth("a_viewer"))
    body = r.json()
    assert r.status_code == 200 and [x["language"] for x in body["languages"]] == ["te", "hi", "kn", "en"]
    te = body["languages"][0]
    assert te["default_id"] == "te-ramya" and te["chosen_id"] is None and te["active_id"] == "te-ramya"
    assert [(v["id"], v["default"], v["chosen"]) for v in te["voices"]] == [("te-ramya", True, False), ("te-sindhu", False, False)]
    assert te["voices"][0]["sample_url"] == "/v1/voice-samples/te-ramya.mp3" and set(te["voices"][0]) == {"id", "name", "label", "gender", "default", "chosen", "sample_url", "sample_text"}
    assert client.get(f"{BASE}/voices", headers=auth("b_owner")).status_code == 404, "another business reads nothing of ours"


def test_owner_and_admin_choose_others_are_refused_and_the_choice_is_ticked_and_active() -> None:
    client, repo = world()
    put = {"language": "te", "voice_id": "te-sindhu"}
    for user in ("a_sales", "a_viewer"):
        assert client.put(f"{BASE}/voices", json=put, headers=auth(user)).status_code == 403, user
    assert not repo.calls
    for user in ("a_owner", "a_admin"):
        r = client.put(f"{BASE}/voices", json=put, headers=auth(user))
        te = r.json()["languages"][0]
        assert r.status_code == 200 and te["chosen_id"] == "te-sindhu" and te["active_id"] == "te-sindhu" and [v["chosen"] for v in te["voices"]] == [False, True], user
    again = client.get(f"{BASE}/voices", headers=auth("a_viewer")).json()["languages"][0]
    assert again["chosen_id"] == "te-sindhu" and again["default_id"] == "te-ramya"


@pytest.mark.parametrize(
    "body",
    [
        {"language": "te", "voice_id": "te-nobody"},  # not in the catalogue
        {"language": "te", "voice_id": "hi-esha"},  # another language's voice
        {"language": "te", "voice_id": "TE-Ramya"},  # badly formed
        {"language": "ta", "voice_id": "ta-x"},  # a language outside the call set
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
    client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": "hi-esha"}, headers=h)
    r = client.put(f"{BASE}/voices", json={"language": "hi", "voice_id": None}, headers=h)
    hi = r.json()["languages"][1]
    assert hi["chosen_id"] is None and hi["active_id"] == "hi-sanya" and repo.calls[-1] == ("hi", None)


def test_a_stored_choice_that_left_the_catalogue_reads_as_no_choice() -> None:
    cfg = default_config()
    body = out(cfg, {"te": "te-gone", "hi": "kn-disha", "kn": "kn-prakash"}).model_dump()
    by = {x["language"]: x for x in body["languages"]}
    assert by["te"]["chosen_id"] is None and by["te"]["active_id"] == "te-ramya"
    assert by["hi"]["chosen_id"] is None, "a voice of another language is not a choice"
    assert by["kn"]["chosen_id"] == "kn-prakash"


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


def test_the_preview_speaks_the_chosen_voice_the_default_when_unset_and_the_same_gender_fallback_when_the_primary_fails() -> None:
    svc, built = preview()
    tid = uuid.uuid4()
    wav, engine = asyncio.run(svc.speak(tid, "kn", "kn-prakash", "ನಮಸ್ಕಾರ ಸರ್"))
    assert wav[:4] == b"RIFF" and engine == "cartesia" and built[0] == ("cartesia", default_config().catalogue["kn-prakash"].voices.primary.voice)
    svc2, built2 = preview()
    asyncio.run(svc2.speak(tid, "kn", None, "ನಮಸ್ಕಾರ ಸರ್"))
    assert built2[0] == ("cartesia", default_config().catalogue["kn-disha"].voices.primary.voice)
    svc3, built3 = preview(primary_fails=True)
    _, engine3 = asyncio.run(svc3.speak(tid, "kn", "kn-prakash", "ನಮಸ್ಕಾರ ಸರ್"))
    assert engine3 == "sarvam_v4" and ("sarvam_v4", "chetan_kn_conversation") in built3, "the male voice falls back to the male voice"


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
    repo.choices["te"] = "te-sindhu"
    assert client.get(f"{BASE}/voices/preview?language=te", headers=auth("a_admin")).status_code == 200
    assert ("cartesia", default_config().catalogue["te-sindhu"].voices.primary.voice) in built
    assert client.get(f"{BASE}/voices/preview?language=ta", headers=auth("a_owner")).status_code == 422
    off, _ = make_client(workspace=FakeChoices())
    assert off.get(q, headers=auth("a_owner")).status_code == 404
