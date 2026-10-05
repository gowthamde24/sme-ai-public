"""The opt-in smoke script: output shape tested against the offline fake; never run here."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from app.webfetch.fakes import FixturePageFetcher

ROOT = Path(__file__).resolve().parents[3]


def load() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "smoke_fetch", ROOT / "scripts" / "smoke_fetch.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_output_has_only_numbers_and_the_content_type_never_the_text() -> None:
    module = load()
    fetcher = FixturePageFetcher(ROOT / "tests" / "fixtures" / "web")
    lines, ok = module.run(
        fetcher, ["https://saree-house.test/", "https://closed-shop.test/", "https://nowhere.test/"]
    )
    assert not ok
    assert lines[0].startswith("https://saree-house.test/ status=200 bytes=")
    assert " content_type=text/html text_chars=" in lines[0]
    assert lines[2] == "https://nowhere.test/ refused code=http_status status=404"
    assert not any("Saree House" in line or "wholesale" in line for line in lines)


def test_the_script_asks_for_exactly_the_two_example_sites_through_the_default_fetcher() -> None:
    module = load()
    assert module.URLS == ("https://example.com/", "https://example.org/")
    source = (ROOT / "scripts" / "smoke_fetch.py").read_text()
    assert "make_default_fetcher()" in source and "test_allowed_networks" not in source


def test_the_smoke_target_is_not_part_of_make_check() -> None:
    makefile = (ROOT / "Makefile").read_text()
    check_line = next(line for line in makefile.splitlines() if line.startswith("check:"))
    assert "smoke-fetch" not in check_line
    fast_line = next(line for line in makefile.splitlines() if line.startswith("check-fast:"))
    assert "smoke-fetch" not in fast_line
    assert "\nsmoke-fetch:\n" in makefile
