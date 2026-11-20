"""Customer Zero code list item 5 (20 Nov 2026): the declared production API says LEAD_FINDER explicitly (the default would be the synthetic fixture, shown to a real shop); `places` only with the Google key declared;
the free-cap guards stay on both Google calls."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def declared(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            name, _, value = line.partition("=")
            out[name.strip()] = value
    return out


def test_production_never_shows_a_real_shop_invented_businesses_and_places_needs_its_key() -> None:
    env = declared(ROOT / "deploy" / "settings" / "production" / "api.env")
    secrets = declared(ROOT / "deploy" / "settings" / "production" / "api.secrets")
    assert env.get("LEAD_FINDER") in ("off", "places"), "production must say LEAD_FINDER and never leave the fixture default"
    if env["LEAD_FINDER"] == "places":
        assert "GOOGLE_PLACES_API_KEY" in secrets
    assert env.get("LEAD_FINDER_PLACES_MOCK", "false") in ("", "false"), "no invented businesses in production"


def test_the_free_cap_guard_stays_on_both_google_calls() -> None:
    service = (ROOT / "services" / "ai-api" / "app" / "lead_finder" / "service.py").read_text(encoding="utf-8")
    assert 'google_allowed(self._usage, "search_enterprise", 1)' in service
    assert 'google_allowed(self._usage, "details_enterprise", len(ids))' in service
