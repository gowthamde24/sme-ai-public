"""The Website form carries consent per lead (migration 20261231982100, 17 Nov 2026): a required checkbox on the hosted form and in the snippet, "I agree that {business} may call or WhatsApp me about my enquiry"; a ticked
submission goes to the database with the SERVER's wording (never the sender's); an unticked one is ask-first. The database's own rules are proved in supabase/tests/database/230_website_form_consent.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from tests.fakes import auth
from tests.test_dr_lead_sources import T, make_source, world

WORDS = "I agree that Neelambari Silks may call or WhatsApp me about my enquiry"


def token_of(made: dict[str, Any]) -> str:
    return str(made["secret"]["url"]).rsplit("/", 1)[1]


def test_the_snippet_has_a_required_consent_checkbox_with_the_business_name() -> None:
    client, _, _ = world()
    made = make_source(client)
    snippet = made["secret"]["snippet_html"]
    assert 'type="checkbox" name="consent" value="yes" required' in snippet
    assert WORDS in snippet
    assert snippet.index('name="phone"') < snippet.index('name="consent"') < snippet.index('type="submit"'), "the box sits before the button"


def test_the_hosted_form_has_the_same_checkbox_and_the_same_words() -> None:
    client, _, _ = world()
    token = token_of(make_source(client))
    page = client.get(f"/v1/lead-intake/{token}/form")
    assert page.status_code == 200
    assert 'name="consent" value="yes" required' in page.text and WORDS in page.text


def test_an_unknown_address_shows_the_same_page_with_a_generic_business() -> None:
    client, _, _ = world()
    page = client.get("/v1/lead-intake/" + "a" * 32 + "/form")
    assert page.status_code == 200 and "I agree that this business may call or WhatsApp me about my enquiry" in page.text, "no business name leaks for an address that is not live"


def test_a_business_name_is_escaped_in_the_page_and_the_snippet() -> None:
    client, repo, _ = world()
    repo.business = '<b onmouseover="x">Shop & Co</b>'  # type: ignore[attr-defined]
    made = make_source(client)
    snippet = made["secret"]["snippet_html"]
    page = client.get(f"/v1/lead-intake/{token_of(made)}/form").text
    for text in (snippet, page):
        assert "<b onmouseover" not in text and "&lt;b onmouseover=&quot;x&quot;&gt;Shop &amp; Co&lt;/b&gt;" in text


def test_a_ticked_submission_is_sent_with_the_servers_wording() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    r = client.post(f"/v1/lead-intake/{token}", data={"name": "Meena", "phone": "9876543210", "message": "Need a saree", "consent": "yes", "disclaimer": "I agree to anything", "consent_text": "forged"})
    assert r.status_code == 202, r.text
    consent = repo.sent[-1]["consent"]
    assert consent == {"checkbox_key": "consent", "ticked": True, "disclaimer": WORDS}, "the stored wording is the server's, not the sender's"


def test_a_submission_without_the_tick_carries_no_consent() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    assert client.post(f"/v1/lead-intake/{token}", data={"name": "Latha", "phone": "9876543211"}).status_code == 202
    assert "consent" not in repo.sent[-1]
    for value in ("no", "off", "0", "false", ""):
        client.post(f"/v1/lead-intake/{token}", data={"name": "Latha", "phone": "9876543212", "consent": value})
        assert "consent" not in repo.sent[-1], value


def test_a_form_tool_can_send_the_same_field_as_json() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    assert client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543213", "consent": True}).status_code == 202
    assert repo.sent[-1]["consent"]["ticked"] is True
    assert client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543214", "consent": "false"}).status_code == 202
    assert "consent" not in repo.sent[-1]


def test_the_cards_test_lead_never_carries_consent() -> None:
    client, repo, _ = world()
    assert client.get(T + "/lead-sources/website", headers=auth("a_owner")).status_code == 200   # the card's address is made on first use
    r = client.post(T + "/lead-sources/cards/website/test", headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    assert repo.sent and all("consent" not in row and "_ticked" not in row for row in repo.sent), "a test lead is never consented"
