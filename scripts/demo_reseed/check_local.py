#!/usr/bin/env python3
# ruff: noqa: E501, S603, S607
"""Check of the demo reseed (scripts/demo_reseed/neelambari_silks.sql) on a LOCAL database. It never commits.

What it does, in ONE transaction that ends in ROLLBACK:
  1. applies every migration of this checkout that is newer than the local database's last one (and the chats migration 20261231570000 from its branch when this checkout lacks it);
  2. makes a throwaway workspace named exactly 'Neelambari Silks (demo)' with an owner, the quote and order reference data, an old trial catalogue, and leftovers (a "Smoke test" lead, "DF click-through"
     and "Test Buyer One" rows, a quote of Rs 19,44,600, waiting messages, requests, visits and calls);
  3. runs the reseed twice and asserts: idempotent, leftovers gone, calls, chats, needs-you, quotes, leads, visits, reports, catalogue, text scan, safety;
  4. prints the figures the app screens read (by the same database functions, as the owner), and rolls back.

Run: python3 scripts/demo_reseed/check_local.py [--container supabase_db_sme-ai-agent] [--keep-sql out.sql]
The container must be a LOCAL database (the script refuses anything whose name does not start with 'supabase_db_'). Exit 0 = every check passed."""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
RESEED = pathlib.Path(__file__).resolve().parent / "neelambari_silks.sql"
LAST_APPLIED = "20261231510000"  # the local agent database's last migration
CHATS_MIGRATION = (
    "20261231570000_chats_handled_by.sql",
    "8a75c284",
)  # on branch c1/calls-outcome, not in every checkout

FIXTURE = r"""
-- ===== throwaway workspace, owner, reference data, an old trial catalogue and leftovers =====
select set_config('search_path', 'public, extensions', true);
create schema if not exists tests;
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@local.invalid', now(), '{"display_name":"Owner"}', now(), now());
insert into public.tenants (id, name, slug, demo) values ('22222222-2222-2222-2222-222222222222', 'Neelambari Silks (demo)', 'neelambari-check', true);
insert into public.memberships (tenant_id, user_id, role) values ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'owner');
-- a second workspace that must stay untouched
insert into public.tenants (id, name, slug) values ('33333333-3333-3333-3333-333333333333', 'Another Shop', 'another-shop');
select app.operator_seed_quote_reference_data('neelambari-check');
select app.operator_seed_order_policy('neelambari-check');
select app.operator_seed_quote_reference_data('another-shop');

-- the old trial catalogue: three active sarees with a photo each (the photo rows only; there is no file behind them in this check)
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, zari, price_band, stock_status, active, created_by, item_kind)
select ('44444444-0000-0000-0000-00000000000' || n)::uuid, '22222222-2222-2222-2222-222222222222', 'DEMO Old saree ' || n, 'soft_silk', array['red'], 'none', '5k_10k', 'in_stock', false, '11111111-1111-1111-1111-111111111111', 'saree'
  from generate_series(1, 3) n;
insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by)
select ('55555555-0000-0000-0000-00000000000' || n)::uuid, '22222222-2222-2222-2222-222222222222', ('44444444-0000-0000-0000-00000000000' || n)::uuid, 1, 'cat-22222222-2222-2222-2222-222222222222',
       ('44444444-0000-0000-0000-00000000000' || n) || '/' || ('55555555-0000-0000-0000-00000000000' || n) || '.jpg', ('44444444-0000-0000-0000-00000000000' || n) || '/' || ('55555555-0000-0000-0000-00000000000' || n) || '_t.jpg',
       640, 800, 1000, 100, '11111111-1111-1111-1111-111111111111'
  from generate_series(1, 3) n;
update public.catalogue_items set active = true where tenant_id = '22222222-2222-2222-2222-222222222222';
insert into public.item_types (tenant_id, code, name, active) values ('22222222-2222-2222-2222-222222222222', 'OLD1', 'Old trial saree', true);

-- leftovers: two junk people with enquiries, a draft quote of Rs 19,44,600, a junk call, a waiting message, a call request, a prospect, a visit
insert into public.companies (id, tenant_id, name) values ('66666666-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Smoke test'), ('66666666-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Test Buyer One');
insert into public.contacts (id, tenant_id, company_id, full_name, phone, whatsapp_consent) values
  ('77777777-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '66666666-0000-0000-0000-000000000001', 'Smoke test', '+00 000 000 0001', 'granted'),
  ('77777777-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '66666666-0000-0000-0000-000000000002', 'Test Buyer One', '+00 000 000 0002', 'granted');
insert into public.leads (id, tenant_id, company_id, contact_id, source) values
  ('88888888-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '66666666-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001', 'DF click-through'),
  ('88888888-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '66666666-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', 'webhook');
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values
  ('99999999-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000001', 'whatsapp', now() - interval '2 days', 'Smoke test message from the DF click-through'),
  ('99999999-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000002', 'form', now() - interval '3 days', 'I am Test Buyer One, synthetic enquiry');
insert into public.requirements (id, tenant_id, enquiry_id, status, confirmed_by, confirmed_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '99999999-0000-0000-0000-000000000002', 'confirmed', '11111111-1111-1111-1111-111111111111', now());
insert into public.quotes (id, tenant_id, quote_no, pricing_kind, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash,
                           customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
select 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 1, 'list', 'aaaaaaaa-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000002', '88888888-0000-0000-0000-000000000002', 'draft',
       (select id from public.price_list_versions where tenant_id = '22222222-2222-2222-2222-222222222222'), (select id from public.quote_policy_versions where tenant_id = '22222222-2222-2222-2222-222222222222'),
       '1.1.0', '{}', '{}', repeat('a', 64), 'new', 'TG', 'intra_state', current_date, current_date + 15, current_date + 30, 185200000, 9260000, 0, 0, 194460000, 97230000, 97230000, false;
insert into public.phone_calls (id, tenant_id, direction, state, contact_id, lead_id, purpose, language, provider, sandbox, created_by, answered_at, ended_at, duration_s, end_reason, outcome, summary, cost_paise, created_at)
values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'inbound', 'completed', '77777777-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'inbound', 'en', 'sandbox', true,
        '11111111-1111-1111-1111-111111111111', now() - interval '2 days', now() - interval '2 days' + interval '1 minute', 60, 'goodbye', 'positive', 'Smoke test call from the DF click-through', 500, now() - interval '2 days');
insert into public.phone_calls (id, tenant_id, direction, state, contact_id, lead_id, purpose, language, provider, sandbox, created_by, answered_at, ended_at, duration_s, end_reason, outcome, summary, cost_paise, created_at)
values ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'inbound', 'completed', '77777777-0000-0000-0000-000000000002', '88888888-0000-0000-0000-000000000002', 'inbound', 'en', 'sandbox', true,
        '11111111-1111-1111-1111-111111111111', now() - interval '1 day', now() - interval '1 day' + interval '1 minute', 60, 'handover', 'positive', 'Asked for a person', 500, now() - interval '1 day');
insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, source, status, reason, request_sha256, created_by)
values ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', 'whatsapp', 'Smoke test reply, the price is 500 rupees', 'en', 'reply_to_inbound', 'assistant', 'needs_approval', 'money', repeat('b', 64), '11111111-1111-1111-1111-111111111111'),
       ('dddddddd-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', 'whatsapp', 'Smoke test follow-up', 'en', 'followup', 'assistant', 'queued', 'auto_allowed', repeat('c', 64), '11111111-1111-1111-1111-111111111111');
insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, status, request_sha256, requested_by)
values ('eeeeeeee-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', 'DF click-through call', 'Say hello to the tester', 'en', 'requested', repeat('d', 64), '11111111-1111-1111-1111-111111111111');
insert into public.prospects (id, tenant_id, name, name_key, source, source_label, place_id, status)
values ('ffffffff-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Test shop', 'test shop', 'fixture', 'synthetic search', 'fixture-0001', 'needs_owner');
-- like the real staging workspace: dozens of prospects waiting for the owner (named ones and Google ones that carry no name)
insert into public.prospects (tenant_id, name, name_key, source, source_label, place_id, status)
select '22222222-2222-2222-2222-222222222222', 'Saree shop ' || n, 'saree shop ' || n, 'fixture', 'Saree shops nearby', 'fixture-' || (100 + n), 'needs_owner' from generate_series(1, 38) n;
insert into public.prospects (tenant_id, source, source_label, place_id, status)
select '22222222-2222-2222-2222-222222222222', 'google_maps', 'Saree shops nearby', 'ChIJfixture' || n, 'needs_owner' from generate_series(1, 10) n;
insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, purpose, status, source, request_sha256, created_by)
select '12121212-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '88888888-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000002', '66666666-0000-0000-0000-000000000002',
       ((now() + interval '2 days') at time zone 'Asia/Kolkata')::date, now() + interval '2 days', now() + interval '2 days 30 minutes', 'Smoke test visit', 'booked', 'assistant', repeat('e', 64), '11111111-1111-1111-1111-111111111111';
insert into public.tasks (id, tenant_id, instruction, language, status, created_by) values ('13131313-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Call the smoke test list', 'en', 'planned', '11111111-1111-1111-1111-111111111111');
"""


def migrations(container: str) -> str:
    del container
    out = []
    names = {
        p.name: p.read_text()
        for p in sorted((ROOT / "supabase/migrations").glob("*.sql"))
        if p.name.split("_")[0] > LAST_APPLIED
    }
    if CHATS_MIGRATION[0] not in names:
        got = subprocess.run(
            [
                "git",
                "-C",
                str(ROOT),
                "show",
                f"{CHATS_MIGRATION[1]}:supabase/migrations/{CHATS_MIGRATION[0]}",
            ],
            capture_output=True,
            text=True,
        )
        if got.returncode != 0:
            sys.exit(
                f"cannot read the chats migration {CHATS_MIGRATION[0]} from commit {CHATS_MIGRATION[1]}: {got.stderr.strip()}"
            )
        names[CHATS_MIGRATION[0]] = got.stdout
    for name in sorted(names):
        out.append(f"-- migration {name}\n{names[name]}")
    return "\n".join(out)


def reseed_body() -> str:
    """The reseed without its own transaction lines (the check wraps everything in one transaction it rolls back)."""
    lines = RESEED.read_text().splitlines()
    keep = []
    seen_begin = seen_commit = False
    for line in lines:
        if line.strip() == "begin;" and not seen_begin:
            seen_begin = True
            continue
        if line.strip() == "commit;":
            seen_commit = True
            continue
        if line.startswith("\\"):
            continue
        keep.append(line)
    if not (seen_begin and seen_commit):
        sys.exit("the reseed must start with 'begin;' and end with 'commit;' on lines of their own")
    return "\n".join(keep)


def build(container: str) -> str:
    body = reseed_body()
    asserts = (pathlib.Path(__file__).resolve().parent / "check_asserts.sql").read_text()
    # the reseed creates temp tables and functions that live until the end of the session; a second run needs them gone, so each run is its own savepoint-free block: the temp tables are
    # "on commit drop", so the check drops them by hand between the two runs
    drop = (
        "do $x$ declare f record; begin "
        "for f in select c.oid::regclass as rel from pg_class c where c.relnamespace = pg_my_temp_schema() and c.relkind = 'r' loop execute 'drop table ' || f.rel || ' cascade'; end loop; "
        "for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = pg_my_temp_schema() loop execute 'drop function ' || f.sig; end loop; end $x$;\n"
    )
    return "\n".join(
        [
            "begin;",
            "set client_min_messages = notice;",
            migrations(container),
            FIXTURE,
            "select 'FIXTURE_DONE';",
            asserts.split("-- @@BEFORE", 1)[1].split("-- @@RUN1", 1)[0]
            if "-- @@BEFORE" in asserts
            else "",
            body,
            "select 'RUN1_DONE';",
            asserts.split("-- @@RUN1", 1)[1].split("-- @@RUN2", 1)[0],
            drop,
            body,
            "select 'RUN2_DONE';",
            asserts.split("-- @@RUN2", 1)[1].split("-- @@CONSUME", 1)[0],
            asserts.split("-- @@CONSUME", 1)[1].split("-- @@RUN3", 1)[0],
            drop,
            body,
            "select 'RUN3_DONE';",
            asserts.split("-- @@RUN3", 1)[1],
            "rollback;",
        ]
    )


def engine_checks(out: str) -> list[str]:
    """Run the REAL quote engine (packages/quote-engine) on every stored quote request and compare: the request text is the engine's canonical text, the hash and every figure are the engine's."""
    sys.path.insert(0, str(ROOT / "packages/quote-engine/src"))
    import quote_engine  # noqa: PLC0415 - stdlib-only package of this checkout

    problems: list[str] = []
    n = 0
    for line in out.splitlines():
        line = line.removeprefix("NOTICE:  ")
        if not line.startswith("ENGINE_ROW|"):
            continue
        _, qid, request_text, result_text = line.split("|", 3)
        request, stored = json.loads(request_text), json.loads(result_text)
        want = quote_engine.quote(request)
        n += 1
        if quote_engine.canonical_json(request) != request_text:
            problems.append(f"{qid}: the request text is not the engine's canonical text")
        if want["canonical_hash"] != stored["canonical_hash"]:
            problems.append(f"{qid}: the hash differs from the engine's")
        for key in (
            "lines",
            "totals",
            "payment_terms",
            "valid_until",
            "flags",
            "status",
            "engine_version",
        ):
            if want[key] != stored[key]:
                problems.append(f"{qid}: {key} differs from the engine's")
    if n == 0:
        problems.append("no quote rows came back to compare")
    print(
        f"CHECK engine {'FAIL' if problems else 'ok'}: {n} quotes compared with the real quote engine (request text, hash, lines, totals, payment terms)"
    )
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--container", default="supabase_db_sme-ai-agent")
    ap.add_argument("--keep-sql", help="write the whole script it sends to this file")
    args = ap.parse_args()
    if not args.container.startswith("supabase_db_"):
        sys.exit("refusing: this is not a local supabase database container")
    sql = build(args.container)
    if args.keep_sql:
        pathlib.Path(args.keep_sql).write_text(sql)
    run = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            args.container,
            "psql",
            "-U",
            "postgres",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=sql,
        capture_output=True,
        text=True,
        timeout=900,
    )
    out = run.stdout + run.stderr
    shown = []
    for ln in out.splitlines():
        ln = ln.removeprefix("NOTICE:  ")
        if ln.startswith("ENGINE_ROW"):
            continue
        if ln.startswith(
            (
                "CHECK",
                "FAIL",
                "INFO",
                "ERROR",
                "WARNING",
                "psql:",
                "DETAIL",
                "CONTEXT",
                "LINE",
                "HINT",
                "needs you",
                "demo reseed",
                "catalogue",
                "chats",
                "quotes",
                "outbox",
                "item types",
            )
        ):
            shown.append(ln)
    print("\n".join(shown))
    ok = run.returncode == 0 and "ALL_CHECKS_PASSED" in out
    problems = engine_checks(out) if ok else []
    for p in problems:
        print("FAIL", p)
    ok = ok and not problems
    print("RESULT:", "PASS" if ok else "FAIL")
    if not ok and not shown:
        print(out[-3000:])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
