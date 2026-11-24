"""Jobs S2a data: the identity of every business type (`sell_style`, `plural_names`), the dated festival calendar and the pack answer's `sell_style` (jobs contract 1.1 part 1, W1, T2, T8)."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.jobs import festivals, identity
from tests.fakes import TENANT_A, auth, make_client

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
IDS = sorted(p.parent.name for p in PACKS.glob("*/pack.json"))
# the map C2 wrote and C1 confirmed (contract 1.1 W1)
STYLES = {
    "textiles": "products", "construction_materials": "products", "auto_dealer": "products", "general_business": "products",
    "clinic": "services", "gym": "services", "insurance_loans": "services", "interiors_solar": "services", "travel": "services",
    "education": "courses", "coaching": "courses", "real_estate": "properties", "wholesale_b2b": "pricelist",
    # the 41 types added 29 Nov 2026 (reports/business-type-catalogue.md)
    "kirana": "products",
    "jewellery": "products",
    "electronics": "products",
    "furniture": "products",
    "stationery_gifts": "products",
    "hardware_paint": "products",
    "pharmacy": "products",
    "fashion_tailor": "products",
    "online_store": "products",
    "restaurant": "products",
    "bakery_sweets": "products",
    "catering_tiffin": "products",
    "cloud_kitchen": "products",
    "salon_beauty": "services",
    "home_repair": "services",
    "cleaning_pest": "services",
    "appliance_vehicle_repair": "services",
    "photography": "services",
    "event_wedding": "services",
    "laundry_dry_cleaning": "services",
    "dental": "services",
    "physio_rehab": "services",
    "vet_pet": "services",
    "diagnostics_lab": "services",
    "preschool": "courses",
    "arts_music": "courses",
    "skills_training": "courses",
    "online_courses": "courses",
    "car_service": "services",
    "vehicle_rental": "products",
    "hotel_homestay": "products",
    "finance_agent": "services",
    "legal_ca": "services",
    "consultants_agencies": "services",
    "digital_products": "products",
    "software_saas": "services",
    "creators_communities": "services",
    "yoga_studio": "services",
    "sports_academy": "courses",
    "agri_nursery": "products",
    "ngo_trust": "services",
}  # fmt: skip


def raw(pack_id: str) -> dict[str, Any]:
    return json.loads((PACKS / pack_id / "identity.json").read_text(encoding="utf-8"))  # type: ignore[no-any-return]


# ------------------------------------------------------------------------------------------------------------------ identity: sell_style and plural_names
def test_the_style_map_covers_exactly_the_packs() -> None:
    assert set(IDS) == set(STYLES) and len(IDS) == 54


@pytest.mark.parametrize("pack_id", IDS)
def test_every_pack_has_a_sell_style_and_plural_names(pack_id: str) -> None:
    assert (PACKS / pack_id / "identity.json").is_file(), f"{pack_id} has no identity.json: no sell_style, no plural name"
    found = identity.for_pack(pack_id, PACKS)
    assert found is not None, f"{pack_id}: identity.json is refused by the loader (see the log)"
    assert found.sell_style == STYLES[pack_id] == raw(pack_id)["sell_style"]
    assert found.plural_names["en"] and found.plural_names["te"]
    assert identity.sell_style(pack_id, PACKS) == STYLES[pack_id]


@pytest.mark.parametrize("pack_id", IDS)
def test_identity_files_are_valid_against_their_schema(pack_id: str) -> None:
    schema = json.loads((PACKS / "identity.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(raw(pack_id))) == []
    assert raw(pack_id)["pack"] == pack_id


def test_the_five_styles_are_all_used() -> None:
    assert set(STYLES.values()) == set(identity.SELL_STYLES)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(sell_style="gallery"),
        lambda d: d.pop("sell_style"),
        lambda d: d.update(pack="other_pack"),
        lambda d: d.update(status="published"),
        lambda d: d["plural_names"].pop("te"),
        lambda d: d["plural_names"].update(te="saree shops"),
        lambda d: d["plural_names"].update(en="x" * 61),
        lambda d: d["plural_names"].update(en="10 shops"),
        lambda d: d["plural_names"].update(ta="x"),
        lambda d: d.update(extra=1),
    ],
)
def test_the_identity_loader_refuses_a_broken_file(mutate: Any) -> None:
    data = copy.deepcopy(raw("textiles"))
    mutate(data)
    with pytest.raises(identity.IdentityError):
        identity.parse("textiles", data)


def test_a_pack_without_an_identity_file_answers_none_and_the_plainest_style(tmp_path: Path) -> None:
    (tmp_path / "x_pack").mkdir()
    assert identity.for_pack("x_pack", tmp_path) is None and identity.sell_style("x_pack", tmp_path) == "products"
    assert identity.for_pack("../etc", tmp_path) is None and identity.for_pack(None, tmp_path) is None
    (tmp_path / "x_pack" / "identity.json").write_text("{not json", encoding="utf-8")
    assert identity.for_pack("x_pack", tmp_path) is None, "a file that does not parse fails closed"


class PackRow:
    def __init__(self, pack_id: str) -> None:
        self.pack_id = pack_id

    def workspace_pack(self, token: str, tenant_id: Any) -> dict[str, Any]:
        return {"pack_id": self.pack_id, "version": 2, "status": "published", "validated": True, "source": "signup", "chosen_at": "2026-10-14T09:00:00+00:00", "manifest": {"names": {"en": "x"}}, "modules": []}


@pytest.mark.parametrize("pack_id", IDS)
def test_the_pack_answer_carries_the_sell_style(pack_id: str) -> None:
    client, _ = make_client(packs=PackRow(pack_id))
    r = client.get(f"/v1/tenants/{TENANT_A.id}/pack", headers=auth("a_viewer"))
    assert r.status_code == 200, r.text
    assert r.json()["sell_style"] == STYLES[pack_id], "every member reads it, with JOBS off too"


def test_the_contract_export_carries_sell_style() -> None:
    root = PACKS.parents[1]
    schema = json.loads((root / "packages" / "contracts" / "packs.schema.json").read_text(encoding="utf-8"))
    prop = schema["$defs"]["WorkspacePackOut"]["properties"]["sell_style"]
    assert set(prop["enum"]) == set(identity.SELL_STYLES)
    assert "sell_style" in schema["$defs"]["WorkspacePackOut"]["required"]
    assert "sell_style: " in (root / "packages" / "contracts" / "packs.ts").read_text(encoding="utf-8")


# ------------------------------------------------------------------------------------------------------------------ the festival calendar
CAL = festivals.load_file(PACKS / "festivals.json")


def test_the_file_is_valid_against_its_schema_and_a_draft() -> None:
    doc = json.loads((PACKS / "festivals.json").read_text(encoding="utf-8"))
    schema = json.loads((PACKS / "festivals.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    assert list(jsonschema.Draft202012Validator(schema).iter_errors(doc)) == []
    assert doc["status"] == CAL.status == "draft"


def test_every_region_has_every_season_for_2026_to_2028() -> None:
    for region in festivals.REGIONS:
        for season in festivals.SEASONS:
            years = {r.date.year for r in CAL.rows if r.region == region and r.season == season}
            assert {2026, 2027, 2028} <= years, (region, season, sorted(years))
    assert len(CAL.rows) == len({(r.region, r.season, r.date.year) for r in CAL.rows}), "one row per region, season and year"


def test_the_dates_the_owner_gave_and_new_year() -> None:
    by = {(r.region, r.season, r.date.year): r.date for r in CAL.rows}
    assert by[("india", "diwali", 2026)] == date(2026, 11, 8) and by[("india", "diwali", 2026)].weekday() == 6, "Sunday 8 Nov 2026"
    assert by[("india", "diwali", 2027)] == date(2027, 10, 29) and by[("india", "diwali", 2027)].weekday() == 4, "Friday"
    assert by[("india", "diwali", 2028)] == date(2028, 10, 17) and by[("india", "diwali", 2028)].weekday() == 1, "Tuesday"
    assert all(r.date.month == 1 and r.date.day == 1 for r in CAL.rows if r.season == "new_year")
    assert all(r.date.month in (10, 11) for r in CAL.rows if r.season in ("diwali", "wedding_season"))


def test_every_name_has_english_and_telugu_and_telugu_letters() -> None:
    for r in CAL.rows:
        assert r.name["en"] and r.name["te"] and any("ఀ" <= ch <= "౿" for ch in r.name["te"]), r


def test_nobody_forgot_to_extend_the_file_the_next_12_months_of_every_region_have_every_season() -> None:
    """The guard of the contract: when this fails the file needs its next year (the real clock is used on purpose)."""
    today = datetime.now(UTC).astimezone(festivals.IST).date()
    assert festivals.gaps(CAL, today) == [], f"festivals.json has no row for {festivals.gaps(CAL, today)} in the next 12 months: add the next year"


def test_the_guard_holds_for_every_day_of_the_first_year_the_file_serves() -> None:
    day = date(2026, 11, 19)
    while day <= date(2028, 10, 16):
        assert festivals.gaps(CAL, day) == [], day
        day += timedelta(days=1)


def test_the_guard_catches_a_missing_row_and_the_end_of_the_file() -> None:
    thin = festivals.Calendar(status="draft", rows=tuple(r for r in CAL.rows if not (r.region == "karnataka" and r.season == "diwali" and r.date.year == 2027)))
    assert festivals.gaps(thin, date(2026, 11, 19)) == [("karnataka", "diwali")]
    assert festivals.gaps(thin, date(2027, 10, 30)) == [], "after the missing Diwali the next 12 months hold the 2028 one"
    assert festivals.gaps(CAL, date(2028, 10, 18))[0] == ("andhra", "diwali"), "after Diwali 2028 the file has run out"
    assert festivals.gaps(festivals.Calendar("draft", ()), date(2026, 1, 1)) == [(r, s) for r in festivals.REGIONS for s in festivals.SEASONS]


def test_upcoming_is_one_row_per_season_nearest_first() -> None:
    rows = festivals.upcoming(CAL, "andhra", date(2026, 11, 1), days=400)
    assert [(r.season, r.date.isoformat()) for r in rows] == [("diwali", "2026-11-08"), ("wedding_season", "2026-11-21"), ("new_year", "2027-01-01")]
    assert festivals.upcoming(CAL, "andhra", date(2026, 11, 19), days=0) == []
    assert festivals.upcoming(CAL, "nowhere", date(2026, 11, 19)) == []


@pytest.mark.parametrize(
    ("state", "region"),
    [("Andhra Pradesh", "andhra"), ("Andhra Pradesh (before 2014)", "andhra"), ("Telangana", "telangana"), (" karnataka ", "karnataka"), ("Tamil Nadu", "india"), ("Maharashtra", "india"), ("", "india"), (None, "india")],
)
def test_region_for_state(state: str | None, region: str) -> None:
    assert festivals.region_for_state(state) == region


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d["rows"][0].update(region="goa"),
        lambda d: d["rows"][0].update(season="holi"),
        lambda d: d["rows"][0].update(date="2026-13-40"),
        lambda d: d["rows"][0].update(date="8 Nov 2026"),
        lambda d: d["rows"][0]["name"].pop("te"),
        lambda d: d["rows"].append(copy.deepcopy(d["rows"][0])),
        lambda d: d.update(status="published"),
        lambda d: d.update(rows=[]),
        lambda d: d["rows"][0].update(extra=1),
        lambda d: d.pop("version"),
    ],
)
def test_the_loader_refuses_a_broken_calendar(mutate: Any) -> None:
    doc = json.loads((PACKS / "festivals.json").read_text(encoding="utf-8"))
    mutate(doc)
    with pytest.raises(festivals.FestivalsError):
        festivals.parse(doc)


def test_a_broken_calendar_file_answers_none_and_is_logged(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    (tmp_path / "festivals.json").write_text("{}", encoding="utf-8")
    assert festivals.calendar(tmp_path) is None and "was refused" in caplog.text
    assert festivals.calendar(tmp_path / "nowhere") is None
