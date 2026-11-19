"""The continue_chat backfill migration says exactly what the API's first-template set says (same words, same id namespace), so a business that gets it later is no different from one that got it with the set."""

# ruff: noqa: E501

from __future__ import annotations

from pathlib import Path

from app.whatsapp import first_templates

MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "20261231985100_continue_chat_backfill.sql"


def test_the_backfill_uses_the_api_namespace_and_the_api_words() -> None:
    sql = MIGRATION.read_text(encoding="utf-8")
    assert str(first_templates.NAMESPACE) in sql, "same uuid namespace: the ids are the ones the API makes"
    ours = {d["language"]: d for d in first_templates.drafts(("en", "te")) if d["name"] == "continue_chat"}
    assert set(ours) == {"en", "te"}
    for language, draft in ours.items():
        assert f"('{language}', '{draft['body']}')" in sql, language
        assert draft["category"] == "utility" and draft["purpose"] == "followup"
    assert "'draft'" in sql and "on conflict do nothing" in sql
    assert "submit" not in sql.lower().replace("never submitted", "").replace("is never submitted", ""), "nothing here sends anything to Meta"
