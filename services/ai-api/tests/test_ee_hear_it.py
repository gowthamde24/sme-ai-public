"""Job EE ("Hear it" speaks what the screen shows): POST /ai-assistant/voices/preview speaks EXACTLY the line the client sends (unsaved edits included), the live names filled and the AI sentence added the way a call
does it, in the workspace's chosen voice for the line's language; it returns the exact words spoken. The pre-rendered samples say what GET /voices says they say."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import unquote

from app.conversation.picker import out
from app.conversation.preview import CallVoicePreview
from app.conversation.voices import SAMPLE_LINES, default_config, sample_text
from app.voice.interface import VoiceError
from tests.fakes import TENANT_A, auth, make_client
from tests.test_nv_picker import FakeChoices

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant"
URL = f"{BASE}/voices/preview"


class Spoken:
    """An engine that remembers every text it was given (after the pronunciation map)."""

    sample_rate = 24000

    def __init__(self, texts: list[tuple[str, str]], voice: str) -> None:
        self.texts, self.voice = texts, voice
        self.name = voice

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        self.texts.append((self.voice, text))
        yield b"\x00\x01" * 400


def world(*, saved_line: str | None = None, mention_ai: bool = False) -> tuple[Any, FakeChoices, list[tuple[str, str]]]:
    texts: list[tuple[str, str]] = []
    cache: dict[tuple[str, str], Spoken] = {}

    def factory(choice: Any, language: str) -> Spoken:
        return cache.setdefault((choice.engine, choice.voice), Spoken(texts, choice.voice))

    repo = FakeChoices()
    repo.opening = lambda token, tenant_id: {"mention_ai": mention_ai, "lines": [{"language": "en", "campaign_id": None, "text": saved_line}] if saved_line else [], "campaign_overrides": []}  # type: ignore[method-assign]
    client, _ = make_client(workspace=repo, call_voice=CallVoicePreview(default_config(), factory, today=lambda: "2026-10-29"))
    return client, repo, texts


def post(client: Any, body: dict[str, Any], user: str = "a_owner") -> Any:
    return client.post(URL, json=body, headers=auth(user))


def test_the_spoken_text_is_the_text_on_the_screen_unsaved_edits_included() -> None:
    client, _, texts = world(saved_line="This is the SAVED line of the workspace, nothing like the edit.")
    shown = "Hello {customer}, this is {assistant} from {business}. A new offer today."
    r = post(client, {"language": "en", "text": shown})
    assert r.status_code == 200, r.text
    body = r.json()
    business = TENANT_A.name
    assert body["spoken_text"].startswith("Hello, this is ") and f"from {business}. A new offer today." in body["spoken_text"], "the edit is spoken, with the live names; the dropped {customer} leaves no stray space"
    assert "SAVED line" not in body["spoken_text"] and "{" not in body["spoken_text"]
    assert [t for _, t in texts] == [body["spoken_text"]], "the engine was given exactly the text the screen is shown: nothing added, no sample sentence"
    assert body["audio"]["mime"] == "audio/wav" and base64.b64decode(body["audio"]["base64"])[:4] == b"RIFF" and body["engine"] == "cartesia"


def test_a_line_with_no_placeholders_is_spoken_word_for_word() -> None:
    client, _, texts = world()
    line = "Welcome to our shop. We are open until seven every evening."
    r = post(client, {"language": "en", "text": line})
    assert r.json()["spoken_text"] == line and [t for _, t in texts] == [line]


def test_the_ai_sentence_follows_the_switch_exactly_as_a_call_hears_it() -> None:
    client, _, texts = world(mention_ai=False)
    line = "Hello {customer}, this is {assistant} from {business}. Do you have a minute?"
    off = post(client, {"language": "en", "text": line}).json()["spoken_text"]
    on = post(client, {"language": "en", "text": line, "mention_ai": True}).json()["spoken_text"]
    assert "AI" not in off and "AI" in on, "the unsaved switch is honoured; null would use the saved one"
    assert on != off and [t for _, t in texts] == [off, on]
    saved_on_client, _, _ = world(mention_ai=True)
    assert "AI" in post(saved_on_client, {"language": "en", "text": line}).json()["spoken_text"], "null = the workspace's saved switch"


def test_without_a_text_the_saved_line_is_spoken_and_the_get_reports_the_words_in_a_header() -> None:
    client, _, texts = world(saved_line="Saved line for this shop, in one go.")
    r = post(client, {"language": "en"})
    assert r.json()["spoken_text"] == "Saved line for this shop, in one go."
    g = client.get(f"{URL}?language=en", headers=auth("a_owner"))
    assert g.status_code == 200 and g.content[:4] == b"RIFF" and unquote(g.headers["x-spoken-text"]) == "Saved line for this shop, in one go."
    assert [t for _, t in texts][-1] == "Saved line for this shop, in one go."


def test_the_chosen_voice_of_the_lines_language_speaks_it() -> None:
    client, repo, texts = world()
    repo.choices["te"] = "te-sindhu"
    line = "నమస్కారం, {business} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    r = post(client, {"language": "te", "text": line})
    assert r.status_code == 200 and TENANT_A.name in r.json()["spoken_text"]
    assert texts[-1][0] == default_config().catalogue["te-sindhu"].voices.primary.voice


def test_a_bad_line_or_a_wrong_language_is_refused_in_plain_words() -> None:
    client, _, texts = world()
    for text in ("short", "x" * 301, "Hello {customer} {unknown_word} welcome to the shop", "Hello {customer, this is broken"):
        r = post(client, {"language": "en", "text": text})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_text", text
    r = post(client, {"language": "en", "text": "నమస్కారం అండీ, మా షాప్ కి స్వాగతం ఈ రోజు"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "language_mismatch"
    assert post(client, {"language": "ta", "text": "Hello there, welcome to the shop"}).status_code == 422
    assert post(client, {"language": "en", "text": "Hello there, welcome", "extra": 1}).status_code == 422
    assert texts == [], "nothing was spoken for any of those"


def test_only_the_owner_and_admin_may_hear_it_and_it_is_off_without_the_voice_service() -> None:
    client, _, _ = world()
    body = {"language": "en", "text": "Hello there, welcome to the shop"}
    assert post(client, body, user="a_sales").status_code == 403 and post(client, body, user="a_viewer").status_code == 403
    assert post(client, body, user="a_admin").status_code == 200
    off, _ = make_client(workspace=FakeChoices())
    assert off.post(URL, json=body, headers=auth("a_owner")).json()["error"]["code"] == "no_preview"


def test_the_daily_character_cap_still_stops_a_workspace_and_a_repeat_is_cached() -> None:
    client, _, texts = world()
    body = {"language": "en", "text": "Hello there, welcome to the shop"}
    post(client, body)
    post(client, body)
    assert len(texts) == 1, "the same voice and words are spoken once"

    async def boom(*_: Any, **__: Any) -> Any:
        raise VoiceError("rate_limited")

    class Capped:
        speak = staticmethod(boom)

    capped, _ = make_client(workspace=FakeChoices(), call_voice=Capped())
    r = capped.post(URL, json=body, headers=auth("a_owner"))
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"


def test_each_catalogue_voice_reports_the_exact_words_of_its_sample_and_they_name_nobody() -> None:
    cfg = default_config()
    voices = out(cfg, {}).languages
    seen = 0
    for lang in voices:
        for v in lang.voices:
            assert v.sample_text == sample_text(lang.language) and "Sample Stores" in v.sample_text
            seen += 1
    assert seen == len(cfg.catalogue) and seen >= 9
    for text in SAMPLE_LINES.values():
        for old in ("Vijaya", "Vijay", "{name}"):
            assert old not in text, "no old persona name in any sample"
    client, _, _ = world()
    r = client.get(f"{BASE}/voices", headers=auth("a_viewer"))
    first = r.json()["languages"][0]["voices"][0]
    assert first["sample_text"] and json.loads(json.dumps(first))["sample_url"].endswith(".mp3") and uuid.uuid4() is not None


def test_a_name_is_spoken_only_when_the_owner_set_one_and_the_default_line_never_invents_one() -> None:
    from app.assistant_settings import data as settings_data
    from app.assistant_settings.service import AssistantSettingsService
    from tests.dm_assistant_fakes import FakeAssistantSettingsRepository

    texts: list[tuple[str, str]] = []
    cache: dict[tuple[str, str], Spoken] = {}

    def factory(choice: Any, language: str) -> Spoken:
        return cache.setdefault((choice.engine, choice.voice), Spoken(texts, choice.voice))

    repo = FakeChoices()
    client, _ = make_client(workspace=repo, call_voice=CallVoicePreview(default_config(), factory, today=lambda: "2026-10-29"), assistant_settings=AssistantSettingsService(FakeAssistantSettingsRepository()))
    for lang in ("te", "en"):
        before = post(client, {"language": lang}).json()["spoken_text"]
        assert TENANT_A.name in before and "Vani" not in before and "Vijaya" not in before and "{" not in before, "no name is made up"
    saved = client.put(f"{BASE}", json={**settings_data.defaults_for("textiles"), "name": "Priya"}, headers=auth("a_owner"))
    assert saved.status_code == 200, saved.text
    after = post(client, {"language": "en"}).json()["spoken_text"]
    assert after == f"Hello, this is Priya from {TENANT_A.name}. I'm calling about your enquiry. Is this a good time to talk?"   # (this fake workspace has the AI switch off)
    assert post(client, {"language": "te"}).json()["spoken_text"].startswith("నమస్కారం అండీ, నేను Priya,")
