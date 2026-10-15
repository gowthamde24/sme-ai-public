"""Job CR (ADR 0087): the migrations REPLACE functions of earlier jobs. A Postgres function is replaced whole, so each replacement must be the LAST definition of its function (a later copy of an old text would
silently undo a later fix), and a COPY must differ from the text before it by exactly the lines named here.

  * app.module_guard_companies (job CK's guard: one more placeholder name, "Enquiry <6 characters>")
  * public.import_job_preview_save (job CK's copy: the kind `students` joins customers and stock)
  * app.operator_open_real_data_gate (job T006b's: a workspace that keeps student records opens only with the children's review reference)
  * app.ledger_record_core, app.ledger_statement_json, public.ledger_summary (job CP's ledger learns the student's own account)
  * app.campaign_step_run, app.campaign_calls_run, public.campaign_results, public.campaign_recipients_from_ledger (job CP's reminders learn "what a guardian's students owe together")
  * app.campaign_lead_for (job CP's helper, now the generic enquiry path of job CR)."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import MIGRATIONS, definitions, normalised

COPIES = {'app.campaign_calls_run': ('20261125090200_cr_fees.sql',
                            '20261124090200_cp_runner_calls_results.sql',
                            {'select r.id as recipient_id, r.campaign_id, r.lead_id, r.contact_id, r.due_date, r.amount_paise, r.reference, r.account_id, c.call_after_step, c.message_text, '
                             'c.language, c.approved_by, ct.full_name',
                             'v_out := app.ledger_outstanding(p_tenant, x.account_id, app.dues_today());'},
                            {'select r.id as recipient_id, r.campaign_id, r.lead_id, r.contact_id, r.due_date, r.amount_paise, r.reference, r.account_id, r.ledger_scope, c.call_after_step, '
                             'c.message_text, c.language, c.approved_by, ct.full_name',
                             'v_out := app.recipient_outstanding(p_tenant, x.account_id, x.contact_id, x.ledger_scope, app.dues_today());'}),
 'app.campaign_step_run': ('20261125090200_cr_fees.sql',
                           '20261124090200_cp_runner_calls_results.sql',
                           {'v_out := app.ledger_outstanding(s.tenant_id, r.account_id, app.dues_today());'},
                           {'v_out := app.recipient_outstanding(s.tenant_id, r.account_id, r.contact_id, r.ledger_scope, app.dues_today());'}),
 'app.ledger_record_core': ('20261125090200_cr_fees.sql',
                            '20261124090000_cp_ledger.sql',
                            {'and a.company_id is not distinct from p_company and a.contact_id is not distinct from p_contact;',
                             'insert into public.ledger_accounts (id, tenant_id, company_id, contact_id) values (gen_random_uuid(), p_tenant, p_company, p_contact) returning id into v_acc;',
                             "or num_nonnulls(p_company, p_contact) <> 1 or p_source not in ('manual', 'import') then",
                             'p_invoice_no text, p_reference text, p_method text, p_reason text, p_against uuid, p_order uuid, p_source text',
                             'v_acc := app.ledger_account_of(p_tenant, p_company, p_contact);'},
                            {'and a.company_id is not distinct from p_company and a.contact_id is not distinct from p_contact and a.student_id is not distinct from p_student;',
                             'end if;',
                             'if p_student is not null and not exists (select 1 from public.students s where s.id = p_student and s.tenant_id = p_tenant and s.erased_at is null) then',
                             'insert into public.ledger_accounts (id, tenant_id, company_id, contact_id, student_id) values (gen_random_uuid(), p_tenant, p_company, p_contact, p_student) returning '
                             'id into v_acc;',
                             "or num_nonnulls(p_company, p_contact, p_student) <> 1 or p_source not in ('manual', 'import') then",
                             'p_invoice_no text, p_reference text, p_method text, p_reason text, p_against uuid, p_order uuid, p_source text, p_student uuid default null',
                             "perform app.dues_error('reference');",
                             'v_acc := app.ledger_account_of(p_tenant, p_company, p_contact, p_student);'}),
 'app.ledger_statement_json': ('20261125090200_cr_fees.sql',
                               '20261124090000_cp_ledger.sql',
                               {"'account_id', p_account, 'company_id', a.company_id, 'contact_id', a.contact_id, 'as_of', p_as_of,"},
                               {"'account_id', p_account, 'company_id', a.company_id, 'contact_id', a.contact_id, 'student_id', a.student_id, 'as_of', p_as_of,"}),
 'app.module_guard_companies': ('20261125090000_cr_education_core.sql',
                                '20261122090300_ck_packs_activate.sql',
                                {"if new.created_via = 'agent' and new.name ~ '^WhatsApp customer [0-9a-f]{6}$' then"},
                                {"if new.created_via = 'agent' and new.name ~ '^(WhatsApp customer|Enquiry) [0-9a-f]{6}$' then"}),
 'app.operator_open_real_data_gate': ('20261125090300_cr_audience_import_reports.sql',
                                      '20261011090000_t006b_real_data_gate.sql',
                                      set(),
                                      {"-- job CR: a workspace that keeps children's records (module `programmes`) opens only after the DPDP CHILDREN's review: its review reference must say so "
                                       '(`dpdp-children:<ticket>`)',
                                       'end if;',
                                       "if app.module_enabled(v_tenant, 'programmes') and p_dpdp_review_ref !~ '^dpdp-children:' then",
                                       "raise exception 'a workspace with student records opens only after the children''s data review' using errcode = 'SM816';"}),
 'public.campaign_recipients_from_ledger': ('20261125090200_cr_fees.sql',
                                            '20261124090100_cp_campaigns.sql',
                                            {"and (v_party is null or (v_party = 'company' and acc.company_id is not null) or (v_party = 'contact' and acc.contact_id is not null))",
                                             'case when count(*) = 1 then max(coalesce(o.invoice_no, o.reference)) end as ref',
                                             'cross join lateral app.ledger_open_items(p_tenant_id, acc.id, v_today) o',
                                             'from public.ledger_accounts acc',
                                             'group by acc.id, acc.company_id, acc.contact_id',
                                             'having sum(o.open_paise) >= v_min',
                                             "if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 400 or v_min < 1 or (v_party is not null and v_party not in ('company', "
                                             "'contact'))",
                                             'insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, reference, account_id, row_hash, '
                                             'created_by)',
                                             'order by min(o.due_date), acc.id',
                                             'select acc.id as account_id, acc.company_id, acc.contact_id,',
                                             'sum(o.open_paise)::bigint as open_paise, min(o.due_date) as due_date,',
                                             "values (p_tenant_id, p_campaign_id, v_contact, v_lead, a.due_date, a.open_paise, case when a.ref ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$' then a.ref end, "
                                             'a.account_id,',
                                             'where acc.tenant_id = p_tenant_id and o.open_paise > 0 and o.due_date between v_from and v_to'},
                                            {"-- one person per account, EXCEPT that the accounts of a guardian's students are one person: the guardian (one message, the total of the claims in the "
                                             'range, the earliest date)',
                                             'and (acc.student_id is null or st.id is not null)',
                                             "and (v_party is null or (v_party = 'company' and acc.company_id is not null) or (v_party = 'contact' and acc.contact_id is not null) or (v_party = "
                                             "'student' and acc.student_id is not null))",
                                             "case when acc.student_id is not null then 'g:' || st.contact_id::text else 'a:' || acc.id::text end as party_key,",
                                             'case when sum(g.claims) = 1 then max(g.ref) end as ref',
                                             'cross join lateral app.ledger_open_items(p_tenant_id, acc.id, v_today) o',
                                             'from (select acc.id as account_id, acc.company_id, coalesce(acc.contact_id, st.contact_id) as contact_id, acc.student_id is not null as is_student,',
                                             'from public.ledger_accounts acc',
                                             'group by acc.id, acc.company_id, acc.contact_id, st.contact_id, acc.student_id) g',
                                             'group by g.party_key, g.company_id, g.contact_id, g.is_student',
                                             'having sum(g.open_paise) >= v_min',
                                             "if v_from is null or v_to is null or v_to < v_from or v_to - v_from > 400 or v_min < 1 or (v_party is not null and v_party not in ('company', 'contact', "
                                             "'student'))",
                                             'insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, amount_paise, reference, account_id, ledger_scope, '
                                             'row_hash, created_by)',
                                             'left join public.students st on st.tenant_id = acc.tenant_id and st.id = acc.student_id and st.erased_at is null',
                                             'order by min(g.due_date), (array_agg(g.account_id order by g.account_id))[1]',
                                             'select (array_agg(g.account_id order by g.account_id))[1] as account_id, g.company_id, g.contact_id, g.is_student,',
                                             'sum(g.open_paise)::bigint as open_paise, min(g.due_date) as due_date,',
                                             'sum(o.open_paise)::bigint as open_paise, min(o.due_date) as due_date, count(*) as claims, max(coalesce(o.invoice_no, o.reference)) as ref',
                                             "values (p_tenant_id, p_campaign_id, v_contact, v_lead, a.due_date, a.open_paise, case when a.ref ~ '^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$' then a.ref end, "
                                             "a.account_id, case when a.is_student then 'guardian' else 'account' end,",
                                             'where acc.tenant_id = p_tenant_id and o.open_paise > 0 and o.due_date between v_from and v_to'}),
 'public.campaign_results': ('20261125090200_cr_fees.sql',
                             '20261124090200_cp_runner_calls_results.sql',
                             {"and app.ledger_outstanding(p_tenant_id, f.account_id, (f.at at time zone 'Asia/Kolkata')::date) > 0)) as paid",
                              'first_sent as (select r.id, r.lead_id, r.account_id, r.amount_paise, r.closed_reason, min(st.sent_at) as at',
                              "settled as (select f.*, (f.closed_reason = 'paid' or (f.account_id is not null and app.ledger_outstanding(p_tenant_id, f.account_id, app.dues_today()) = 0"},
                             {"and app.recipient_outstanding(p_tenant_id, f.account_id, f.contact_id, f.ledger_scope, (f.at at time zone 'Asia/Kolkata')::date) > 0)) as paid",
                              'first_sent as (select r.id, r.lead_id, r.account_id, r.contact_id, r.ledger_scope, r.amount_paise, r.closed_reason, min(st.sent_at) as at',
                              "settled as (select f.*, (f.closed_reason = 'paid' or (f.account_id is not null and app.recipient_outstanding(p_tenant_id, f.account_id, f.contact_id, f.ledger_scope, "
                              'app.dues_today()) = 0'}),
 'public.import_job_preview_save': ('20261125090300_cr_audience_import_reports.sql',
                                    '20261122090500_ck_import_5000.sql',
                                    {"if p_job_id is null or p_kind is null or p_kind not in ('customers', 'stock') or p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'"},
                                    {"if p_job_id is null or p_kind is null or p_kind not in ('customers', 'stock', 'students') or p_file_sha256 is null or p_file_sha256 !~ '^[0-9a-f]{64}$'"}),
 'public.ledger_summary': ('20261125090200_cr_fees.sql',
                           '20261124090000_cp_ledger.sql',
                           {'where a.tenant_id = p_tenant_id and o.out > 0'},
                           {'where a.tenant_id = p_tenant_id and a.student_id is null and o.out > 0'})}


@pytest.mark.parametrize("name", sorted(COPIES))
def test_the_cr_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    mig, compared, want_dropped, want_added = COPIES[name]
    defs = definitions(name)
    assert defs[-1][0] == mig, f"{name} is redefined after job CR's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    assert {line[1:].strip() for line in diff if line[0] == "-"} - {""} == {w.strip() for w in want_dropped} - {""}, f"{name}: dropped lines differ"
    assert {line[1:].strip() for line in diff if line[0] == "+"} - {""} == {w.strip() for w in want_added} - {""}, f"{name}: added lines differ"


def test_the_campaign_lead_helper_is_the_generic_enquiry_path() -> None:
    defs = definitions("app.campaign_lead_for")
    assert defs[-1][0] == "20261125090000_cr_education_core.sql", "app.campaign_lead_for is redefined after job CR's migration"
    body = defs[-1][1]
    assert "app.contact_lead(" in body and "insert into public.leads" not in body, "the helper must delegate to the one function that makes a lead for a contact"


def test_the_placeholder_company_is_the_only_exemption_of_the_companies_guard() -> None:
    body = definitions("app.module_guard_companies")[-1][1]
    assert "created_via = 'agent'" in body and "'^(WhatsApp customer|Enquiry) [0-9a-f]{6}$'" in body
    assert body.count("return new;") == 2, "the guard has exactly two ways out: the placeholder and the module being on"


def test_every_cr_migration_is_after_the_cp_migrations() -> None:
    cr = [m.name for m in MIGRATIONS if "_cr_" in m.name]
    cp = [m.name for m in MIGRATIONS if "_cp_" in m.name]
    assert len(cr) == 4 and cp and min(cr) > max(cp)
