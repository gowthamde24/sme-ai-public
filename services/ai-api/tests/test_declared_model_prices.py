# ruff: noqa: E501
"""A model named in a declared settings file must have a price row in a migration (26 Nov 2026): production's claude-haiku-5-5 had none and every assistant model turn was refused as `model_not_configured`."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SETTINGS = sorted((ROOT / "deploy" / "settings").glob("*/api.env"))
PRICES = "\n".join(p.read_text() for p in sorted((ROOT / "supabase" / "migrations").glob("*.sql")) if "agent_model_prices" in p.read_text())


def declared(path: Path, key: str) -> str | None:
    for line in path.read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    return None


@pytest.mark.parametrize("path", SETTINGS, ids=lambda p: p.parent.name)
def test_every_declared_model_has_a_price_row_in_a_migration(path: Path) -> None:
    for key in ("LLM_MODEL", "LLM_LIGHT_MODEL"):
        model = declared(path, key)
        if model:
            assert re.search(r"\(\s*'" + re.escape(model) + r"'\s*,\s*\d+\s*,\s*\d+\s*\)", PRICES), f"{path.parent.name}: {key}={model} has no price row in a migration (insert into public.agent_model_prices ... on conflict do nothing)"


@pytest.mark.parametrize("path", SETTINGS, ids=lambda p: p.parent.name)
def test_the_declared_price_is_the_one_in_the_migration(path: Path) -> None:
    model, inp, out = declared(path, "LLM_MODEL"), declared(path, "LLM_INPUT_MICROS_PER_MTOK"), declared(path, "LLM_OUTPUT_MICROS_PER_MTOK")
    if model and inp and out:
        assert re.search(r"\(\s*'" + re.escape(model) + rf"'\s*,\s*{inp}\s*,\s*{out}\s*\)", PRICES), f"{path.parent.name}: the declared prices of {model} differ from the migration's row"
