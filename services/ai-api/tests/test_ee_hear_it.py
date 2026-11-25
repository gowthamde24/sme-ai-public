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
from app.conversation.voices import FIXED_SENTENCES, SAMPLE_LINES, default_config, sample_text_of
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
    from tests.test_tt_talk_training import FakeRepo as TrainingRepo

    training = TrainingRepo()   # these tests are about the words, with the AI sentence OFF (the Owner's written undertaking is stored): the default is ON since the lawyer's opinion of 25 Nov 2026
    training.rows[TENANT_A.id] = {"doc": {"say_ai_when_greeting": False, "ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}}, "updated_at": "2026-11-26T00:00:00+00:00"}
    client, _ = make_client(workspace=repo, talk_training=training, call_voice=CallVoicePreview(default_config(), factory, today=lambda: "2026-10-29"))
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
    spoken = line   # the default setting is OFF: the Owner's words as they are (owner, 20 Nov 2026)
    assert r.json()["spoken_text"] == spoken and [t for _, t in texts] == [spoken]


def test_the_ai_sentence_follows_the_setting_exactly_as_a_call_hears_it() -> None:
    client, _, texts = world(mention_ai=True)
    line = "Hello {customer}, this is {assistant} from {business}. Do you have a minute?"
    off = post(client, {"language": "en", "text": line}).json()["spoken_text"]
    on = post(client, {"language": "en", "text": line, "mention_ai": True}).json()["spoken_text"]
    assert "AI" not in off and "AI assistant" in on and off != on, "null = the saved setting, which is OFF until the owner turns it on (owner, 20 Nov 2026); the screen can try ON before saving"
    assert [t for _, t in texts] == [off, on]


def test_without_a_text_the_saved_line_is_spoken_and_the_get_reports_the_words_in_a_header() -> None:
    client, _, texts = world(saved_line="Saved line for this shop, in one go.")
    r = post(client, {"language": "en"})
    said = "Saved line for this shop, in one go."   # the default setting is OFF: no AI sentence added (owner, 20 Nov 2026)
    assert r.json()["spoken_text"] == said
    g = client.get(f"{URL}?language=en", headers=auth("a_owner"))
    assert g.status_code == 200 and g.content[:4] == b"RIFF" and unquote(g.headers["x-spoken-text"]) == said
    assert [t for _, t in texts][-1] == said


def test_the_chosen_voice_of_the_lines_language_speaks_it() -> None:
    client, repo, texts = world()
    repo.choices["te"] = "te-kavitha"
    line = "నమస్కారం, {business} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    r = post(client, {"language": "te", "text": line})
    assert r.status_code == 200 and TENANT_A.name in r.json()["spoken_text"]
    assert texts[-1][0] == default_config().catalogue["te-kavitha"].voices.primary.voice


def test_a_bad_line_or_a_wrong_language_is_refused_in_plain_words() -> None:
    client, _, texts = world()
    for text in ("short", "x" * 301, "Hello {customer} {unknown_word} welcome to the shop", "Hello {customer, this is broken"):
        r = post(client, {"language": "en", "text": text})
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_text", text
    r = post(client, {"language": "en", "text": "నమస్కారం అండీ, మా షాప్ కి స్వాగతం ఈ రోజు"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "language_mismatch"
    assert post(client, {"language": "bn", "text": "Hello there, welcome to the shop"}).status_code == 422
    no_voice = post(client, {"language": "mr", "text": "Hello there, welcome to the shop"})   # job M1: a call language with no voice in the catalogue yet
    assert no_voice.status_code == 404 and no_voice.json()["error"]["code"] == "no_preview"
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
            assert v.sample_text == sample_text_of(default_config().catalogue[v.id])
            if lang.language in FIXED_SENTENCES:   # 24 Nov 2026: the fixed sentence with the voice's own name
                assert v.name in v.sample_text and "Sample Stores" not in v.sample_text
            else:   # Tamil, Malayalam, Marathi keep the older business line, which names nobody
                assert "Sample Stores" in v.sample_text and v.name not in v.sample_text
            seen += 1
    assert seen == len([c for c in cfg.catalogue.values() if c.listed]) and seen >= 9, "the short list"
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
    assert after == f"Hello, this is Priya, the AI assistant of {TENANT_A.name}. I'm calling about your enquiry. Is this a good time to talk?"   # (saving the assistant's settings takes the setting back to the default, ON)
    assert post(client, {"language": "te"}).json()["spoken_text"].startswith("నమస్కారం అండీ, నేను Priya,")


def test_an_edited_line_that_says_assistant_in_an_unnamed_workspace_speaks_a_phrase_not_a_hole() -> None:
    client, _, texts = world()
    shown = "Hello, this is {assistant} of {business}. Is this a good time?"
    for lang, text, phrase in (("en", shown, "your assistant"), ("te", "నమస్కారం, నేను {assistant}, {business} నుంచి మాట్లాడుతున్నాను.", "మీ అసిస్టెంట్")):
        spoken = post(client, {"language": lang, "text": text}).json()["spoken_text"]
        assert phrase in spoken and TENANT_A.name in spoken and "  " not in spoken and "{" not in spoken, lang
    assert texts[0][1] == f"Hello, this is your assistant of {TENANT_A.name}. Is this a good time?"


def test_any_listed_voice_can_be_heard_live_before_it_is_chosen() -> None:
    """21 Nov 2026: the owner picks from the voice card; the preview speaks the voice asked for (saved or not), as itself, even one of the other gender."""
    client, repo, texts = world()
    repo.choices["te"] = "te-ramya"   # the saved choice is a woman's Cartesia voice
    line = "నమస్కారం, {business} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    catalogue = default_config().catalogue
    for voice_id in ("te-tarun", "te-kavitha", "te-charan"):   # a Sarvam man, a Sarvam woman, a Cartesia man
        r = post(client, {"language": "te", "text": line, "voice_id": voice_id})
        assert r.status_code == 200 and r.json()["voice_id"] == voice_id, (voice_id, r.text)
        assert texts[-1][0] == catalogue[voice_id].voices.primary.voice


def test_a_voice_that_is_not_listed_for_the_language_is_refused_in_plain_words() -> None:
    client, _, texts = world()
    line = "నమస్కారం, {business} నుంచి మాట్లాడుతున్నాను. ఒక్క నిమిషం మాట్లాడొచ్చా?"
    before = len(texts)
    for bad in ("en-janvi", "te-kavitha_old", "../etc", "te-nobody", "x" * 41):   # another language, a voice that does not exist, nonsense, unknown, too long
        r = post(client, {"language": "te", "text": line, "voice_id": bad})
        assert r.status_code == 422, (bad, r.status_code)
    assert len(texts) == before, "nothing was spoken"
    assert post(client, {"language": "te", "text": line, "voice_id": "te-ramya", "tone": "shouting"}).status_code == 422
    assert post(client, {"language": "te", "text": line, "voice_id": "te-ramya", "tone": "respectful"}).status_code == 200
