# ruff: noqa: E501
"""The staging backup must list every schema of the database (first real restore drill, 28 Oct 2026: `billing` was missing)."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def load() -> Any:
    sys.path.insert(0, str(SCRIPTS))
    spec = importlib.util.spec_from_file_location("staging_backup_under_test", SCRIPTS / "staging_backup.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_billing_is_in_the_backup_and_a_new_schema_stops_it() -> None:
    backup = load()
    assert "billing" in backup.SCHEMAS
    known = {"public", "billing", "auth", "vault", "storage", "pg_toast", "information_schema"}
    assert backup.unlisted_schemas(known) == set()
    assert backup.unlisted_schemas({"public", "brand_new_schema"}) == {"brand_new_schema"}


def test_every_migration_schema_is_listed() -> None:
    """Every `create schema` of the migrations is listed (or is a platform schema): the next new one fails here, not in a drill."""
    import re

    backup = load()
    made: set[str] = set()
    for path in (SCRIPTS.parent / "supabase" / "migrations").glob("*.sql"):
        text = path.read_text(encoding="utf-8")
        made |= set(re.findall(r"^\s*create schema (?:if not exists )?\"?([a-z_]+)\"?", text, flags=re.IGNORECASE | re.MULTILINE))
    assert backup.unlisted_schemas(made) == set(), sorted(backup.unlisted_schemas(made))
