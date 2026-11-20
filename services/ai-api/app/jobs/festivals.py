"""The dated festival calendar (jobs contract 1.1, T8): packages/packs/festivals.json, DATA not code.

One row per region, season and year, the date written out; nothing is calculated (a moving lunar date is simply a different date per year). A file that breaks a rule is refused whole, logged and answered
as "no calendar" (fail closed). A test fails when the next 12 months of any region lack a Diwali, wedding-season or new-year row, so nobody forgets to extend the file (`gaps`).
"""

# ruff: noqa: E501

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.packs.registry import default_directory

logger = logging.getLogger("app.jobs.festivals")

REGIONS = ("andhra", "telangana", "karnataka", "india")
FALLBACK_REGION = "india"
SEASONS = ("diwali", "wedding_season", "new_year")
LANGUAGES = ("en", "te", "hi", "kn")
WINDOW_DAYS = 60
IST = timezone(timedelta(hours=5, minutes=30))
# the GST portal's names (app/gstin.py STATE_NAMES) that start with these words
_STATE_REGION = (("andhra pradesh", "andhra"), ("telangana", "telangana"), ("karnataka", "karnataka"))


class FestivalsError(ValueError):
    """A festivals.json that must not be served."""


@dataclass(frozen=True)
class Festival:
    region: str
    season: str
    name: dict[str, str]
    date: date


@dataclass(frozen=True)
class Calendar:
    status: str
    rows: tuple[Festival, ...]


def region_for_state(state: str | None) -> str:
    """The region of a workspace from its state's name (the business profile's state): Andhra Pradesh, Telangana and Karnataka have their own; anything else, or no state, is india."""
    text = (state or "").strip().casefold()
    for prefix, region in _STATE_REGION:
        if text.startswith(prefix):
            return region
    return FALLBACK_REGION


def parse(raw: Any) -> Calendar:
    if not isinstance(raw, dict) or set(raw) - {"$schema", "$comment", "status", "version", "rows"} or {"status", "version", "rows"} - set(raw):
        raise FestivalsError("top-level keys are wrong")
    if raw["status"] != "draft":
        raise FestivalsError("status must be draft until the owner has checked the dates")
    if not isinstance(raw["version"], int) or raw["version"] < 1 or not isinstance(raw["rows"], list) or not raw["rows"]:
        raise FestivalsError("version is a whole number from 1 and rows is a list")
    rows: list[Festival] = []
    seen: set[tuple[str, str, int]] = set()
    for i, row in enumerate(raw["rows"]):
        where = f"rows[{i}]"
        if not isinstance(row, dict) or set(row) != {"region", "season", "name", "date"}:
            raise FestivalsError(f"{where}: a row is {{region, season, name, date}}")
        if row["region"] not in REGIONS or row["season"] not in SEASONS:
            raise FestivalsError(f"{where}: region or season is not in the closed list")
        name = row["name"]
        if not isinstance(name, dict) or "en" not in name or "te" not in name or set(name) - set(LANGUAGES) or any(not isinstance(v, str) or not v.strip() or len(v) > 60 for v in name.values()):
            raise FestivalsError(f"{where}: name is {{en, te, hi?, kn?}}")
        try:
            day = date.fromisoformat(row["date"]) if isinstance(row["date"], str) and len(row["date"]) == 10 else None
        except ValueError:
            day = None
        if day is None:
            raise FestivalsError(f"{where}: date is YYYY-MM-DD")
        key = (row["region"], row["season"], day.year)
        if key in seen:
            raise FestivalsError(f"{where}: {key} is written twice")
        seen.add(key)
        rows.append(Festival(region=row["region"], season=row["season"], name=dict(name), date=day))
    return Calendar(status=raw["status"], rows=tuple(rows))


def load_file(path: Path) -> Calendar:
    try:
        return parse(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:
        raise FestivalsError(f"the file cannot be read ({type(exc).__name__})") from exc


@lru_cache(maxsize=8)
def _load(directory: str) -> Calendar | None:
    path = Path(directory) / "festivals.json"
    if not path.is_file():
        return None
    try:
        return load_file(path)
    except FestivalsError as exc:
        logger.error("the festival calendar was refused: %s", exc)
        return None


def calendar(directory: Path | None = None) -> Calendar | None:
    base = directory or default_directory()
    return _load(str(base)) if base is not None else None


def upcoming(cal: Calendar, region: str, today: date, days: int = WINDOW_DAYS) -> list[Festival]:
    """The next `days` days (today included) of this region: the nearest row of each season, nearest first."""
    last = today + timedelta(days=days)
    nearest: dict[str, Festival] = {}
    for row in sorted(cal.rows, key=lambda r: r.date):
        if row.region == region and today <= row.date <= last and row.season not in nearest:
            nearest[row.season] = row
    return sorted(nearest.values(), key=lambda r: (r.date, SEASONS.index(r.season)))


def gaps(cal: Calendar, today: date, months: int = 12) -> list[tuple[str, str]]:
    """(region, season) pairs that have no row in the next 12 months from `today`: the file needs its next year."""
    last = today + timedelta(days=round(months * 365 / 12))
    return [
        (region, season)
        for region in REGIONS
        for season in SEASONS
        if not any(r.region == region and r.season == season and today <= r.date <= last for r in cal.rows)
    ]


def today_in_india(clock: Callable[[], datetime]) -> date:
    return clock().astimezone(IST).date()
