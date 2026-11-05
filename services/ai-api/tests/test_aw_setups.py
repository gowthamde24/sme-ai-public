"""Guided setups in the chat (docs/contracts/assistant-tools.md section 2 `setup`; owner, 5 Nov 2026): the card is made by code from the workspace's own state, the forwarding address and the
website form through the Lead sources service (made on first use, the same one after), the screen-only setups as steps and a link. The test route is read-only or passive: nothing is sent to anyone,
and IndiaMART with the workspace's own key imports nothing while the workspace takes example data only."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.assistant_work import setups
from app.assistant_work.router import check, touches
from tests.fakes import TENANT_A, auth
from tests.test_aw_files import BASE, cards_of
from tests.test_aw_router import say, world
from tests.test_ws_secrets import KEY, ROUTE, card_for, save, secrets_world


def setup_route(kind: str) -> dict[str, Any]:
    return {"decision": "do", "action": "setup", "args": {"setup": kind}}


def switched_on(client: Any) -> Any:
    service = client.app.state.runtime.lead_sources
    service.inbound_domain, service.base = "in.example.test", "https://api.example.test"
    return service


def run_test(client: Any, setup_id: str, test: str, user: str = "a_owner") -> Any:
    return client.post(f"{BASE}/setups/{setup_id}/test", json={"test": test}, headers=auth(user))


# ============================================================================ the words and the router
@pytest.mark.parametrize(("text", "kind"), [("forward my JustDial lead emails to you", "email_forward"), ("put a lead form on my website", "website_form"),
                                            ("invite my team", "team_invite"), ("set up the voice and language", "voice_language"),
                                            ("set up follow-up rules", "followup_rules"), ("get leads from my google sheet", "google_sheet")])
def test_the_words_that_route_to_a_setup(text: str, kind: str) -> None:
    assert touches(text), text
    assert check(setup_route(kind), text).args == {"setup": kind}


def test_an_unknown_setup_is_a_question_and_indiamart_is_the_key_card() -> None:
    assert check(setup_route("crm_sync"), "set up my crm sync").decision == "clarify"
    got = check(setup_route("indiamart"), "set up IndiaMART")
    assert got.decision == "do" and got.action == "source_key" and got.args == {"source": "indiamart"}


# ============================================================================ the cards
def test_forwarding_makes_the_address_once_and_the_card_has_it_with_the_portals() -> None:
    client, _, _, _, repo = world(setup_route("email_forward"), setup_route("email_forward"))
    switched_on(client)
    (card,) = cards_of(say(client, "forward my JustDial lead emails"))
    assert card["kind"] == "setup" and card["setup"] == "email_forward" and card["id"] == str(setups.setup_id(TENANT_A.id, "email_forward"))
    address = card["copy"][0]["value"]
    assert address.startswith("leads+") and address.endswith("@in.example.test") and card["test"] == "send_test_mail" and card["last_test"] is None
    assert [p["name"] for p in card["portals"]] == ["JustDial", "IndiaMART e-mail", "99acres", "MagicBricks", "Sulekha"] and card["screen"]["href"] == "/lead-sources"
    (again,) = cards_of(say(client, "forward my JustDial lead emails"))
    assert again["copy"][0]["value"] == address and repo.calls.count("source_create") == 1, "the same address, made once"


def test_the_website_form_card_has_the_snippet_the_link_and_the_webhook() -> None:
    client, *_ = world(setup_route("website_form"))
    switched_on(client)
    (card,) = cards_of(say(client, "put a lead form on my website"))
    labels = [c["label"] for c in card["copy"]]
    assert card["setup"] == "website_form" and card["test"] == "send_test_lead" and len(labels) == 3
    snippet, link, hook = (c["value"] for c in card["copy"])
    assert snippet.startswith("<form method=\"post\"") and "<script" not in snippet and link.endswith("/form") and hook.startswith("https://api.example.test/v1/lead-intake/")


def test_not_switched_on_is_not_yet_with_the_screen() -> None:
    client, *_ = world(setup_route("email_forward"))
    (card,) = cards_of(say(client, "forward my JustDial lead emails"))
    assert card["kind"] == "cant_do" and card["reason"] == "not_yet" and card["screen"]["href"] == "/lead-sources"


@pytest.mark.parametrize(("kind", "href"), [("team_invite", "/settings/members"), ("voice_language", "/settings/assistant"), ("followup_rules", "/lead-desk/rules"), ("google_sheet", "/lead-sources")])
def test_the_screen_only_setups_are_steps_and_a_link(kind: str, href: str) -> None:
    client, *_ = world(setup_route(kind))
    text = {"team_invite": "invite my team", "voice_language": "set up the voice and language", "followup_rules": "set up follow-up rules", "google_sheet": "get leads from my google sheet"}[kind]
    (card,) = cards_of(say(client, text))
    assert card["kind"] == "setup" and card["screen"]["href"] == href and card["steps"] and card["test"] is None and card["copy"] == []


def test_a_sales_member_gets_no_address() -> None:
    client, *_ = world(setup_route("email_forward"))
    switched_on(client)
    evs = say(client, "forward my JustDial lead emails", user="a_sales")
    assert cards_of(evs) == [] and "owner or an admin" in "".join(d.get("delta", "") for n, d in evs if n == "text"), "the address is made by an Owner or an Admin only"


# ============================================================================ the tests
def test_the_indiamart_card_carries_its_setup_test() -> None:
    client, *_ = secrets_world(ROUTE)
    card = card_for(client)
    assert card["setup_id"] == str(setups.setup_id(TENANT_A.id, "indiamart")) and card["test"] == "pull_now"


def test_pull_now_with_no_key_says_so() -> None:
    client, *_ = secrets_world(ROUTE)
    got = run_test(client, card_for(client)["setup_id"], "pull_now")
    assert got.status_code == 200 and got.json()["ok"] is False and got.json()["reason"] == "no_key", got.text


def test_pull_now_while_the_gate_is_closed_checks_the_key_and_imports_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    client, _, _, _ = secrets_world(ROUTE)
    card = card_for(client)
    assert save(client, card["request_id"], {"value": KEY}).status_code == 200
    seen: list[tuple[str, Any]] = []

    class Pull:
        def __init__(self, key: str) -> None:
            seen.append(("key", key))

        def pull(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
            seen.append(("window", end - start))
            return [{"x": 1}, {"x": 2}]

    monkeypatch.setattr("app.connectors.indiamart.IndiaMartPull", Pull)
    monkeypatch.setattr("app.lead_sources.indiamart.pull", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no import while the gate is closed")))
    got = run_test(client, card["setup_id"], "pull_now")
    body = got.json()
    assert got.status_code == 200 and body["ok"] is True and "2 enquiries" in body["detail"] and "Nothing was imported" in body["detail"], got.text
    assert seen == [("key", KEY), ("window", timedelta(days=1))] and KEY not in got.text


def test_pull_now_with_a_refused_key_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.connectors.errors import ProviderError

    client, *_ = secrets_world(ROUTE)
    card = card_for(client)
    assert save(client, card["request_id"], {"value": KEY}).status_code == 200

    class Pull:
        def __init__(self, key: str) -> None:
            pass

        def pull(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
            raise ProviderError("unauthorized")

    monkeypatch.setattr("app.connectors.indiamart.IndiaMartPull", Pull)
    got = run_test(client, card["setup_id"], "pull_now").json()
    assert got["ok"] is False and got["reason"] == "key_rejected"


def test_the_mail_test_is_passive_and_looks_at_what_arrived() -> None:
    client, _, _, _, repo = world(setup_route("email_forward"))
    switched_on(client)
    (card,) = cards_of(say(client, "forward my JustDial lead emails"))
    first = run_test(client, card["id"], "send_test_mail").json()
    assert first["ok"] is False and first["reason"] == "nothing_arrived"
    sid = next(k for k, v in repo.sources_.items() if v["kind"] == "email_forward")
    repo.sources_[sid].update(last_received_at=(datetime.now(UTC) - timedelta(minutes=2)).isoformat(), received_count=1)
    second = run_test(client, card["id"], "send_test_mail").json()
    assert second["ok"] is True and "1 received" in second["detail"]


def test_a_setup_id_is_the_workspaces_own_and_the_test_must_match_its_kind() -> None:
    client, *_ = world()
    other = setups.setup_id(uuid.uuid4(), "email_forward")
    assert run_test(client, str(other), "send_test_mail").status_code == 404, "another workspace's id"
    mine = setups.setup_id(TENANT_A.id, "email_forward")
    assert run_test(client, str(mine), "pull_now").status_code == 404, "the test of another kind"
    assert run_test(client, "not-a-uuid", "send_test_mail").status_code == 404
    assert client.post(f"{BASE}/setups/{mine}/test", json={"test": "send_test_mail", "x": 1}, headers=auth("a_owner")).status_code == 422
    assert run_test(client, str(mine), "send_test_mail", user="a_sales").status_code == 403, "Owner or Admin"


def test_received_test_counts_only_the_last_day() -> None:
    old = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    assert setups.received_test([{"kind": "website_form", "last_received_at": old, "received_count": 4}], "website_form", "website form")["ok"] is False
    assert setups.received_test([], "website_form", "website form")["reason"] == "nothing_arrived"
    assert setups.kind_of(TENANT_A.id, setups.setup_id(TENANT_A.id, "google_sheet")) == "google_sheet"
