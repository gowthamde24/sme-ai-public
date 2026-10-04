"""supabase/config.toml: the private `app` schema must never be exposed through PostgREST.

Fast, Docker-free guard. The integration suite checks the same thing against the running stack.
"""

import tomllib
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[3] / "supabase" / "config.toml"


def test_app_schema_is_not_exposed_through_the_api() -> None:
    api = tomllib.loads(CONFIG.read_text())["api"]
    assert "app" not in api["schemas"]
    assert "app" not in api.get("extra_search_path", [])


def test_only_public_is_exposed() -> None:
    assert tomllib.loads(CONFIG.read_text())["api"]["schemas"] == ["public"]
