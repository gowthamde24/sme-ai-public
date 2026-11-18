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


def test_our_own_form_sends_the_wording_it_showed_and_that_is_what_is_stored() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    r = client.post(f"/v1/lead-intake/{token}", data={"name": "Meena", "phone": "9876543210", "message": "Need a saree", "consent": "yes", "consent_text": WORDS})
    assert r.status_code == 202, r.text
    consent = repo.sent[-1]["consent"]
    assert {k: consent[k] for k in ("checkbox_key", "ticked", "disclaimer")} == {"checkbox_key": "consent", "ticked": True, "disclaimer": WORDS} and consent["given_at"]


def test_the_page_and_the_snippet_carry_the_wording_as_a_hidden_field() -> None:
    client, _, _ = world()
    made = make_source(client)
    page = client.get(f"/v1/lead-intake/{token_of(made)}/form").text
    for text in (made["secret"]["snippet_html"], page):
        assert f'name="consent_text" value="{WORDS}"' in text


def test_a_tick_with_no_wording_or_with_other_wording_and_no_time_is_ask_first() -> None:
    """Owner, 18 Nov 2026: "consent: true" from a connected tool is its own say-so; without the evidence it stays ask-first."""
    client, repo, _ = world()
    token = token_of(make_source(client))
    for extra in ({}, {"consent_text": "forged"}, {"consent_text": "The person agreed to be called about the enquiry."}, {"consent_at": "2026-11-18T10:00:00Z"}):
        assert client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543215", "consent": True, **extra}).status_code == 202
        assert "consent" not in repo.sent[-1], extra


def test_a_connected_tool_with_the_wording_and_the_time_is_believed_and_the_evidence_is_kept() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    from datetime import UTC, datetime, timedelta

    said = (datetime.now(UTC) - timedelta(hours=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    r = client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543213", "consent": True, "consent_text": "I agree that Neelambari Silks may WhatsApp me about my order.", "consent_at": said, "consent_form": "Diwali landing page"})
    assert r.status_code == 202
    consent = repo.sent[-1]["consent"]
    assert consent["ticked"] is True and consent["disclaimer"] == "I agree that Neelambari Silks may WhatsApp me about my order." and consent["form_name"] == "Diwali landing page"
    assert consent["given_at"].startswith(said[:19])


def test_a_time_in_the_future_or_older_than_30_days_or_not_a_time_is_ask_first() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    from datetime import UTC, datetime, timedelta

    for when in ((datetime.now(UTC) + timedelta(days=1)).isoformat(), (datetime.now(UTC) - timedelta(days=31)).isoformat(), "yesterday", "2026-13-45"):
        client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543216", "consent": True, "consent_text": "I agree to be contacted about my enquiry.", "consent_at": when})
        assert "consent" not in repo.sent[-1], when


def test_a_submission_without_the_tick_carries_no_consent() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    assert client.post(f"/v1/lead-intake/{token}", data={"name": "Latha", "phone": "9876543211"}).status_code == 202
    assert "consent" not in repo.sent[-1]
    for value in ("no", "off", "0", "false", ""):
        client.post(f"/v1/lead-intake/{token}", data={"name": "Latha", "phone": "9876543212", "consent": value})
        assert "consent" not in repo.sent[-1], value


def test_a_form_tool_that_sends_false_carries_no_consent() -> None:
    client, repo, _ = world()
    token = token_of(make_source(client))
    assert client.post(f"/v1/lead-intake/{token}", json={"name": "Ravi", "phone": "9876543214", "consent": "false", "consent_text": WORDS}).status_code == 202
    assert "consent" not in repo.sent[-1]


def test_the_cards_test_lead_never_carries_consent() -> None:
    client, repo, _ = world()
    assert client.get(T + "/lead-sources/website", headers=auth("a_owner")).status_code == 200   # the card's address is made on first use
    r = client.post(T + "/lead-sources/cards/website/test", headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    assert repo.sent and all("consent" not in row and "_ticked" not in row for row in repo.sent), "a test lead is never consented"
