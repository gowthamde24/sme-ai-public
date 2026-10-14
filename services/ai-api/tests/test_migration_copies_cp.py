"""Job CP (ADR 0086): the migrations REPLACE functions of earlier jobs. A Postgres function is replaced whole, so each replacement must be the LAST definition of its function (a later copy of an old text would
silently bring back the dues tables job CP dropped, or a template choice that ignores the campaign's own), and a COPY must differ from the text before it by exactly the lines named here.

  * app.wa_send_context (job BR's copy, with one branch added: a campaign message uses the template its campaign names)
  * app.dues_error (a copy, unchanged)
  * the functions the ledger REWROTE on its own tables (job CN's names and signatures stay): checked to be the last definition and to read the ledger, never the dropped tables."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import MIGRATIONS, definitions, normalised

LEDGER = "20261124090000_cp_ledger.sql"
CAMPAIGNS = "20261124090100_cp_campaigns.sql"
BR = "20261117090000_br_whatsapp.sql"
CN_DUES = "20261123090300_cn_dues.sql"

COPIES: dict[str, tuple[str, str, set[str], set[str]]] = {
    "app.wa_send_context": (
        CAMPAIGNS,
        BR,
        {
            "v_purpose := case m.category when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' when 'info' then 'info' else null end;",
            "if v_purpose is not null then",
            "select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'",
            "order by x.created_at, x.id limit 1;",
        },
        {
            "if m.category = 'campaign_reminder' then",
            "select w.* into t from public.campaign_steps s join public.campaigns c on c.tenant_id = s.tenant_id and c.id = s.campaign_id",
            "join integrations.wa_templates w on w.tenant_id = c.tenant_id and w.id = c.wa_template_id",
            "where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id and w.status = 'approved' and w.language = m.language;",
            "else",
            "v_purpose := case m.category when 'visit' then 'visit' when 'followup' then 'followup' when 'order_status' then 'order_status' when 'info' then 'info' else null end;",
            "if v_purpose is not null then",
            "select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = v_purpose and x.language = m.language and x.status = 'approved'",
            "order by x.created_at, x.id limit 1;",
            "end if;",
        },
    ),
    "app.dues_error": (LEDGER, CN_DUES, set(), set()),
}

REWRITTEN = (
    "app.dues_open_items",
    "app.dues_outstanding",
    "app.dues_statement_json",
    "public.invoice_record",
    "public.invoices_import",
    "public.invoice_void",
    "public.payment_record",
    "public.payment_void",
    "public.dues_statement",
    "public.dues_summary",
    "public.dues_ledger",
)


@pytest.mark.parametrize("name", sorted(COPIES))
def test_the_cp_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    mig, compared, want_dropped, want_added = COPIES[name]
    defs = definitions(name)
    assert defs[-1][0] == mig, f"{name} is redefined after job CP's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == {w.strip() for w in want_dropped}, f"{name}: dropped lines differ"
    assert {line[1:].strip() for line in diff if line[0] == "+"} == {w.strip() for w in want_added}, f"{name}: added lines differ"


@pytest.mark.parametrize("name", REWRITTEN)
def test_a_rewritten_ledger_function_is_the_last_definition_and_reads_the_ledger_never_the_dropped_tables(name: str) -> None:
    defs = definitions(name)
    assert defs[-1][0] == LEDGER, f"{name} is redefined after the ledger migration ({defs[-1][0]})"
    body = defs[-1][1]
    assert "customer_invoices" not in body and "customer_payments" not in body, f"{name} still reads a table job CP dropped"


def test_no_migration_after_the_ledger_touches_the_two_dropped_tables() -> None:
    after = [m for m in MIGRATIONS if m.name > LEDGER]
    assert after, "the campaign migrations come after the ledger"
    for path in after:
        text = path.read_text()
        assert "customer_invoices" not in text and "customer_payments" not in text, path.name


def test_the_credit_limit_table_and_its_function_survive_the_ledger() -> None:
    # job CN's customer_credit_limits is kept (a construction notion, keyed by company); the ledger statement reads it
    text = (MIGRATIONS[[m.name for m in MIGRATIONS].index(LEDGER)]).read_text()
    assert "customer_credit_limits" in text and "drop table public.customer_credit_limits" not in text
