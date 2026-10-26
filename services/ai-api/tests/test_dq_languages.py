"""Job DQ part 3: Malayalam ('ml') joins the call and WhatsApp languages (en, te, hi, kn, ta, ml), and every member can read the assistant's name.

  A  every fixed text table has all six languages, with the same placeholders, and the new words are really in their script
  B  the language checks and the detector know Malayalam
  C  the assistant settings list six languages, each with an introduction and samples that say "AI" and "assistant"
  D  the assistant name is on the tenant read for every role (null before the first save)
No network, no database: the pure tables, the fake repository and the PostgREST adapter on a mock transport."""

from __future__ import annotations

import re
import uuid
from typing import get_args

import httpx
import pytest

from app.assistant import language as assistant_language
from app.assistant_settings import data as settings_data
from app.assistant_settings import models as settings_models
from app.assistant_settings import service as settings_service
from app.connectors import texts as connector_texts
from app.deliveries import messages as delivery_messages
from app.education import progress
from app.materials import text as materials_text
from app.outbox.models import Language as OutboxLanguage
from app.tenancy.repository import PostgrestTenantRepository
from app.visits import texts as visit_texts
from tests.fakes import TENANT_A, auth, make_client

SIX = ("en", "te", "hi", "kn", "ta", "ml")
MALAYALAM = re.compile(r"[ഀ-ൿ]")
TAMIL = re.compile(r"[஀-௿]")
PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def _holes(text: str) -> set[str]:
    return set(PLACEHOLDER.findall(text))


# ============================================================================ A. the text tables
def test_the_visit_templates_have_six_languages_with_the_same_holes() -> None:
    assert set(visit_texts.TEMPLATES) == set(SIX)
    for kind in ("confirmation", "reminder", "offer", "advance"):
        for language in SIX:
            assert _holes(visit_texts.TEMPLATES[language][kind]) == _holes(visit_texts.TEMPLATES["en"][kind]), (language, kind)
    assert len(visit_texts.WEEKDAYS["ml"]) == 7 and len(visit_texts.MONTHS["ml"]) == 12
    assert MALAYALAM.search(visit_texts.TEMPLATES["ml"]["confirmation"])


def test_a_malayalam_visit_message_is_rendered_and_is_not_english() -> None:
    from datetime import UTC, datetime

    text = visit_texts.render("confirmation", "ml", datetime(2026, 11, 3, 6, 30, tzinfo=UTC))
    assert MALAYALAM.search(text) and "{" not in text
    assert visit_texts.is_checked("ml") is False, "a Malayalam message waits for a native reader"


def test_the_delivery_updates_have_six_languages() -> None:
    for kind, words in delivery_messages.TEMPLATES.items():
        assert set(words) == set(SIX), kind
        for language in SIX:
            assert _holes(words[language]) == _holes(words["en"]), (kind, language)
    assert MALAYALAM.search(delivery_messages.compose("delivered", "ml", None, None))


def test_the_quote_words_have_six_languages() -> None:
    assert materials_text.LANGUAGES == SIX
    for table in (materials_text.WORDS, materials_text.UNIT_WORDS):
        for key, words in table.items():
            assert set(words) == set(SIX), key
            assert MALAYALAM.search(words["ml"]), key


def test_the_connector_sentences_have_six_languages() -> None:
    for table in (connector_texts.PAY_REQUEST, connector_texts.MISSED_CALL_REPLY):
        assert set(table) == set(SIX)
    assert _holes(connector_texts.PAY_REQUEST["ml"]) == _holes(connector_texts.PAY_REQUEST["en"])
    assert tuple(connector_texts.LANGUAGES) == SIX


def test_the_marks_templates_have_six_languages_and_stay_fixed_text() -> None:
    assert progress.LANGUAGES == SIX
    for kind, words in progress.TEMPLATES.items():
        assert set(words) == set(SIX), kind
        for language in SIX:
            assert _holes(words[language]) == _holes(words["en"]), (kind, language)
    message = progress.render("marks", "ml", "Demo School", {"student": "Anu", "subject": "Maths", "marks": "45", "out_of": "50", "term": "Term 1"})
    assert "Anu" in message.text and "45" in message.text and MALAYALAM.search(message.text)


# ============================================================================ B. the checks and the detector
def test_the_language_types_name_six() -> None:
    assert get_args(OutboxLanguage) == SIX
    assert get_args(settings_models.LanguageWord) == SIX


def test_a_malayalam_message_is_detected_and_a_reply_must_be_in_malayalam() -> None:
    assert assistant_language.detect_language("ഈ സാരിയുടെ വില എത്രയാണ്?") == "ml"
    assert assistant_language.detect_language("saree price?") == "en"
    assert assistant_language.reply_matches("ഇത് നിങ്ങളുടെ രേഖകളിൽ ഇല്ല", "ml")
    assert not assistant_language.reply_matches("This is in English", "ml")
    assert not assistant_language.reply_matches("இது தமிழ்", "ml"), "a Tamil reply is not a Malayalam one"
    for table in (assistant_language.NO_ANSWER, assistant_language.PLAIN_WORDS, assistant_language.WEB_SOURCES, assistant_language.SEE_CARDS, assistant_language.WAITING_ALSO):
        assert set(table) == set(SIX)
        assert assistant_language.reply_matches(table["ml"], "ml") or len(table["ml"]) < 14


# ============================================================================ C. the assistant settings
def test_the_assistant_settings_list_six_languages_with_introductions_and_samples() -> None:
    assert settings_service.LANGUAGES == SIX
    assert set(settings_service.NATIVE) == set(SIX)
    assert set(settings_service.CUSTOMER_LINES) == set(SIX) and set(settings_service.CONFIRM_LINES) == set(SIX)
    data = settings_data.load()
    assert data["languages"] == list(SIX)
    for language in SIX:
        word = settings_data.ASSISTANT_WORD[language]
        line = settings_data.intro(language, "Vijaya", "Demo Store")
        assert "AI" in line and word in line and "Vijaya" in line, language
        for business in ("textiles", "construction_materials", "education"):
            for style in ("warm", "respectful", "quick"):
                sample = settings_data.sample(business, language, style, "Vijaya", "Demo Store")
                assert "AI" in sample and word in sample, (language, business, style)
                assert "{" not in sample


def test_the_new_language_samples_are_in_their_script() -> None:
    for business in ("textiles", "construction_materials", "education"):
        assert MALAYALAM.search(settings_data.sample(business, "ml", "warm", "Vijaya", "X"))
        assert TAMIL.search(settings_data.sample(business, "ta", "warm", "Vijaya", "X"))


# ============================================================================ D. the assistant name
def test_every_role_reads_the_assistant_name_on_the_tenant_and_it_is_null_before_a_save() -> None:
    client, repository = make_client()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        body = client.get(f"/v1/tenants/{TENANT_A.id}", headers=auth(user)).json()
        assert body["assistant_name"] is None, user
    repository.assistant_names[TENANT_A.id] = "Vijaya"
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        body = client.get(f"/v1/tenants/{TENANT_A.id}", headers=auth(user)).json()
        assert body["assistant_name"] == "Vijaya", user


def test_the_name_is_read_with_the_callers_own_token_through_the_one_function() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json="Vijaya")

    repo = PostgrestTenantRepository("http://rest.test", "anon-key", client=httpx.Client(base_url="http://rest.test", transport=httpx.MockTransport(handler)))
    tenant = uuid.UUID(int=7)
    assert repo.get_assistant_name("user.jwt", tenant) == "Vijaya"
    assert seen[0].url.path.endswith("/rpc/assistant_name_get")
    assert seen[0].headers["authorization"] == "Bearer user.jwt"
    assert b"p_tenant_id" in seen[0].content

    empty = PostgrestTenantRepository("http://rest.test", "anon-key", client=httpx.Client(base_url="http://rest.test", transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"null", headers={"content-type": "application/json"}))))
    assert empty.get_assistant_name("user.jwt", tenant) is None


@pytest.mark.parametrize("language", SIX)
def test_the_samples_never_promise_a_human(language: str) -> None:
    line = settings_data.sample("textiles", language, "warm", "Vijaya", "Demo Store")
    assert "AI" in line, "the call always says it is an AI assistant"
