"""Job AD / D3 on the real stack: Today, AI usage and the helpers' status through OUR API: real JWT verification, real PostgREST, the real database
functions, the caller's own token. A business with a draft quote, a follow-up draft, a cancelled order that still holds money, an open order and some
order steps; a second business with its own things; every role; and the proof that one business's rows never appear in another's answers.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import httpx
import operator_sql
import pytest
from conftest import aal1_token, bearer
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient
from followup_support import FollowWorld
from order_support import OrderWorld
from quote_support import QuoteWorld

AGENT_ORDER = ["main", "lead_finder", "researcher", "requirement_analyst", "quote_writer", "followup_desk", "order_desk"]


class Scene:
    """Business A: one draft quote, one follow-up draft, one cancelled order holding 40,000 paise, one open order. Business B: one follow-up draft."""

    def __init__(self, w: World, client: TestClient) -> None:
        qw = QuoteWorld(w, w.a, n_products=4)
        qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
        qw.policy_version()
        self.ow = OrderWorld(qw)
        self.ow.policy()
        self.w, self.a, self.b = w, w.a, w.b

        # a draft quote (made, not approved)
        _, requirement = qw.requirement([("kanjivaram", 12)])
        assert qw.pick(requirement, 1, 0, 12).status_code == 200
        made = qw.create(requirement)
        assert made.status_code == 200, made.text
        self.draft_quote = str(made.json()["quote_id"])

        # an order that took an advance of 50,000 paise, gave 10,000 back, and was cancelled by the Owner: 40,000 paise still held
        self.held_order, _ = self.ow.order()
        steps: list[tuple[str, str, int | None]] = [
            ("sales", "send_quote", None),
            ("sales", "customer_accept", None),
            ("sales", "request_advance", None),
            ("admin", "record_payment", 50_000),
            ("owner", "record_refund", 10_000),
            ("owner", "cancel", None),
        ]
        for user, kind, amount in steps:
            run = self.ow.run_event(self.held_order, user, kind, amount=amount, ledger=uid() if amount else None)
            assert run.response.status_code == 200, (kind, run.response.text)
        assert self.ow.state(self.held_order) == "cancelled"

        # an open order
        self.open_order, _ = self.ow.order()

        # a follow-up draft in each business
        self.fa, self.fb = FollowWorld(client, w, w.a), FollowWorld(client, w, w.b)
        for fw in (self.fa, self.fb):
            fw.policy()
        self.draft_a = self.fa.made_draft(self.fa.due_lead("today-a"))
        self.draft_b = self.fb.made_draft(self.fb.due_lead("today-b"))


@pytest.fixture(scope="module")
def scene(eval_world: World, client: TestClient) -> Scene:
    return Scene(eval_world, client)


def get(client: TestClient, scene: Scene, tenant: Any, path: str, user: str, *, weak: bool = False) -> httpx.Response:
    person = tenant.users[user]
    token = aal1_token(scene.w.stack, person) if weak else person.token
    r: httpx.Response = client.get(f"/v1/tenants/{tenant.id}/{path}", headers={"Authorization": f"Bearer {token}"})
    return r


def kinds(body: dict[str, Any]) -> list[str]:
    return sorted(i["kind"] for i in body["needs_you"])


def test_the_owner_sees_everything_that_waits_for_them(client: TestClient, scene: Scene) -> None:
    r = get(client, scene, scene.a, "today", "owner")
    assert r.status_code == 200, r.text
    body = r.json()
    assert kinds(body) == ["followup_due", "order_money_held", "quote_approval"]
    assert body["cards"] == {"waiting": 3, "money_held_paise": 40_000, "orders_open": 1}
    by_kind = {i["kind"]: i for i in body["needs_you"]}
    assert by_kind["quote_approval"]["id"] == scene.draft_quote and by_kind["quote_approval"]["agent"] == "quote_writer"
    assert by_kind["followup_due"]["id"] == scene.draft_a and by_kind["followup_due"]["agent"] == "followup_desk" and by_kind["followup_due"]["amount_paise"] is None
    held = by_kind["order_money_held"]
    assert (held["id"], held["agent"], held["amount_paise"]) == (scene.held_order, "order_desk", 40_000)
    assert "₹400.00" in held["summary"] and "refund may be owed" in held["summary"]
    # where "Open" goes: the quote, the lead (its follow-ups) and the order
    assert by_kind["quote_approval"]["target"] == {"type": "quote", "id": scene.draft_quote}
    assert by_kind["order_money_held"]["target"] == {"type": "order", "id": scene.held_order}
    lead_of_draft = operator_sql.sql(f"select lead_id from public.followup_drafts where id = '{scene.draft_a}'").strip()
    assert by_kind["followup_due"]["target"] == {"type": "lead", "id": lead_of_draft}
    assert all(i["customer"] and i["summary"] and i["at"] for i in body["needs_you"])


def test_the_recent_steps_are_the_orders_real_steps_newest_first_at_most_five(client: TestClient, scene: Scene) -> None:
    body = get(client, scene, scene.a, "today", "owner").json()
    assert 1 <= len(body["recent"]) <= 5
    assert body["recent"][0]["kind"] == "order_step" and body["recent"][0]["order_ref"].startswith("Order ")
    # the open order was started last, so its "started" step is the newest; the cancelled order's cancel step follows it
    assert [s["text"] for s in body["recent"]][:2] == ["Order started", "Order cancelled"]
    assert {s["target"]["type"] for s in body["recent"]} == {"order"}
    assert {s["target"]["id"] for s in body["recent"]} <= {scene.held_order, scene.open_order}
    times = [s["at"] for s in body["recent"]]
    assert times == sorted(times, reverse=True)


def test_each_role_sees_only_what_it_may_act_on(client: TestClient, scene: Scene) -> None:
    admin = get(client, scene, scene.a, "today", "admin").json()
    assert kinds(admin) == ["followup_due", "quote_approval"] and admin["cards"]["waiting"] == 2
    assert admin["cards"]["money_held_paise"] == 40_000, "an Admin still reads the card"
    sales = get(client, scene, scene.a, "today", "sales").json()
    assert sales["needs_you"] == [] and sales["cards"] == {"waiting": 0, "money_held_paise": 40_000, "orders_open": 1}
    assert len(sales["recent"]) >= 1
    viewer = get(client, scene, scene.a, "today", "viewer").json()
    assert viewer == {"cards": {"waiting": 0, "money_held_paise": 0, "orders_open": 0}, "needs_you": [], "recent": []}


def test_another_businesss_rows_never_appear_in_either_direction(client: TestClient, scene: Scene) -> None:
    a = get(client, scene, scene.a, "today", "owner").json()
    b = get(client, scene, scene.b, "today", "owner")
    assert b.status_code == 200, b.text
    b = b.json()
    assert kinds(b) == ["followup_due"] and b["cards"] == {"waiting": 1, "money_held_paise": 0, "orders_open": 0} and b["recent"] == []
    assert b["needs_you"][0]["id"] == scene.draft_b
    a_ids = {i["id"] for i in a["needs_you"]}
    assert scene.draft_b not in a_ids and scene.draft_a not in {i["id"] for i in b["needs_you"]}
    assert scene.draft_quote not in str(b) and scene.held_order not in str(b)


def test_a_person_who_is_not_a_member_gets_the_same_404_for_every_read(client: TestClient, scene: Scene) -> None:
    stranger = scene.b.users["owner"]
    for path in ("today", "ai-usage/today", "agents/status"):
        r = client.get(f"/v1/tenants/{scene.a.id}/{path}", headers=bearer(stranger))
        assert r.status_code == 404, path
    assert client.get(f"/v1/tenants/{scene.a.id}/today").status_code == 401


def test_the_database_itself_refuses_a_direct_call_for_someone_elses_business(scene: Scene) -> None:
    for fn in ("today_summary", "agents_status"):
        r = httpx.post(f"{scene.w.stack.rest}/rpc/{fn}", headers=scene.w.stack.headers(scene.b.users["owner"].token), json={"p_tenant_id": scene.a.id}, timeout=15)
        assert r.status_code in (400, 401, 403), (fn, r.text)
        assert scene.draft_quote not in r.text and scene.held_order not in r.text
        anon = httpx.post(f"{scene.w.stack.rest}/rpc/{fn}", headers={"apikey": scene.w.stack.anon_key}, json={"p_tenant_id": scene.a.id}, timeout=15)
        assert anon.status_code in (401, 403)


def test_the_read_works_without_a_second_factor(client: TestClient, scene: Scene) -> None:
    assert get(client, scene, scene.a, "today", "owner", weak=True).status_code == 200
    assert get(client, scene, scene.a, "agents/status", "admin", weak=True).status_code == 200


def test_the_helpers_are_always_all_seven_and_start_switched_off(client: TestClient, scene: Scene) -> None:
    r = get(client, scene, scene.a, "agents/status", "viewer")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["agent"] for a in body] == AGENT_ORDER
    by = {a["agent"]: a for a in body}
    assert by["lead_finder"]["state"] == "not_available", "it does not exist yet"
    assert by["main"]["state"] == by["researcher"]["state"] == "switched_off", "it exists, and its switch is off until the workspace turns it on"
    assert by["requirement_analyst"]["state"] == "switched_off"
    assert all(a["job"] for a in body)


def test_the_desks_report_their_real_latest_events(client: TestClient, scene: Scene) -> None:
    by = {a["agent"]: a for a in get(client, scene, scene.a, "agents/status", "owner").json()}
    assert by["quote_writer"]["last_event"]["text"].startswith("Prepared quote ")
    assert by["followup_desk"]["last_event"]["text"] == "Drafted follow-up message number 2"
    assert by["order_desk"]["last_event"]["text"] == "Order started"
    b = {a["agent"]: a for a in get(client, scene, scene.b, "agents/status", "owner").json()}
    assert b["quote_writer"]["last_event"] is None and b["order_desk"]["last_event"] is None, "B has no quotes or orders: nothing of A's shows"
    assert b["followup_desk"]["last_event"]["text"] == "Drafted follow-up message number 2"


def test_a_running_research_run_shows_as_working_once_agents_are_on(client: TestClient, scene: Scene) -> None:
    slug = operator_sql.sql(f"select slug from public.tenants where id = '{scene.a.id}'").strip()
    operator_sql.sql(f"select app.operator_enable_research('{slug}'); select app.operator_enable_requirement('{slug}')")
    lead = scene.a.rows["leads"]["id"]
    owner = scene.a.users["owner"].id
    operator_sql.sql(
        f"insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, lead_id, status, expires_at, input_sha256) "
        f"values ('{uid()}', '{scene.a.id}', '{owner}', 'research', '1', '{lead}', 'running', now() + interval '10 minutes', repeat('a', 64))"
    )
    by = {a["agent"]: a for a in get(client, scene, scene.a, "agents/status", "owner").json()}
    assert by["researcher"]["state"] == "working"
    assert by["requirement_analyst"]["state"] == "idle"
    other = {a["agent"]: a for a in get(client, scene, scene.b, "agents/status", "owner").json()}
    assert other["researcher"]["state"] == "switched_off", "B's switch is still off and A's run is not B's"


@pytest.mark.parametrize(("user", "status"), [("owner", 200), ("admin", 200), ("sales", 403), ("viewer", 403)])
def test_ai_usage_is_for_owner_and_admin(client: TestClient, scene: Scene, user: str, status: int) -> None:
    assert get(client, scene, scene.a, "ai-usage/today", user).status_code == status


def test_ai_usage_is_in_paise_and_adds_up(client: TestClient, scene: Scene) -> None:
    body = get(client, scene, scene.a, "ai-usage/today", "owner").json()
    assert set(body) == {"spent_paise", "cap_paise", "left_paise"}
    assert all(isinstance(v, int) and v >= 0 for v in body.values())
    assert body["cap_paise"] > 0 and body["spent_paise"] + body["left_paise"] >= body["cap_paise"] - 1
    # spend something: a settled reservation of 150,000 micros (15 paise) for today, written the way the runtime would
    before = body["spent_paise"]
    run = operator_sql.sql(f"select id from public.agent_runs where tenant_id = '{scene.a.id}' limit 1").strip()
    operator_sql.sql(
        "insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, settled_at, outcome) "
        f"values ('{uid()}', '{scene.a.id}', '{run}', 'usage-1', app.agent_utc_today(), 1000, 1000, 150000, 150000, repeat('c', 64), now(), 'used')"
    )
    after = get(client, scene, scene.a, "ai-usage/today", "owner").json()
    assert after["spent_paise"] == before + 15 and after["left_paise"] == max(after["cap_paise"] - after["spent_paise"], 0)
    # a call authorised one minute before Indian midnight belongs to yesterday in India: today's figure does not move
    operator_sql.sql(
        "insert into public.agent_cost_reservations (id, tenant_id, run_id, step_key, cost_day, max_input_tokens, max_output_tokens, reserved_micros, settled_micros, args_sha256, created_at, settled_at, outcome) "
        f"values ('{uid()}', '{scene.a.id}', '{run}', 'usage-2', app.agent_utc_today(), 1000, 1000, 5000000, 5000000, repeat('c', 64), (app.quote_today()::timestamp at time zone 'Asia/Kolkata') - interval '1 minute', now(), 'used')"
    )
    assert get(client, scene, scene.a, "ai-usage/today", "owner").json()["spent_paise"] == after["spent_paise"], "yesterday in India is not today"
    other = get(client, scene, scene.b, "ai-usage/today", "owner").json()
    assert other["spent_paise"] == 0, "B did not spend what A spent"


def test_the_quotes_list_names_the_customer_and_the_city(client: TestClient, scene: Scene) -> None:
    company = scene.a.rows["companies"]
    rows = client.get(f"/v1/tenants/{scene.a.id}/quotes", headers=bearer(scene.a.users["sales"]))
    assert rows.status_code == 200, rows.text
    body = rows.json()
    assert any(r["id"] == scene.draft_quote for r in body)
    for row in body:
        assert row["customer"] == company["name"] and row["city"] == company.get("city")
    by_enquiry = client.get(f"/v1/tenants/{scene.a.id}/enquiries/{body[0]['enquiry_id']}/quotes", headers=bearer(scene.a.users["owner"])).json()
    assert by_enquiry and all(r["customer"] == company["name"] for r in by_enquiry)
    # business B has no quotes, and A's customer never shows there
    other = client.get(f"/v1/tenants/{scene.b.id}/quotes", headers=bearer(scene.b.users["sales"]))
    assert other.status_code == 200 and other.json() == []
