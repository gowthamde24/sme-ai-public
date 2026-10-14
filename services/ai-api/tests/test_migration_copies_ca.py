"""Job CA (ADR 0081): migration 20261121090000 replaces `app.erase_company` (job BB's definition plus one line: the company-scope erasure nulls the GSTIN) and `public.export_accounting_data` (job BI's
plus the GSTINs) as FULL COPIES. Each must be the LAST definition of its function and differ from the one before it by EXACTLY the lines named here, so a later copy of an old definition can never silently
bring back a company's GSTIN after an erasure or drop it from the export."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

CA = "20261121090000_ca_gstin.sql"
BB = "20261111090000_bb_outbox_gloss_events_list.sql"
BI = "20261114090000_bi_accounting_export.sql"

CA_CHANGED: dict[str, tuple[str, set[str], set[str]]] = {
    "app.erase_company": (
        BB,
        set(),
        {"v_counts := app.erasure_add(v_counts, 'companies.gstin',   app.erase_column(r.tenant_id, 'company', 'companies', 'gstin',   format('t.id = %L', co.id)));"},
    ),
    "public.export_accounting_data": (
        BI,
        {
            "'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end) as j",
            "return jsonb_build_object('from', p_from, 'to', p_to, 'orders', v_orders, 'payments', v_pay);",
        },
        {
            "'gstin', case when co.erased_at is not null then null else co.gstin end,",
            "'party', case when co.erased_at is not null then 'Erased customer' else coalesce(co.name, 'Walk-in customer') end,",
            "'gstin', case when co.erased_at is not null then null else co.gstin end) as j",
            "return jsonb_build_object('from', p_from, 'to', p_to, 'shop_gstin', (select bp.gstin from public.business_profile bp where bp.tenant_id = p_tenant_id), 'orders', v_orders, 'payments', v_pay);",
        },
    ),
}


@pytest.mark.parametrize("name", sorted(CA_CHANGED))
def test_the_ca_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    compared, want_dropped, want_added = CA_CHANGED[name]
    defs = definitions(name)
    # job CN replaces app.erase_company once more (test_migration_copies_cn.py pins what it added)
    later = {"app.erase_company": "20261123090600_cn_erasure.sql"}
    assert defs[-1][0] in (CA, later.get(name)), f"{name} is redefined after job CA's migration ({defs[-1][0]}): re-copy it from the latest definition"
    mine = [d for d in defs if d[0] == CA]
    prior = [d for d in defs if d[0] < CA]
    assert prior[-1][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(prior[-1][1]), normalised(mine[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == {w.strip() for w in want_dropped}, f"{name}: dropped lines differ"
    assert {line[1:].strip() for line in diff if line[0] == "+"} == {w.strip() for w in want_added}, f"{name}: added lines differ"


def test_the_export_keeps_its_definers_properties() -> None:
    body = definitions("public.export_accounting_data")[-1][1]
    assert "security definer" in body.lower() and "set search_path = ''" in body and "app.require_aal2()" in body
