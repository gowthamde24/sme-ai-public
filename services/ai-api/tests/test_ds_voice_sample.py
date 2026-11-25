"""The AI assistant's listening sample and preview speak what a CALL speaks (21 Nov 2026; owner finding of 19 Nov: "previews do not equal real calls"): the same voices and engines, the one `resolve_sound`. Owner and Admin only; 404 when there is no voice
service; a cache, a minute limit and a daily character cap per workspace. Fakes only: no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import pytest

from app.conversation.preview import PREVIEW_PER_MINUTE
from app.conversation.sound import Stored, resolve_sound
from app.conversation.voices import default_config
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.test_nv_picker import FakeChoices, preview

URL = f"/v1/tenants/{TENANT_A.id}/ai-assistant/voice-sample"
PREVIEW = f"/v1/tenants/{TENANT_A.id}/ai-assistant/voice-preview"
Q = "language=te&style=warm"


def world(*, service: Any = "default", choices: dict[str, str] | None = None, gender: str = "female") -> tuple[Any, FakeChoices, list[tuple[str, str]]]:
    repo = FakeChoices()
    repo.choices, repo.gender = dict(choices or {}), gender
    svc, built = preview() if service == "default" else (service, [])
    client, _ = make_client(workspace=repo, call_voice=svc)
    return client, repo, built


def test_an_owner_and_an_admin_get_the_sound_of_a_call_the_workspaces_voice() -> None:
    client, _, built = world(choices={"te": "te-kavitha"})
    for user in ("a_owner", "a_admin"):
        r = client.get(f"{URL}?{Q}", headers=auth(user))
        assert r.status_code == 200 and r.headers["content-type"].startswith("audio/wav") and r.content[:4] == b"RIFF", user
        assert r.headers["x-voice-id"] == "te-kavitha"
    assert built[0] == ("sarvam_v4", "kavitha_te_conversation"), "the chosen voice speaks first, through the same engines a call uses"


def test_sales_viewers_strangers_and_other_workspaces_do_not_get_one() -> None:
    client, _, built = world()
    for user in ("a_sales", "a_viewer"):
        assert client.get(f"{URL}?{Q}", headers=auth(user)).status_code in (403, 404), user
    assert client.get(f"{URL}?{Q}").status_code == 401
    assert client.get(f"/v1/tenants/{TENANT_B.id}/ai-assistant/voice-sample?{Q}", headers=auth("a_owner")).status_code == 404
    assert built == []


@pytest.mark.parametrize("query", ["language=bn", "language=te&style=loud", "language=te&voice=nobody", "language=te&name=" + "x" * 25, "language=te&name=%3Cb%3E", ""])
def test_a_bad_choice_is_a_422(query: str) -> None:
    client, _, _ = world()
    assert client.get(f"{URL}?{query}", headers=auth("a_owner")).status_code == 422


def test_no_voice_service_is_404_no_sample() -> None:
    client, _, _ = world(service=None)
    r = client.get(f"{URL}?{Q}", headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_sample"


def test_the_legacy_voice_word_is_accepted_and_ignored() -> None:
    client, _, built = world(choices={"te": "te-kavitha"})
    r = client.get(f"{URL}?{Q}&voice=male_calm", headers=auth("a_owner"))
    assert r.status_code == 200 and r.headers["x-voice-id"] == "te-kavitha", "the workspace's voice speaks, not a persona word"


def test_the_preview_speaks_the_same_voice_tone_and_speed_a_call_resolves() -> None:
    client, repo, _ = world(choices={"hi": "hi-kabir"}, gender="male")
    text = client.get(f"{PREVIEW}/text?language=hi&style=respectful&name=Vani", headers=auth("a_owner")).json()
    stored = Stored(choices=repo.choices, gender=repo.gender)
    call = resolve_sound(default_config(), stored, "hi", tone="respectful")
    assert text["sound"] == call.public() and text["sound"]["voice_id"] == "hi-kabir" and text["sound"]["tone"] == "respectful" and text["sound"]["provider"] == "sarvam"
    r = client.get(f"{PREVIEW}?language=hi&style=respectful&name=Vani", headers=auth("a_owner"))
    assert r.status_code == 200 and r.headers["x-voice-id"] == call.voice.id


def test_the_words_of_the_preview_change_with_the_tone_and_the_voice_does_not() -> None:
    client, _, _ = world()
    said = {}
    for style in ("warm", "respectful", "quick"):
        body = client.get(f"{PREVIEW}/text?language=te&style={style}&name=Vani", headers=auth("a_owner")).json()
        said[style] = body["text"]
        assert body["sound"]["voice_id"] == "te-kavitha" and "AI assistant" in body["text"] and body["style"] == style
    assert len(set(said.values())) == 3, "Friendly, Respectful and Short-and-quick are three different sets of words"


def test_a_repeat_is_served_from_the_cache_and_a_new_speed_is_a_new_sound() -> None:
    client, _, built = world()
    for _ in range(2):
        assert client.get(f"{URL}?{Q}", headers=auth("a_owner")).status_code == 200
    assert len(built) == 1, "the second click is served from the cache"


def test_twelve_a_minute_per_workspace_then_a_429() -> None:
    client, _, _ = world()
    codes = [client.get(f"{URL}?language=te&style=warm&name=N{i}", headers=auth("a_owner")).status_code for i in range(PREVIEW_PER_MINUTE + 1)]
    assert codes[:PREVIEW_PER_MINUTE] == [200] * PREVIEW_PER_MINUTE and codes[-1] == 429


def test_the_preview_speaks_the_real_business_name_and_says_it_is_the_ai_assistant_by_default() -> None:
    client, _, _ = world()
    body = client.get(f"{PREVIEW}/text?language=en&style=warm&name=Vani", headers=auth("a_owner")).json()
    assert "Vani" in body["text"] and "AI assistant" in body["text"] and body["business_name"] == TENANT_A.name and body["assistant_name"] == "Vani"
    assert client.get(f"{PREVIEW}/text?language=en&style=warm&name=Vani", headers=auth("a_viewer")).status_code in (403, 404)


def test_marathi_has_no_voice_yet_so_no_sample_and_never_a_crash() -> None:
    client, _, built = world()
    r = client.get(f"{URL}?language=mr&style=warm", headers=auth("a_owner"))
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_sample" and built == []


def test_any_listed_voice_of_the_language_can_be_heard_before_it_is_chosen_and_nothing_else() -> None:
    """21 Nov 2026: the job card's sample and preview take ?voice_id= like Hear it does: a LISTED voice of that language (even of the other gender), else 422 unknown_voice."""
    client, _, _ = world(choices={"te": "te-ramya"}, gender="female")
    for route in (URL, PREVIEW):
        for voice_id in ("te-tarun", "te-kavitha", "te-charan"):
            r = client.get(f"{route}?{Q}&voice_id={voice_id}", headers=auth("a_owner"))
            assert r.status_code == 200 and r.headers["x-voice-id"] == voice_id, (route, voice_id, r.text[:120])
        for bad in ("en-janvi", "te-nobody", "nobody", "x" * 41):
            assert client.get(f"{route}?{Q}&voice_id={bad}", headers=auth("a_owner")).status_code in (422, 404), (route, bad)
        assert client.get(f"{route}?{Q}&voice_id=en-janvi", headers=auth("a_owner")).status_code == 422
