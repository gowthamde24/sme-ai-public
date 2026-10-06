"""T009 part 3 on the real stack: erasure (ADR 0014) still works on a workspace that has an APPROVED quote, and the quote tables hold no personal data.

A quote links to its lead, its requirement and its enquiry. Erasing the person (contact scope) or the company (company scope) anonymises their free-text and identifiers in
place; it must neither fail on the quote's foreign keys nor change one figure or the approval of the quote, and it must have nothing to erase IN the quote tables: every text
column of those tables is classified SAFE (a code, a business sku or product name, a canonical request) and no planted identifier is found in any of them. The erasure
code was NOT changed for this (the test passes against the T006b / T008 functions as they are). All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import operator_sql
import pytest
from crm_support import World
from quote_support import QuoteWorld
from test_erasure_direct_postgrest import add_person, api, request, with_open_gate

TABLES = [
    "price_lists",
    "price_list_versions",
    "price_list_items",
    "price_list_breaks",
    "quote_policy_versions",
    "mapper_config_versions",
    "requirement_line_picks",
    "quotes",
    "quote_lines",
]


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


def test_every_text_column_of_the_quote_tables_is_classified_safe() -> None:
    unclassified = operator_sql.sql(
        "select coalesce(string_agg(c.table_name || '.' || c.column_name, ', '), '') from information_schema.columns c "
        f"where c.table_schema = 'public' and c.table_name in ({','.join(repr(t) for t in TABLES)}) "
        "and (c.data_type in ('text', 'character varying', 'jsonb') or (c.data_type = 'ARRAY' and c.udt_name = '_text')) "  # an array of ENUM values is a closed list, not free text
        "and coalesce(col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position), '') !~ '^SAFE:'"
    ).strip()
    assert unclassified == "", (
        f"a free-text column of a quote table is not classified SAFE: {unclassified}"
    )


def test_erasing_a_contact_and_then_a_company_leaves_an_approved_quote_untouched(w: World) -> None:
    a = w.a
    qw = QuoteWorld(w, a, n_products=2)
    qw.price_version([qw.item(0, 400000, 4, 500), qw.item(1, 310000, 4, 500)])
    qw.policy_version()
    person = add_person(w, a)
    needles = ["qxjv", "canary.test", person["email"].split("@")[0]]
    _, requirement = qw.requirement([("kanjivaram", 12)], lead_id=person["lead"])
    assert qw.pick(requirement, 1, 0, 12).status_code == 200
    quote = qw.create(requirement).json()["quote_id"]
    assert qw.approve(quote).status_code == 200
    before = qw.quote_row(quote)
    assert before["status"] == "approved"
    assert planted_hits(a.id, needles) == 0, "the quote tables carry no personal data (before)"

    owner = a.users["owner"]
    contact_request = request(w, owner, a, "contact", person["contact"])
    done = api(w, owner, "POST", a, f"/{contact_request}/execute", json={})
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text
    assert qw.quote_row(quote) == before, "erasing the contact changed the quote"

    company = a.rows["companies"]["id"]
    company_request = request(w, owner, a, "company", company)
    done = api(w, owner, "POST", a, f"/{company_request}/execute", json={})
    assert done.status_code == 200 and done.json()["status"] == "executed", done.text
    assert qw.quote_row(quote) == before, "erasing the company changed the quote"
    assert planted_hits(a.id, needles) == 0, "the quote tables carry no personal data (after)"
    lines = operator_sql.sql(
        f"select count(*) from public.quote_lines where quote_id = '{quote}'"
    ).strip()
    assert lines == "1"

    # the quote machinery still works on the erased workspace: the approved quote can be withdrawn and its requirement discarded
    assert qw.withdraw(quote).status_code == 200
    assert (
        operator_sql.sql(f"select status from public.quotes where id = '{quote}'").strip()
        == "superseded"
    )
