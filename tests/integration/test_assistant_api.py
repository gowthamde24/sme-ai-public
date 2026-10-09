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
from assistant_support import (
    assistant_app,
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
    assert set(names) <= {"text", "source", "draft", "error", "done"}, names
    assert names[-1] == "done" and names.count("done") == 1 and "text" in names
    assert names.index("source") > max(i for i, n in enumerate(names) if n == "text")
    assert all(d["type"] == e for e, d in evts), "every data line repeats its event name as `type`"
    sources = sources_of(evts)
    ids = {s["id"] for s in sources}
    assert scene.draft_quote in ids and scene.held_order in ids, (
        "the answer cites the real quote and order it found"
    )
    assert all(s["label"] and s["kind"] in {"quote", "lead", "order"} for s in sources)
    assert "₹" in text_of(evts) and "400.00" in text_of(evts), (
        "money appears only as a tool gave it"
    )


def test_the_chat_is_stored_per_business_and_read_back_with_fresh_labels(
    app: TestClient, scene: Scene
) -> None:
    first = events(say(app, scene, "owner", "Show my quotes"))
    cid = conversation_of(first)
    second = events(say(app, scene, "owner", "And my orders?", conversation=cid))
    assert conversation_of(second) == cid
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
    cid = conversation_of(events(say(app, scene, "owner", "What are the prices?")))
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
    cid = conversation_of(events(first))
    runs = operator_sql.sql(
        f"select count(*) from public.agent_runs where conversation_id = '{cid}'"
    )
    again = say(app, scene, "owner", "What is pending?", message=message, conversation=cid)
    evts = events(again)
    assert (
        again.status_code == 200
        and evts[-1][1]["kind"] == "replayed"
        and text_of(evts) == text_of(events(first))
    )
    assert (
        operator_sql.sql(f"select count(*) from public.agent_runs where conversation_id = '{cid}'")
        == runs
    )
    other = say(app, scene, "owner", "Something else", message=message, conversation=cid)
    assert other.status_code == 409 and other.json()["error"]["code"] == "message_id_used"


def test_a_chat_is_private_to_the_person_who_started_it(app: TestClient, scene: Scene) -> None:
    cid = conversation_of(events(say(app, scene, "owner", "Show my quotes")))
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
    mine_ids = {s["id"] for s in sources_of(mine)}
    their_ids = {s["id"] for s in sources_of(theirs)}
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
        error = r.json()["error"]
        assert r.status_code == 429 and error["code"] == "ai_paused_until"
        assert error["until"].endswith("Z") and "keep working" in error["message"]
    finally:
        operator_sql.sql(
            f"update public.tenant_agent_settings set daily_cost_cap_micros = null where tenant_id = '{scene.b.id}'"
        )


class Allowance:
    """Plan allowance and trial start of workspace B, changed for one test and put back (job AK / K2)."""

    def __init__(self, tenant: Any) -> None:
        self.t = str(tenant.id)

    def __enter__(self) -> Allowance:
        self.plan = operator_sql.sql(
            "select daily_paise || ',' || monthly_paise from public.plan_ai_allowances where plan = 'free_trial'"
        )
        self.trial = operator_sql.sql(
            f"select trial_started_at from public.tenants where id = '{self.t}'"
        )
        return self

    def set(self, daily: int, monthly: int, trial_days_ago: int = 0) -> None:
        operator_sql.sql(
            f"update public.plan_ai_allowances set daily_paise = {daily}, monthly_paise = {monthly} where plan = 'free_trial'"
        )
        operator_sql.sql(
            f"update public.tenants set trial_started_at = now() - interval '{trial_days_ago} days' where id = '{self.t}'"
        )

    def spend(self, micros: int, days_ago: int = 0) -> None:
        run = operator_sql.sql(
            f"select id from public.agent_runs where tenant_id = '{self.t}' limit 1"
        )
        operator_sql.sql(
            "insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, settled_at, outcome) "
            f"values (gen_random_uuid(), '{self.t}', '{run}', 'ak2-{uuid.uuid4().hex[:8]}', app.agent_utc_today() - {days_ago}, 1, 1, {micros}, {micros}, repeat('c', 64), now(), 'used')"
        )

    def __exit__(self, *_: object) -> None:
        daily, monthly = self.plan.split(",")
        operator_sql.sql(
            f"update public.plan_ai_allowances set daily_paise = {daily}, monthly_paise = {monthly} where plan = 'free_trial'"
        )
        operator_sql.sql(
            f"update public.tenants set trial_started_at = '{self.trial}' where id = '{self.t}'"
        )
        operator_sql.sql(
            f"delete from public.agent_cost_reservations where tenant_id = '{self.t}' and step_key like 'ak2-%'"
        )


def usage(app: TestClient, scene: Scene) -> dict[str, Any]:
    r = app.get(f"/v1/tenants/{scene.b.id}/ai-usage", headers=bearer(scene.b.users["owner"]))
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_a_used_up_day_pauses_only_the_ai_and_says_when_it_is_back(
    app: TestClient, scene: Scene
) -> None:
    from datetime import datetime

    assert (
        say(app, scene, "owner", "hello", tenant=scene.b).status_code == 200
    )  # makes sure workspace B has a run to book spend against
    with Allowance(scene.b) as a:
        a.set(daily=1, monthly=100)  # one paisa a day
        before = usage(app, scene)  # the first hello already cost a few micros of the one paisa
        assert before["state"] == "ok" and before["today_percent"] < 100
        a.spend(10_000)  # exactly one paisa: the day is used up
        got = usage(app, scene)
        assert (
            got["today_percent"] == 100 and got["state"] == "paused" and got["month_percent"] == 1
        )
        assert set(got) == {
            "today_percent",
            "month_percent",
            "resets_at_today",
            "resets_at_month",
            "state",
        }
        r = say(app, scene, "owner", "hello", tenant=scene.b)
        error = r.json()["error"]
        assert r.status_code == 429 and error["code"] == "ai_paused_until"
        until = datetime.fromisoformat(error["until"].replace("Z", "+00:00"))
        assert until == datetime.fromisoformat(got["resets_at_today"]), (
            "back at the next Indian midnight"
        )
        # everything that is not AI keeps working
        for path in ("quotes", "orders", "companies", "today"):
            ok = app.get(f"/v1/tenants/{scene.b.id}/{path}", headers=bearer(scene.b.users["owner"]))
            assert ok.status_code == 200, (path, ok.text)
        # another workspace is not paused
        assert say(app, scene, "owner", "hello").status_code == 200
    assert say(app, scene, "owner", "hello", tenant=scene.b).status_code == 200, (
        "put back: B can ask again"
    )


def test_a_used_up_month_pauses_the_ai_with_the_day_still_empty_and_says_the_month_end(
    app: TestClient, scene: Scene
) -> None:
    from datetime import UTC, datetime, timedelta

    assert say(app, scene, "owner", "hello", tenant=scene.b).status_code == 200
    with Allowance(scene.b) as a:
        a.set(
            daily=100, monthly=100, trial_days_ago=10
        )  # a month of one rupee, started ten days ago
        a.spend(1_000_000, days_ago=3)  # ₹1 spent three days ago, inside the month
        got = usage(app, scene)
        assert (
            got["month_percent"] == 100 and got["today_percent"] == 0 and got["state"] == "paused"
        )
        r = say(app, scene, "owner", "hello", tenant=scene.b)
        error = r.json()["error"]
        assert r.status_code == 429 and error["code"] == "ai_paused_until"
        until = datetime.fromisoformat(error["until"].replace("Z", "+00:00"))
        assert until == datetime.fromisoformat(got["resets_at_month"])
        assert timedelta(days=15) < until - datetime.now(UTC) < timedelta(days=22), (
            "about twenty days away: the end of the month"
        )
        assert (
            app.get(
                f"/v1/tenants/{scene.b.id}/quotes", headers=bearer(scene.b.users["owner"])
            ).status_code
            == 200
        )


def test_the_percent_read_is_for_owner_and_admin_and_never_shows_money(
    app: TestClient, scene: Scene
) -> None:
    for user, status in (("owner", 200), ("admin", 200), ("sales", 403), ("viewer", 403)):
        r = app.get(f"/v1/tenants/{scene.a.id}/ai-usage", headers=bearer(scene.a.users[user]))
        assert r.status_code == status, (user, r.text)
    body = app.get(
        f"/v1/tenants/{scene.a.id}/ai-usage", headers=bearer(scene.a.users["owner"])
    ).json()
    assert "paise" not in str(body) and "micros" not in str(body) and "token" not in str(body)
