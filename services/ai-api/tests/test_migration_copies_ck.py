"""Job CK: migrations 20261122090300 and 20261122090500 REPLACE three functions as FULL COPIES (a Postgres function is replaced whole). Each must be the LAST definition of its function and differ from the
one before it by EXACTLY the lines named here, so a later copy of an old definition can never silently bring back the three-word business type, the required business name, the 500-row import cap, or
drop the pack choice."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

import pytest

from tests.test_migration_copies import definitions, normalised

ACTIVATE = "20261122090300_ck_packs_activate.sql"
IMPORT = "20261122090500_ck_import_5000.sql"
AD = "20261031090100_ad_d2_open_signup.sql"
BI = "20261114090100_bi_import_jobs.sql"

CK_CHANGED: dict[str, tuple[str, str, set[str], set[str]]] = {
    "public.complete_setup": (
        ACTIVATE,
        AD,
        {
            "if p_business_type is null or p_business_type not in ('textiles', 'construction', 'other') then",
            "raise exception 'business type must be textiles, construction or other' using errcode = '22023';",
            "if v_user.email_confirmed_at is null then",
            "if not exists (select 1 from public.terms_acceptances where user_id = v_uid) then",
            "if char_length(v_name) not between 1 and 120 then",
            "raise exception 'the business name from sign-up is missing or too long' using errcode = '22023';",
            "values (v_uid, v_tenant.id, p_business_type, p_language);",
        },
        {
            "v_pack      packs.pack_versions;",
            "if p_business_type is null or p_business_type !~ '^[a-z][a-z0-9_]{1,30}$' then",
            "raise exception 'business type is not valid' using errcode = '22023';",
            "end if;",
            "select * into v_pack from packs.pack_versions p",
            "where p.code = p_business_type and p.status in ('preview', 'published') order by p.version desc limit 1;",
            "if not found then",
            "perform app.pack_error('unavailable');",
            "if not app.account_email_verified(v_uid) then",
            "if not exists (select 1 from public.terms_acceptances where user_id = v_uid)",
            "and not exists (select 1 from integrations.policy_acceptances a where a.user_id = v_uid and a.kind = 'terms') then",
            "if v_name = '' then",
            "v_name := 'My business';  -- sign-up asks only the business type; the activation checklist asks the name",
            "elsif char_length(v_name) > 120 then",
            "raise exception 'the business name from sign-up is too long' using errcode = '22023';",
            "values (v_uid, v_tenant.id, v_pack.code, p_language);",
            "-- the tenants insert gave the business the default pack; it now takes the one the person chose, and that pack's custom fields",
            "update packs.workspace_pack w",
            "set pack_code = v_pack.code, pack_version = v_pack.version, source = 'signup', chosen_by = v_uid, chosen_at = now()",
            "where w.tenant_id = v_tenant.id;",
            "perform app.apply_pack_fields(v_tenant.id, v_pack.code, v_pack.version, v_uid);",
            "perform app.write_audit_event(v_tenant.id, 'workspace_pack.choose', 'workspace_pack', v_tenant.id, null,",
            "jsonb_build_object('pack', v_pack.code, 'version', v_pack.version, 'source', 'signup'));",
        },
    ),
    "public.get_account_setup": (
        ACTIVATE,
        AD,
        {
            "if not exists (select 1 from public.terms_acceptances where user_id = v_uid) then",
            "return jsonb_build_object('state', 'none', 'tenant_id', null, 'business_name', null);",
            "select nullif(btrim(u.raw_user_meta_data ->> 'business_name'), '') into v_name from auth.users u where u.id = v_uid;",
            "return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', v_name);",
        },
        {
            "if exists (select 1 from public.terms_acceptances where user_id = v_uid) then",
            "select nullif(btrim(u.raw_user_meta_data ->> 'business_name'), '') into v_name from auth.users u where u.id = v_uid;",
            "return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', v_name);",
            "-- a Google or Facebook account has no sign-up form: it needs the setup until it has a business of its own or has joined one",
            "if exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email')",
            "and not exists (select 1 from public.memberships m where m.user_id = v_uid) then",
            "return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', null);",
            "end if;",
            "return jsonb_build_object('state', 'none', 'tenant_id', null, 'business_name', null);",
        },
    ),
    # public.import_job_preview_save: replaced again by job CR (the kind `students`); tests/test_migration_copies_cr.py pins that copy against this one
}


@pytest.mark.parametrize("name", sorted(CK_CHANGED))
def test_the_ck_copy_is_the_last_definition_and_differs_by_exactly_the_named_lines(name: str) -> None:
    last, compared, want_dropped, want_added = CK_CHANGED[name]
    defs = definitions(name)
    assert defs[-1][0] == last, f"{name} is redefined after job CK's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == compared, f"{name}: the definition before this copy is not in {compared}"
    diff = [
        line
        for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0)
        if line[:1] in "+-" and not line.startswith(("---", "+++"))
    ]
    # (blank lines carry no meaning: only the named lines may differ)
    assert {line[1:].strip() for line in diff if line[0] == "-"} - {""} == {w.strip() for w in want_dropped} - {""}, f"{name}: dropped lines differ"
    assert {line[1:].strip() for line in diff if line[0] == "+"} - {""} == {w.strip() for w in want_added} - {""}, f"{name}: added lines differ"


def test_the_setup_functions_keep_their_definers_properties() -> None:
    for name in ("public.complete_setup", "public.get_account_setup"):
        body = definitions(name)[-1][1].lower()
        assert "security definer" in body and "set search_path = ''" in body, name
    # the second factor is NOT asked at sign-up: the setup never calls it
    assert "require_aal2" not in definitions("public.complete_setup")[-1][1]
