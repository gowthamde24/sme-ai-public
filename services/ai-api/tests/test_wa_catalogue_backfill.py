"""The catalogue backfill migration says exactly what the API's first-template file says for the 12 catalogue messages (same words, same buttons, same id namespace), is drafts only and never submits anything."""

# ruff: noqa: E501

from __future__ import annotations

from pathlib import Path

from app.whatsapp import first_templates

ROOT = Path(__file__).resolve().parents[3]
MIGRATION = ROOT / "supabase" / "migrations" / "20261231986400_catalogue_backfill.sql"
FIX = ROOT / "supabase" / "migrations" / "20261231986600_catalogue_text_fixes.sql"
FIRST_SET = {"lead_ack", "visit_reminder", "visit_confirmation", "missed_call_followup", "followup_nudge", "catalogue_share", "new_collection_offer", "festival_offer", "continue_chat"}


def test_every_draft_the_api_makes_is_what_the_backfill_wrote_or_what_the_text_fix_changed_it_to() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    fix = FIX.read_text(encoding="utf-8")
    ours = [d for d in first_templates.drafts(("en", "te")) if d["name"] not in FIRST_SET]
    assert len({d["name"] for d in ours}) == 12 and len(ours) == 24
    assert str(first_templates.NAMESPACE) in sql
    for d in ours:
        body = d["body"].replace("'", "''")
        assert f"'{d['name']}'" in sql and (body in sql or body in fix), d["name"] + " " + d["language"]
    assert "w.status = 'draft'" in fix and "w.body = v.old_body" in fix, "only a draft that still holds the old words is changed"
    assert "submitted" not in fix.lower().replace("nothing is submitted", "").replace("edited, submitted or approved", ""), "the fix sends nothing to Meta"


def test_it_creates_drafts_only_for_businesses_that_have_the_first_set_and_never_sends_anything() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "'draft'" in sql and "on conflict do nothing" in sql and "where name = 'lead_ack'" in sql
    assert "submitted" not in sql.lower().replace("never submitted", ""), "nothing here sends anything to Meta"
    assert "payment_reminder" not in sql and "consent_ask" not in sql and "platform_alert" not in sql, "the hidden and the owner-gated ones are not created here"
