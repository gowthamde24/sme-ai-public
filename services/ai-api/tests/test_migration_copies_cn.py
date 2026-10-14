"""Job CN (ADR 0085): migrations 20261123090200 and 20261123090600 REPLACE five functions as FULL COPIES of their latest definition. Each must be the LAST definition of its function and differ from the one
before it by EXACTLY the lines named here, so a later copy of an old definition can never silently bring back a saree-only key list or a company erasure that forgets the customer's sites.

Functions the job REWROTE rather than copied (app.requirement_confirmable, app.catalogue_item_json, public.catalogue_search, app.order_stops_followups) are tested by behaviour in pgTAP 96 and 98."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

REQ = "20261123090200_cn_requirements.sql"
ERASE = "20261123090600_cn_erasure.sql"
KEYS_OLD = "array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms']"

CN_CHANGED: dict[str, tuple[str, str, set[str], set[str]]] = {
    "app.requirement_vocab": (
        REQ,
        "20261015090000_t008_enquiries_requirements.sql",
        set(),
        {
            "when 'application' then array['driveway', 'footpath', 'parking', 'industrial_yard', 'garden', 'road', 'other']",
            "when 'product_type' then array['paver_block', 'kerb_stone', 'brick', 'tile', 'cement', 'sand', 'aggregate', 'other']",
            "when 'laying' then array['yes', 'no']",
        },
    ),
    "app.requirement_value_ok": (
        REQ,
        "20261015090000_t008_enquiries_requirements.sql",
        {"and p_date is null and p_text is null and p_basis in ('piece', 'set')"},
        {
            "and p_date is null and p_text is null and p_basis in ('piece', 'set', 'box', 'bag', 'tonne', 'cft', 'truckload')",
            "when 'application' then p_line is null and p_code = any (app.requirement_vocab('application'))",
            "and p_int is null and p_date is null and p_text is null and p_basis is null",
            "when 'product_type' then p_line between 1 and 5 and p_code = any (app.requirement_vocab('product_type'))",
            "when 'thickness'  then p_line between 1 and 5 and p_code is null and p_int between 10 and 300",
            "and p_date is null and p_text is null and p_basis = 'mm'",
            "when 'area'       then p_line between 1 and 5 and p_code is null and p_int between 1 and 100000000",
            "and p_date is null and p_text is null and p_basis in ('sq_ft', 'sq_m')",
            "when 'length'     then p_line between 1 and 5 and p_code is null and p_int between 1 and 10000000",
            "and p_date is null and p_text is null and p_basis in ('ft', 'm')",
            "when 'width'      then p_line between 1 and 5 and p_code is null and p_int between 1 and 10000000",
            "when 'site_location' then p_line is null and p_code is null and p_int is null and p_date is null and p_basis is null",
            "and char_length(btrim(p_text)) between 1 and 120",
            "when 'laying'     then p_line is null and p_code = any (app.requirement_vocab('laying'))",
        },
    ),
    "public.add_requirement_field": (
        REQ,
        "20261022090000_small_fixes.sql",
        {f"if p_key is null or p_key <> all ({KEYS_OLD})"},
        {"if p_key is null or p_key <> all (app.requirement_keys(e.tenant_id))"},
    ),
    "public.agent_write_requirement_field": (
        REQ,
        "20261015090300_t008_concurrency_and_rerun.sql",
        {f"or p_key <> all ({KEYS_OLD})", "if p_key = 'delivery_city' and strpos(lower(v_quote), lower(app.requirement_ws(p_value_text))) = 0 then"},
        {"or p_key <> all (app.requirement_keys(r.tenant_id))", "if p_key in ('delivery_city', 'site_location') and strpos(lower(v_quote), lower(app.requirement_ws(p_value_text))) = 0 then"},
    ),
    "app.erase_company": (
        ERASE,
        "20261121090000_ca_gstin.sql",
        set(),
        {
            "v_sites text;",
            "v_pods text;",
            "-- job CN: the sites of this company (the address, the map pin, the access notes ...) and the names of the people who received goods on its orders' trips",
            "v_sites := format('t.company_id = %L', co.id);",
            "v_pods := format('t.trip_id in (select x.id from public.delivery_trips x join public.orders o on o.tenant_id = x.tenant_id and o.id = x.order_id where x.tenant_id = t.tenant_id and o.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %L))', co.id);",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.name',         app.erase_column(r.tenant_id, 'company', 'customer_sites', 'name',         v_sites));",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.address_line', app.erase_column(r.tenant_id, 'company', 'customer_sites', 'address_line', v_sites));",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.city',         app.erase_column(r.tenant_id, 'company', 'customer_sites', 'city',         v_sites));",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.map_lat',      app.erase_column(r.tenant_id, 'company', 'customer_sites', 'map_lat',      v_sites));",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.map_lng',      app.erase_column(r.tenant_id, 'company', 'customer_sites', 'map_lng',      v_sites));",
            "v_counts := app.erasure_add(v_counts, 'customer_sites.access_notes', app.erase_column(r.tenant_id, 'company', 'customer_sites', 'access_notes', v_sites));",
            "v_counts := app.erasure_add(v_counts, 'delivery_proofs.received_by', app.erase_column(r.tenant_id, 'company', 'delivery_proofs', 'received_by', v_pods));",
            "",
        },
    ),
}


@pytest.mark.parametrize("name", sorted(CN_CHANGED))
def test_the_cn_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    mig, compared, want_dropped, want_added = CN_CHANGED[name]
    defs = definitions(name)
    assert defs[-1][0] == mig, f"{name} is redefined after job CN's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == {w.strip() for w in want_dropped}, f"{name}: dropped lines differ"
    assert {line[1:].strip() for line in diff if line[0] == "+"} == {w.strip() for w in want_added}, f"{name}: added lines differ"


def test_the_copies_keep_their_definers_properties() -> None:
    for name in ("public.add_requirement_field", "public.agent_write_requirement_field"):
        body = definitions(name)[-1][1]
        assert "security definer" in body.lower() and "set search_path = ''" in body, name


def test_every_requirement_key_of_the_database_is_one_the_api_models_know() -> None:
    # the enum of the database, the allow-list of the function and the API's closed vocabulary must say the same eleven plus eight words (the agent's own vocabulary is checked in test_requirements_vocabulary)
    from app.requirements.vocabulary import FIELD_KEYS

    keys_materials = {"application", "product_type", "thickness", "area", "length", "width", "site_location", "laying", "quantity", "budget", "deadline", "delivery_city", "payment_terms"}
    assert set(FIELD_KEYS) <= keys_materials | {"saree_type", "fabric", "colour"}
