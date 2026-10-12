"""Job BP (ADR 0078) on the real stack: the web research tools inside Agent OWL, through OUR API, with a scripted model and fake providers. Real JWT verification, real PostgREST, the real database functions
(the daily limit, the query check, the accounting ledger), the caller's own token. Proven: a web answer is cited live and named in the stored text but never stored as a source pair; every web call is a
reservation on the AI ledger; the shop's daily limit stops a call BEFORE the provider; a customer's name never leaves; the status route; and confirming a shop from the map (one company, one lead, only the
place ID kept, idempotent, isolated per business). All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import dataclasses
import json
import uuid
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from assistant_support import (
    conversation_of,
    enable_assistant,
    events,
    restore,
    sources_of,
    text_of,
)
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient

from app.agents.llm.interface import LlmRequest, LlmResponse, ToolCall, Usage
from app.agents.web import SearchHit
from app.config import Settings
from app.main import build_runtime, create_app
from app.websearch.metals import FixtureMetals
from app.websearch.places import FixturePlaces
from app.websearch.service import ResearchWeb

PLACE = "ChIJFIXTURE000000002"


class Search:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def search(self, query: str, *, limit: int = 5) -> list[SearchHit]:
        self.queries.append(query)
        return [SearchHit("https://news.example-sarees.test/a", "Saree news", "An invented article.")]


class Script:
    """Turn 1: the tool calls given; turn 2: the answer given (the same for every question of the test)."""

    model_id = "fake-selftest"

    def __init__(self) -> None:
        self.calls: tuple[ToolCall, ...] = ()
        self.final: dict[str, Any] = {}
        self.turn_of: dict[int, int] = {}

    def complete(self, request: LlmRequest) -> LlmResponse:
        seen = sum(1 for b in request.blocks if "tool: " in b.text)
        if seen == 0:
            return LlmResponse(tool_calls=self.calls, structured=None, usage=Usage(10, 5, 0))
        return LlmResponse(tool_calls=(), structured=self.final, usage=Usage(10, 5, 0))


@pytest.fixture(scope="module")
def search() -> Search:
    return Search()


@pytest.fixture(scope="module")
def script() -> Script:
    return Script()


@pytest.fixture(scope="module")
def app(stack: Any, search: Search, script: Script) -> Iterator[TestClient]:
    settings = Settings(_env_file=None, api_env="development", supabase_url=stack.url, supabase_anon_key=stack.anon_key, agents_enabled=True, llm_provider="fake")  # type: ignore[call-arg]
    runtime = build_runtime(settings)
    assert runtime is not None and runtime.agents is not None
    runtime = dataclasses.replace(
        runtime,
        agents=dataclasses.replace(runtime.agents, assistant_llm=lambda: script),
        research_web=ResearchWeb(search=search, places=FixturePlaces(), metals=FixtureMetals()),
    )
    with TestClient(create_app(settings, runtime=runtime)) as client:
        yield client


@pytest.fixture(scope="module")
def world(eval_world: World) -> Iterator[World]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield eval_world
    finally:
        restore(saved)


def say(app: TestClient, w: World, text: str, user: str = "owner") -> Any:
    return app.post(f"/v1/tenants/{w.a.id}/assistant/messages", json={"message_id": str(uuid.uuid4()), "text": text}, headers=bearer(w.a.users[user]))


def used_today(tenant: Any, model: str) -> int:
    return int(operator_sql.sql(f"select count(*) from public.agent_cost_reservations where tenant_id = '{tenant.id}' and model = '{model}' and outcome is distinct from 'not_billed'"))


def test_a_web_answer_is_cited_live_named_in_the_text_and_never_stored_as_a_source(app: TestClient, world: World, search: Search, script: Script) -> None:
    script.calls = (ToolCall("web_search", {"query": "silk saree wholesale demand"}),)
    script.final = {"kind": "answer", "answer": "One article says demand for silk sarees is steady.", "language": "en", "sources": ["s1"]}
    before = used_today(world.a, "web-search")
    r = say(app, world, "search the web for silk saree demand")
    assert r.status_code == 200, r.text
    evts = events(r)
    live = sources_of(evts)
    assert [s["kind"] for s in live] == ["web"] and live[0]["url"] == "https://news.example-sarees.test/a" and live[0]["label"] == "Saree news"
    assert "From the web: Saree news (https://news.example-sarees.test/a)" in text_of(evts)
    assert search.queries[-1] == "silk saree wholesale demand"
    # stored: the text, and no source pair for the web page
    cid = conversation_of(evts)
    got = app.get(f"/v1/tenants/{world.a.id}/assistant/conversations/{cid}", headers=bearer(world.a.users["owner"])).json()
    reply = [m for m in got["messages"] if m["role"] == "assistant"][-1]
    assert "From the web:" in reply["text"] and reply["sources"] == []
    # the call is on the AI ledger, at the documented price (600 tokens x 1,000 micros)
    assert used_today(world.a, "web-search") == before + 1
    assert operator_sql.sql(f"select max(settled_micros) from public.agent_cost_reservations where tenant_id = '{world.a.id}' and model = 'web-search'") == "600000"


def test_the_daily_limit_stops_a_call_before_the_provider(app: TestClient, world: World, search: Search, script: Script) -> None:
    script.calls = (ToolCall("web_search", {"query": "silk saree wholesale demand"}),)
    script.final = {"kind": "refusal", "answer": "I cannot search right now.", "language": "en", "sources": []}
    cap = used_today(world.a, "web-search")
    operator_sql.sql(f"update research.web_caps set per_day = {max(cap, 1)} where model = 'web-search'")
    try:
        queries = len(search.queries)
        r = say(app, world, "search the web for silk saree demand")
        assert r.status_code == 200 and sources_of(events(r)) == []
        assert len(search.queries) == queries, "the provider was not called"
        assert used_today(world.a, "web-search") == cap, "the refused call made no reservation"
    finally:
        operator_sql.sql("update research.web_caps set per_day = 30 where model = 'web-search'")


def test_a_customers_name_never_leaves(app: TestClient, world: World, search: Search, script: Script) -> None:
    contact = uuid.uuid4()
    operator_sql.sql(f"insert into public.contacts (id, tenant_id, company_id, full_name) select '{contact}', '{world.a.id}', id, 'Lakshmi Devi Rao' from public.companies where tenant_id = '{world.a.id}' limit 1")
    try:
        script.calls = (ToolCall("web_search", {"query": "is Lakshmi Devi Rao a reliable payer"}),)
        script.final = {"kind": "refusal", "answer": "I cannot search for a customer.", "language": "en", "sources": []}
        queries = len(search.queries)
        before = used_today(world.a, "web-search")
        r = say(app, world, "search the web for Lakshmi Devi Rao")
        assert r.status_code == 200
        assert len(search.queries) == queries and used_today(world.a, "web-search") == before
    finally:
        operator_sql.sql(f"delete from public.contacts where id = '{contact}'")


def test_a_phone_number_in_a_query_never_leaves(app: TestClient, world: World, search: Search, script: Script) -> None:
    script.calls = (ToolCall("web_search", {"query": "who owns 9876543210 shop"}),)
    script.final = {"kind": "refusal", "answer": "I cannot search for that.", "language": "en", "sources": []}
    queries = len(search.queries)
    say(app, world, "search the web for this number")
    assert len(search.queries) == queries


def test_the_metal_price_and_the_places_are_ledgered_and_not_stored(app: TestClient, world: World, script: Script) -> None:
    script.calls = (ToolCall("get_metal_prices", {}), ToolCall("find_retailers", {"query": "saree wholesalers", "city": "Guntur"}))
    script.final = {"kind": "answer", "answer": "Balaji Sarees Wholesale in Guntur is one place to look.", "language": "en", "sources": ["s3"]}
    r = say(app, world, "find wholesalers in Guntur and the gold rate today")
    evts = events(r)
    assert [s["kind"] for s in sources_of(evts)] == ["place"], evts
    # job CE: the card carries Google's real place ID, which is what POST /places/confirm takes; it is not in anything stored
    (card,) = sources_of(evts)
    assert card["place_id"] == PLACE and card["id"] != PLACE
    assert PLACE not in operator_sql.sql(f"select string_agg(body || coalesce(sources::text, ''), ' ') from public.assistant_messages where conversation_id = '{conversation_of(evts)}'")
    # (test_confirming_a_place_... below confirms exactly this ID through the route, so the card's value is what the route takes)
    stored = operator_sql.sql(f"select body from public.assistant_messages where conversation_id = '{conversation_of(evts)}' and role = 'assistant'")
    assert "Balaji" not in stored and "(see the cards)" in stored
    assert used_today(world.a, "places-search") >= 1 and used_today(world.a, "metal-price") >= 1
    assert operator_sql.sql(f"select max(settled_micros) from public.agent_cost_reservations where tenant_id = '{world.a.id}' and model = 'places-search'") == "3000000"


def test_the_status_route(app: TestClient, world: World) -> None:
    url = f"/v1/tenants/{world.a.id}/research/status"
    body = app.get(url, headers=bearer(world.a.users["owner"])).json()
    assert body["tools"]["web_search"]["enabled"] is True and body["tools"]["web_search"]["daily_limit"] == 30 and body["tools"]["web_search"]["used_today"] >= 1
    assert body["tools"]["read_page"] == {"enabled": False, "used_today": None, "daily_limit": None}
    assert app.get(url, headers=bearer(world.a.users["sales"])).status_code == 403
    assert app.get(url, headers=bearer(world.b.users["owner"])).status_code == 404 or app.get(f"/v1/tenants/{world.b.id}/research/status", headers=bearer(world.a.users["owner"])).status_code == 404


def test_confirming_a_place_makes_one_company_and_one_lead_and_keeps_only_the_place_id(app: TestClient, world: World) -> None:
    url = f"/v1/tenants/{world.a.id}/places/confirm"
    body = {"place_id": PLACE, "company_name": "Balaji Sarees", "city": "Guntur"}
    first = app.post(url, json=body, headers=bearer(world.a.users["sales"]))
    assert first.status_code == 201, first.text
    second = app.post(url, json=body, headers=bearer(world.a.users["sales"]))
    assert second.status_code == 200 and second.json() == {**first.json(), "created": False}
    out = first.json()
    row = json.loads(operator_sql.sql(f"select row_to_json(l) from public.leads l where id = '{out['lead_id']}'"))
    assert row["source"] == f"places:{PLACE}" and row["company_id"] == out["company_id"] and row["tenant_id"] == str(world.a.id)
    company = json.loads(operator_sql.sql(f"select row_to_json(c) from public.companies c where id = '{out['company_id']}'"))
    assert company["name"] == "Balaji Sarees" and company["city"] == "Guntur" and company["website"] is None
    assert operator_sql.sql(f"select count(*) from public.companies where tenant_id = '{world.a.id}' and name = 'Balaji Sarees'") == "1"
    # a viewer cannot; another business's owner cannot reach this business; the same place in business B is its own pair of rows
    assert app.post(url, json=body, headers=bearer(world.a.users["viewer"])).status_code == 403
    assert app.post(url, json=body, headers=bearer(world.b.users["owner"])).status_code == 404
    other = app.post(f"/v1/tenants/{world.b.id}/places/confirm", json=body, headers=bearer(world.b.users["owner"]))
    assert other.status_code == 201 and other.json()["lead_id"] != out["lead_id"]
    assert app.post(url, json={**body, "company_name": "Another Name"}, headers=bearer(world.a.users["owner"])).status_code == 409
