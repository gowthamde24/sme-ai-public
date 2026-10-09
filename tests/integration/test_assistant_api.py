"""Job AG / G2 on the real stack: the Main agent through OUR API, with the development stand-in model. Real JWT verification, real PostgREST, the real database functions,
the caller's own token. A business with a draft quote, a follow-up draft, a cancelled order holding money; every role; the kill switch; the daily cap; a retry; and the proof that
a chat is private to its owner and one business never reads another's. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import operator_sql
import pytest
from assistant_support import assistant_app, enable_assistant, events, restore, text_of
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient
from test_today_api import Scene


@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack)


@pytest.fixture(scope="module")
def scene(eval_world: World, client: TestClient) -> Iterator[Scene]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield Scene(eval_world, client)
    finally:
        restore(saved)


def say(
    app: TestClient,
    scene: Scene,
    user: str,
    text: str,
    *,
    tenant: Any = None,
    conversation: str | None = None,
    message: str | None = None,
) -> Any:
    t = tenant or scene.a
    body: dict[str, Any] = {"message_id": message or str(uuid.uuid4()), "text": text}
    if conversation:
        body["conversation_id"] = conversation
    return app.post(
        f"/v1/tenants/{t.id}/assistant/messages", json=body, headers=bearer(t.users[user])
    )


def test_it_answers_from_the_owners_own_business_with_sources_and_streams(
    app: TestClient, scene: Scene
) -> None:
    r = say(app, scene, "owner", "What is waiting for me today?")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream"), (
        r.text
    )
    evts = events(r)
    names = [e for e, _ in evts]
    assert names[0] == "start" and names[-1] == "done"
    assert (
        "step" in names
        and "delta" in names
        and names.index("sources") < names.index("drafts") < names.index("done")
    )
    assert [d["tool"] for e, d in evts if e == "step"] == ["get_today"]
    sources = next(d for e, d in evts if e == "sources")["sources"]
    ids = {s["id"] for s in sources}
    assert scene.draft_quote in ids and scene.held_order in ids, (
        "the answer cites the real quote and order it found"
    )
    assert all(s["label"] and s["type"] in {"quote", "lead", "order"} for s in sources)
    assert "₹" in text_of(evts) and "400.00" in text_of(evts), (
        "money appears only as a tool gave it"
    )


def test_the_chat_is_stored_per_business_and_read_back_with_fresh_labels(
    app: TestClient, scene: Scene
) -> None:
    first = events(say(app, scene, "owner", "Show my quotes"))
    cid = first[0][1]["conversation_id"]
    second = events(say(app, scene, "owner", "And my orders?", conversation=cid))
    assert second[0][1]["conversation_id"] == cid
    got = app.get(
        f"/v1/tenants/{scene.a.id}/assistant/conversations/{cid}",
        headers=bearer(scene.a.users["owner"]),
    )
    assert got.status_code == 200, got.text
    body = got.json()
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user", "assistant"]
    assistant = [m for m in body["messages"] if m["role"] == "assistant"]
    assert all(
        m["sources"] and all(s["label"] != "(no longer available)" for s in m["sources"])
        for m in assistant
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.assistant_messages where conversation_id = '{cid}'"
        )
        == "4"
    )


def test_every_message_is_a_run_with_its_steps_and_its_cost(app: TestClient, scene: Scene) -> None:
    cid = events(say(app, scene, "owner", "What are the prices?"))[0][1]["conversation_id"]
    run = operator_sql.sql(
        f"select r.id from public.agent_runs r where r.conversation_id = '{cid}' order by r.created_at desc limit 1"
    )
    assert (
        operator_sql.sql(
            f"select status || ':' || agent_name from public.agent_runs where id = '{run}'"
        )
        == "succeeded:assistant"
    )
    steps = operator_sql.sql(
        f"select string_agg(tool_name || ':' || status, ',' order by step_key) from public.agent_run_steps where run_id = '{run}'"
    )
    assert steps.startswith("find_price:ok"), steps
    assert (
        int(
            operator_sql.sql(
                f"select count(*) from public.agent_cost_reservations where run_id = '{run}' and settled_micros is not null"
            )
        )
        >= 2
    )
    assert (
        operator_sql.sql(
            f"select cost_day = app.agent_utc_today() from public.agent_cost_reservations where run_id = '{run}' limit 1"
        )
        == "t"
    )


def test_the_same_message_again_replays_the_answer_and_spends_nothing(
    app: TestClient, scene: Scene
) -> None:
    message = str(uuid.uuid4())
    first = say(app, scene, "owner", "What is pending?", message=message)
    cid = events(first)[0][1]["conversation_id"]
    runs = operator_sql.sql(
        f"select count(*) from public.agent_runs where conversation_id = '{cid}'"
    )
    again = say(app, scene, "owner", "What is pending?", message=message, conversation=cid)
    evts = events(again)
    assert (
        again.status_code == 200
        and evts[0][1]["replayed"] is True
        and text_of(evts) == text_of(events(first))
    )
    assert (
        operator_sql.sql(f"select count(*) from public.agent_runs where conversation_id = '{cid}'")
        == runs
    )
    other = say(app, scene, "owner", "Something else", message=message, conversation=cid)
    assert other.status_code == 409 and other.json()["error"]["code"] == "message_id_used"


def test_a_chat_is_private_to_the_person_who_started_it(app: TestClient, scene: Scene) -> None:
    cid = events(say(app, scene, "owner", "Show my quotes"))[0][1]["conversation_id"]
    for user in ("admin", "sales"):
        r = app.get(
            f"/v1/tenants/{scene.a.id}/assistant/conversations/{cid}",
            headers=bearer(scene.a.users[user]),
        )
        assert r.status_code == 404, user
    stranger = scene.b.users["owner"]
    assert (
        app.get(
            f"/v1/tenants/{scene.a.id}/assistant/conversations/{cid}", headers=bearer(stranger)
        ).status_code
        == 404
    )
    assert (
        app.get(
            f"/v1/tenants/{scene.b.id}/assistant/conversations/{cid}", headers=bearer(stranger)
        ).status_code
        == 404
    ), "not even through their own business"
    # nor can another person continue it
    r = say(app, scene, "admin", "continue", conversation=cid)
    assert r.status_code == 404


def test_it_reads_only_the_business_of_the_person_asking(app: TestClient, scene: Scene) -> None:
    mine = events(say(app, scene, "owner", "Show my follow-ups"))
    theirs = events(say(app, scene, "owner", "Show my follow-ups", tenant=scene.b))
    mine_ids = {s["id"] for s in next(d for e, d in mine if e == "sources")["sources"]}
    their_ids = {s["id"] for s in next(d for e, d in theirs if e == "sources")["sources"]}
    assert scene.draft_a in mine_ids and scene.draft_b not in mine_ids
    assert scene.draft_b in their_ids and scene.draft_a not in their_ids
    assert mine_ids.isdisjoint(their_ids)


def test_roles_and_membership(app: TestClient, scene: Scene) -> None:
    assert say(app, scene, "viewer", "hello").status_code == 403
    assert say(app, scene, "owner", "hello", tenant=scene.a).status_code == 200
    stranger = scene.b.users["owner"]
    r = app.post(
        f"/v1/tenants/{scene.a.id}/assistant/messages",
        json={"message_id": str(uuid.uuid4()), "text": "hi"},
        headers=bearer(stranger),
    )
    assert r.status_code == 404
    assert (
        app.post(
            f"/v1/tenants/{scene.a.id}/assistant/messages",
            json={"message_id": str(uuid.uuid4()), "text": "hi"},
        ).status_code
        == 401
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.assistant_messages where tenant_id = '{scene.a.id}' and created_by = '{stranger.id}'"
        )
        == "0"
    )


def test_the_request_is_closed_no_price_no_tenant_no_role(app: TestClient, scene: Scene) -> None:
    for extra in (
        {"unit_price_paise": 100},
        {"tenant_id": str(scene.b.id)},
        {"role": "owner"},
        {"business_name": "x"},
    ):
        r = app.post(
            f"/v1/tenants/{scene.a.id}/assistant/messages",
            json={"message_id": str(uuid.uuid4()), "text": "hi", **extra},
            headers=bearer(scene.a.users["owner"]),
        )
        assert r.status_code == 422, extra
    for text in ("", "   ", "x" * 4001):
        r = app.post(
            f"/v1/tenants/{scene.a.id}/assistant/messages",
            json={"message_id": str(uuid.uuid4()), "text": text},
            headers=bearer(scene.a.users["owner"]),
        )
        assert r.status_code == 422


def test_the_kill_switches_each_stop_it_with_a_plain_409(app: TestClient, scene: Scene) -> None:
    runs_before = operator_sql.sql(
        f"select count(*) from public.agent_runs where tenant_id = '{scene.a.id}'"
    )
    messages_before = operator_sql.sql(
        f"select count(*) from public.assistant_messages where tenant_id = '{scene.a.id}'"
    )
    for off, on in (
        (
            f"update public.tenant_agent_settings set enabled = false where tenant_id = '{scene.a.id}'",
            f"update public.tenant_agent_settings set enabled = true where tenant_id = '{scene.a.id}'",
        ),
        (
            "update public.platform_flags set enabled = false where key = 'assistant_enabled'",
            "update public.platform_flags set enabled = true where key = 'assistant_enabled'",
        ),
        (
            "update public.platform_flags set enabled = false where key = 'agents_enabled'",
            "update public.platform_flags set enabled = true where key = 'agents_enabled'",
        ),
    ):
        operator_sql.sql(off)
        try:
            r = say(app, scene, "owner", "hello")
            assert r.status_code == 409 and r.json()["error"]["code"] == "agents_disabled", off
        finally:
            operator_sql.sql(on)
    assert (
        operator_sql.sql(f"select count(*) from public.agent_runs where tenant_id = '{scene.a.id}'")
        == runs_before
    )
    assert (
        operator_sql.sql(
            f"select count(*) from public.assistant_messages where tenant_id = '{scene.a.id}'"
        )
        == messages_before
    ), "a refused message is not stored"
    assert say(app, scene, "owner", "hello").status_code == 200


def test_the_daily_cost_cap_applies_to_the_assistant(app: TestClient, scene: Scene) -> None:
    operator_sql.sql(
        f"update public.tenant_agent_settings set daily_cost_cap_micros = 1 where tenant_id = '{scene.b.id}'"
    )
    try:
        r = say(app, scene, "owner", "hello", tenant=scene.b)
        assert r.status_code == 429 and r.json()["error"]["code"] == "cost_cap_reached"
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{scene.b.id}'"
        )
    assert say(app, scene, "owner", "hello", tenant=scene.b).status_code == 200


def test_the_status_read_says_switched_off_apart_from_not_available(
    client: TestClient, app: TestClient, scene: Scene
) -> None:
    def states(tenant: Any) -> dict[str, str]:
        r = app.get(f"/v1/tenants/{tenant.id}/agents/status", headers=bearer(tenant.users["owner"]))
        assert r.status_code == 200, r.text
        return {a["agent"]: a["state"] for a in r.json()}

    on = states(scene.a)
    assert on["main"] == "idle" and on["lead_finder"] == "not_available"
    operator_sql.sql(
        f"update public.tenant_agent_settings set enabled = false where tenant_id = '{scene.a.id}'"
    )
    try:
        off = states(scene.a)
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set enabled = true where tenant_id = '{scene.a.id}'"
        )
    assert (
        off["main"] == "switched_off"
        and off["researcher"] == "switched_off"
        and off["requirement_analyst"] == "switched_off"
    )
    assert off["lead_finder"] == "not_available", (
        "a helper that does not exist is not 'switched off'"
    )
