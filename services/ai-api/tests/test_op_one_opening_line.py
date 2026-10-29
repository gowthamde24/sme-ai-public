"""ONE opening line (owner, 29 Oct 2026): the settings card, the editor, "Hear it", the voice preview and the test call all read the SAME resolved text (app/opening/resolve.py): the stored line, else the default template,
with the live business name and the assistant's name. Invariant: for every workspace state and language, card text == Hear-it spoken_text. No retired persona name ever appears in it."""

# ruff: noqa: E501

from __future__ import annotations

import itertools
import re
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.assistant_settings.service import AssistantSettingsService
from app.conversation.preview import CallVoicePreview
from app.conversation.voices import default_config
from app.opening import render
from tests.dm_assistant_fakes import FakeAssistantSettingsRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.test_dm_assistant_settings import settings as settings_body
from tests.test_nv_picker import FakeChoices

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant"
LANGS = ("te", "en", "hi", "kn", "ta", "ml")
RETIRED = re.compile(r"\b(Tara|Vani|Vijaya|Vijay)\b|తార|వాణి")


class Silent:
    sample_rate = 24000

    def __init__(self, voice: str) -> None:
        self.name = voice

    async def prewarm(self) -> None: ...

    async def stream(self, text: str, language: str) -> AsyncIterator[bytes]:
        yield b"\x00\x01" * 400


def stored_line(lang: str) -> str:
    return render.default_line(lang, False, named=True) + " ✓"   # (a line the Owner wrote: the default words plus a mark, so that it differs from the default)


def world(*, stored: bool, mention_ai: bool, name: str | None) -> Any:
    repo = FakeChoices()
    repo.opening = lambda token, tenant_id: {  # type: ignore[method-assign]
        "mention_ai": mention_ai,
        "lines": [{"language": lang, "campaign_id": None, "text": stored_line(lang)} for lang in LANGS] if stored else [],
        "campaign_overrides": [],
    }
    cfg = FakeAssistantSettingsRepository()
    service = AssistantSettingsService(cfg)
    client, _ = make_client(workspace=repo, assistant_settings=service, call_voice=CallVoicePreview(default_config(), lambda choice, language: Silent(choice.voice), today=lambda: "2026-10-30"))
    if name:
        assert client.put(BASE, json=settings_body(name=name), headers=auth("a_owner")).status_code == 200
    return client


def every_surface(client: Any, lang: str, typed_name: str | None = None) -> dict[str, str]:
    """The opening line as each surface shows or speaks it."""
    h = auth("a_owner")
    q: dict[str, Any] = {"language": lang}
    if typed_name:
        q["assistant_name"] = typed_name
    out: dict[str, str] = {}
    card = client.get(f"{BASE}/opening-line", headers=h).json()
    if not typed_name:
        out["card (GET /opening-line .resolved)"] = card["resolved"][lang]["resolved_opening_line"]
    resolved = client.get(f"{BASE}/opening-line/resolved", params=q, headers=h)
    assert resolved.status_code == 200, resolved.text
    body = resolved.json()
    assert body["spoken_text"] == body["resolved_opening_line"], "the spoken text IS the resolved line"
    out["GET /opening-line/resolved"] = body["resolved_opening_line"]
    prev = client.get(f"{BASE}/opening-line/preview", params=q, headers=h).json()
    out["GET /opening-line/preview text"] = prev["text"]
    out["GET /opening-line/preview resolved"] = prev["resolved_opening_line"]
    settings_preview = client.get(f"{BASE}/preview", params={"language": lang, "style": "warm", **({"name": typed_name} if typed_name else {})}, headers=h)
    assert settings_preview.status_code == 200, settings_preview.text
    sp = settings_preview.json()
    out["GET /ai-assistant/preview text"] = sp["text"]
    out["GET /ai-assistant/preview spoken_text"] = sp["spoken_text"]
    hear = client.post(f"{BASE}/voices/preview", json={"language": lang, **({"assistant_name": typed_name} if typed_name else {})}, headers=h)
    assert hear.status_code == 200, hear.text
    hb = hear.json()
    out["Hear it spoken_text"] = hb["spoken_text"]
    out["Hear it resolved_opening_line"] = hb["resolved_opening_line"]
    return out


@pytest.mark.parametrize("stored,mention_ai,name", list(itertools.product((False, True), (True, False), (None, "kallu"))))
def test_the_card_and_hear_it_are_the_same_text_in_every_state_and_language(stored: bool, mention_ai: bool, name: str | None) -> None:
    client = world(stored=stored, mention_ai=mention_ai, name=name)
    for lang in LANGS:
        got = every_surface(client, lang)
        assert len(set(got.values())) == 1, f"{lang}: the surfaces disagree: {got}"
        text = next(iter(got.values()))
        assert not RETIRED.search(text), text
        assert "{" not in text and "}" not in text
        if name and lang in ("te", "en", "hi", "kn"):   # (the named wording exists for te, en, hi, kn; the other languages leave the name out)
            assert name in text, (lang, text)
        if mention_ai:
            assert render.says_ai(text), text


def test_a_name_typed_on_the_screen_and_not_yet_saved_is_on_the_card_and_in_hear_it() -> None:
    client = world(stored=False, mention_ai=True, name=None)
    for lang in ("te", "en", "hi", "kn"):
        got = every_surface(client, lang, typed_name="kallu")
        assert len(set(got.values())) == 1, got
        assert "kallu" in next(iter(got.values())), got
    # nothing was saved by typing it
    assert client.get(f"{BASE}/opening-line/resolved", params={"language": "en"}, headers=auth("a_owner")).json()["assistant_name"] is None


def test_the_source_says_whether_the_line_is_stored_or_the_default() -> None:
    for stored, source in ((False, "default"), (True, "stored")):
        client = world(stored=stored, mention_ai=True, name="kallu")
        got = client.get(f"{BASE}/opening-line/resolved", params={"language": "te"}, headers=auth("a_owner")).json()
        assert got["source"] == source and got["assistant_name"] == "kallu" and got["business_name"] == TENANT_A.name


def test_the_telugu_default_names_the_owners_assistant_and_no_retired_name() -> None:
    client = world(stored=False, mention_ai=True, name="kallu")
    text = client.get(f"{BASE}/opening-line/resolved", params={"language": "te"}, headers=auth("a_owner")).json()["resolved_opening_line"]
    assert "kallu" in text and TENANT_A.name in text and render.says_ai(text) and not RETIRED.search(text)


def test_the_test_call_opens_with_the_same_line() -> None:
    client = world(stored=True, mention_ai=True, name="kallu")
    h = auth("a_owner")
    main = client.get(BASE, headers=h).json()["settings"]["main_language"]
    first = client.post(f"{BASE}/test-call", headers=h).json()["transcript"][0]["text"]
    assert first == client.get(f"{BASE}/opening-line/resolved", params={"language": main}, headers=h).json()["resolved_opening_line"]
