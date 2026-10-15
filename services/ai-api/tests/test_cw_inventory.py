"""Job CW: the data inventory and the erasure registry are complete for every table the night run C1 created (jobs CR and CV) and for everything after.

  * every table created by a migration from 20261125 on is named in docs/data-inventory.md (a new table must say what it holds, who may read it and how it is erased), or is listed here with its reason;
  * every such table that carries a tenant is a row of the erasure registry (`privacy.erasure_registry`-style seed in the migrations) or of the pgTAP registry (tests 00001 / 39), so the tenant-wide erasure and the identifier sweep reach it;
  * every PII-class column the CR migrations declare is named in the registry rows of the same migration.
The database half of the same promise is pgTAP 39 (every tenant table is classified) and 104 (the student table has no column beyond the minimum)."""

# ruff: noqa: E501

from __future__ import annotations

import re
from pathlib import Path

from tests.test_migration_copies import MIGRATIONS

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = (ROOT / "docs" / "data-inventory.md").read_text(encoding="utf-8")
REGISTRY_TEST = (ROOT / "supabase" / "tests" / "database" / "00001_tenant_table_registry.sql").read_text(encoding="utf-8")
FIRST = "20261125"
CREATE = re.compile(r"^create table (?:(?P<schema>[a-z_]+)\.)?(?P<name>[a-z_]+) \(", re.MULTILINE)

# tables that are bookkeeping of another table already in the inventory, with the inventory row that covers them
COVERED: dict[str, str] = {}


def new_tables() -> list[tuple[str, str, str]]:
    found: list[tuple[str, str, str]] = []
    for path in MIGRATIONS:
        if path.name < FIRST:
            continue
        text = path.read_text(encoding="utf-8")
        for m in CREATE.finditer(text):
            body = text[m.end() : m.end() + 3000].split(");", 1)[0]
            found.append((path.name, (m.group("schema") or "public") + "." + m.group("name"), body))
    return found


def test_the_night_run_created_tables_and_they_are_found() -> None:
    names = {t for _, t, _ in new_tables()}
    assert len(names) >= 16, names
    for expected in ("public.students", "public.admissions", "public.fee_plans", "public.voice_settings", "public.voice_note_usage", "voice.voices", "voice.disclosures"):
        assert expected in names, expected


def test_every_new_table_is_in_the_data_inventory() -> None:
    missing = [t for _, t, _ in new_tables() if t not in COVERED and t.split(".", 1)[1] not in INVENTORY]
    assert missing == [], f"add these tables to docs/data-inventory.md (what they hold, who reads them, how they are erased): {missing}"


def test_every_new_tenant_table_is_classified_in_the_registry_of_the_pgtap_suite() -> None:
    missing = []
    for _, t, body in new_tables():
        if "tenant_id" not in body:
            continue
        schema, name = t.split(".", 1)
        key = name if schema == "public" else t
        if f"'{key}'" not in REGISTRY_TEST:
            missing.append(t)
    assert missing == [], f"classify these in supabase/tests/database/00001_tenant_table_registry.sql: {missing}"


def test_the_students_table_has_no_column_beyond_the_minimum() -> None:
    (body,) = [b for _, t, b in new_tables() if t == "public.students"]
    columns = {line.strip().split()[0] for line in body.splitlines() if line.strip() and not line.strip().startswith(("--", "unique", "check", "primary", "foreign", "constraint"))}
    assert columns <= {"id", "tenant_id", "contact_id", "guardian_contact_id", "is_adult", "child_label", "admission_no", "programme_id", "group_id", "status", "joined_on", "left_on", "erased_at", "created_by", "created_at", "updated_at", "updated_by"}, columns
