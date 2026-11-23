"""Order conversion on the real stack: erasure (ADR 0014) still works on a workspace that has an ORDER, and the order tables hold no personal data.

An order links to its lead, its enquiry, its requirement and its quote by id, and carries no contact field. Erasing the person (contact scope) or the company (company scope)
anonymises their free text and identifiers in place; it must neither fail on the order's foreign keys nor change one figure, state or ledger row of the order, and it must have
nothing to erase IN the order tables: every text column is classified SAFE and no planted identifier is found in any of them. The order keeps running afterwards. The erasure code
was NOT changed for this. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import operator_sql
import pytest
from crm_support import World
from evidence_support import uid
from order_support import OrderWorld
from quote_support import QuoteWorld
from test_erasure_direct_postgrest import add_person, api, request, with_open_gate

TABLES = ["order_policy_versions", "orders", "order_events"]


@pytest.fixture(scope="module")
def w(client: Any, stack: Any, signup: Any) -> World:
    return with_open_gate(World(client, stack, signup))


def planted_hits(tenant: str, needles: list[str]) -> int:
    total = 0
    for table in TABLES:
        for needle in needles:
            total += int(
                operator_sql.sql(
                    f"select count(*) from public.{table} x where x.tenant_id = '{tenant}' and x::text ilike '%{needle}%'"
                ).strip()
            )
    return total


def snapshot(order: str) -> str:
    return operator_sql.sql(
        f"select (select row_to_json(o)::text from (select id, state, order_total_paise, advance_paise, valid_until, quote_id, lead_id, policy_version_id from public.orders where id = '{order}') o) || "
        f"(select coalesce(json_agg(e order by seq)::text, '') from (select seq, type, new_state, amount_paise, ledger_id, canonical_hash from public.order_events where order_id = '{order}') e)"
    )


def test_every_text_column_of_the_order_tables_is_classified_safe() -> None:
    unclassified = operator_sql.sql(
        "select coalesce(string_agg(c.table_name || '.' || c.column_name, ', '), '') from information_schema.columns c "
        f"where c.table_schema = 'public' and c.table_name in ({','.join(repr(t) for t in TABLES)}) "
        "and (c.data_type in ('text', 'character varying', 'jsonb') or (c.data_type = 'ARRAY' and c.udt_name = '_text')) "
        "and coalesce(col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position), '') !~ '^SAFE:'"
    ).strip()
    assert unclassified == "", (
        f"a free-text column of an order table is not classified SAFE: {unclassified}"
    )


def test_erasing_a_contact_and_then_a_company_leaves_an_order_untouched_and_running(
    w: World,
) -> None:
    a = w.a
    qw = QuoteWorld(w, a, n_products=2)
    qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
    qw.policy_version()
    ow = OrderWorld(qw)
    ow.policy()
    person = add_person(w, a)
    needles = ["qxjv", "canary.test", person["email"].split("@")[0]]
    _, requirement = qw.requirement([("kanjivaram", 12)], lead_id=person["lead"])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    quote = qw.create(requirement).json()["quote_id"]
    assert qw.approve(quote).status_code == 200
    order = ow.create_order(quote).json()["order_id"]
    for user, event in (("sales", "send_quote"), ("sales", "customer_accept")):
        assert ow.run_event(order, user, event).response.status_code == 200
    assert (
        ow.run_event(
            order, "admin", "record_payment", amount=1000, ledger=uid()
        ).response.status_code
        == 200
    )
    before = snapshot(order)
    assert planted_hits(a.id, needles) == 0, "the order tables carry no personal data (before)"

    owner = a.users["owner"]
    done = api(
        w,
        owner,
        "POST",
        a,
        f"/{request(w, owner, a, 'contact', person['contact'])}/execute",
        json={},
    )
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text
    assert snapshot(order) == before, "erasing the contact changed the order"
    company = a.rows["companies"]["id"]
    done = api(w, owner, "POST", a, f"/{request(w, owner, a, 'company', company)}/execute", json={})
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text
    assert snapshot(order) == before, "erasing the company changed the order"
    assert planted_hits(a.id, needles) == 0, "the order tables carry no personal data (after)"

    # the order keeps running on the erased workspace
    run = ow.run_event(order, "admin", "record_payment", amount=2000, ledger=uid())
    assert run.response.status_code == 200, run.response.text
    ow.invariants(order)
