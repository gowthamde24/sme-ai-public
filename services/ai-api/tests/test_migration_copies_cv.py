"""Job CV (ADR 0088): the voice migration REPLACES one function of job CP, `app.campaign_content_sha` (what an Owner's approval of a campaign is bound to). A Postgres function is replaced whole, so the replacement must be
the LAST definition of the function, and differ from CP's by exactly the lines named here: the end of the hash expression gains the voice signature, which is EMPTY while a campaign has no voice note, so every
approval made before this job stays valid."""

# ruff: noqa: E501

from __future__ import annotations

import difflib

from tests.test_migration_copies import definitions, normalised

DROPPED = {
    "|| '#' || coalesce((select string_agg(r.row_hash, ',' order by r.contact_id, r.due_date) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id), ''), 'UTF8')), 'hex')"
}
ADDED = {
    "|| '#' || coalesce((select string_agg(r.row_hash, ',' order by r.contact_id, r.due_date) from public.campaign_recipients r where r.tenant_id = c.tenant_id and r.campaign_id = c.id), '')",
    "|| case when app.campaign_voice_sig(c.tenant_id, c.id) = '' then '' else '#voice=' || app.campaign_voice_sig(c.tenant_id, c.id) end, 'UTF8')), 'hex')",
}


def test_the_cv_copy_of_the_content_hash_is_the_last_definition_and_only_appends_the_voice_signature() -> None:
    defs = definitions("app.campaign_content_sha")
    assert defs[-1][0] == "20261126090000_cv_voice_notes.sql", f"redefined after job CV's migration ({defs[-1][0]}): re-copy it from the latest definition"
    assert defs[-2][0] == "20261124090100_cp_campaigns.sql"
    diff = [line for line in difflib.unified_diff(normalised(defs[-2][1]), normalised(defs[-1][1]), lineterm="", n=0) if line[:1] in "+-" and not line.startswith(("---", "+++"))]
    assert {line[1:].strip() for line in diff if line[0] == "-"} == {w.strip() for w in DROPPED}
    assert {line[1:].strip() for line in diff if line[0] == "+"} == {w.strip() for w in ADDED}
