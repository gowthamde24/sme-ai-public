"""Job DG: the demo data of the construction and school workspaces (scripts/demo_data.py). A fake API stands in; nothing is contacted. Proves: every phone number is in the fake +00 range, a piece that exists is never
overwritten (a re-seed cannot undo what a person did), a second run makes nothing new, the placeholder picture is a real image, and nothing in it names a real person."""

# ruff: noqa: E501

from __future__ import annotations

import io
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import demo_data  # noqa: E402


class FakeApi:
    """Remembers what was PUT or POSTed by path; answers like the real API for the paths the module uses."""

    def __init__(self, existing: dict[str, Any] | None = None) -> None:
        self.rows: dict[str, Any] = dict(existing or {})
        self.log: list[tuple[str, str]] = []
        self.bodies: list[Any] = []

    def __call__(self, method: str, path: str, body: Any = None, raw: Any = None) -> tuple[int, Any]:
        self.log.append((method, path))
        self.bodies.append(body)
        key = path.split("?")[0]
        if method == "GET":
            if key == "/materials/policy":
                return 200, {"current": self.rows.get("policy")}
            if key == "/institution/profile":
                return 200, {"configured": "profile" in self.rows}
            return (200, self.rows[key]) if key in self.rows else (422, {"error": {"code": "invalid_reference"}})
        if method == "POST" and key == "/contacts":
            return (409, {}) if key + (body or {}).get("id", "") in self.rows else (201, self.rows.setdefault(key + (body or {}).get("id", ""), body))
        if method == "POST" and "/photos" in key:
            self.rows[key.replace("/photos", "")]["photos"] = [{"id": "p"}]
            return 200, {}
        if method == "POST" and key == "/materials/policy":
            self.rows["policy"] = body
            return 200, {}
        if method == "PUT" and key.startswith(("/materials/items/", "/catalogue/items/")):
            self.rows[key] = {**self.rows.get(key, {}), **body, "photos": self.rows.get(key, {}).get("photos", [])}
            return 200, {}
        if method == "PUT" and key.startswith("/institution/profile"):
            self.rows["profile"] = body
            return 200, {}
        if method == "PUT" and key.startswith("/institution/fee-plans/"):
            self.rows[key] = body
            return 200, {}
        return 200, {}


def test_the_construction_demo_product_is_made_shown_with_a_picture_and_never_overwritten() -> None:
    api = FakeApi()
    first = demo_data.construction_materials(api)
    item = next(v for k, v in api.rows.items() if k.startswith("/materials/items/"))
    assert item["active"] is True and item["photos"], "an active product needs a photo (SM521)"
    assert "created" in first["demo product"]
    # the picture goes up BEFORE the product is shown: the database refuses an active product without one
    order = [p for m, p in api.log if m in ("POST", "PUT") and ("photos" in p or p.startswith("/materials/items/"))]
    assert order.index(next(p for p in order if "photos" in p)) < len(order) - 1
    # a person hides it (it has its picture): a re-seed leaves it hidden
    key = next(k for k in api.rows if k.startswith("/materials/items/"))
    api.rows[key]["active"] = False
    before = len(api.log)
    second = demo_data.construction_materials(api)
    assert "left as it is" in second["demo product"] and api.rows[key]["active"] is False
    assert not [1 for m, p in api.log[before:] if m in ("PUT", "POST") and "/materials/items/" in p], "no write on a second run"


def test_the_textiles_demo_catalogue_has_in_stock_silk_cotton_and_wedding_sarees_each_shown_with_a_picture() -> None:
    """Owner, 4 Nov 2026: 8 to 12 in-stock items with stock levels (silk, cotton, wedding), so a saree shop can reach call-ready."""
    api = FakeApi()
    first = demo_data.textiles(api)
    items = [v for k, v in api.rows.items() if k.startswith("/catalogue/items/")]
    assert 8 <= len(items) <= 12 and "11 created" in first["demo sarees"]
    assert all(i["active"] is True and i["photos"] for i in items), "every item is shown, and an active item needs a photo"
    levels = [i["stock_status"] for i in items]
    assert levels.count("in_stock") >= 8 and set(levels) <= {"in_stock", "few_left"}, "stock levels, mostly in stock"
    assert any("silk" in i["fabric"] or i["fabric"] in ("kanchi_pattu", "banarasi") for i in items) and any("cotton" in i["fabric"] for i in items)
    assert sum("wedding" in i["occasions"] for i in items) >= 3
    assert all(i["name"].endswith("(demo)") for i in items), "invented products, labelled"
    priced = [i for i in items if "price_paise" in i]
    assert priced and all(i["price_paise"] >= 100 for i in priced), "an exact price only where the Owner set one"
    # the picture goes up before the item is shown
    for key in (k for k in api.rows if k.startswith("/catalogue/items/")):
        writes = [i for i, (m, p) in enumerate(api.log) if m != "GET" and p.split("?")[0] in (key, key + "/photos")]
        assert [api.log[i][0] for i in writes] == ["PUT", "POST", "PUT"] and api.bodies[writes[0]]["active"] is False and api.bodies[writes[-1]]["active"] is True
    # a person hides one: a re-seed writes nothing and leaves it hidden
    key = next(k for k in api.rows if k.startswith("/catalogue/items/"))
    api.rows[key]["active"] = False
    before = len(api.log)
    second = demo_data.textiles(api)
    assert "0 created, 11 already there" in second["demo sarees"] and api.rows[key]["active"] is False
    assert not [1 for m, _ in api.log[before:] if m in ("PUT", "POST")], "no write on a second run"


def test_the_textiles_demo_catalogue_matches_what_saree_shops_boutiques_and_textile_shops_buy() -> None:
    """The Lead Finder's Researcher (app/lead_finder/decide.py) finds an in-stock match for every buyer type of the textiles pack."""
    sys.path.insert(0, str(ROOT / "services/ai-api"))
    from app.lead_finder import decide, packdata
    from app.lead_finder.service import stock_lines

    data = packdata.for_pack("textiles")
    assert data is not None
    rows = [{"name": i["name"], "fabric": i["fabric"], "occasions": i["occasions"], "stock_status": i["stock"], "price_paise": i["price"], "item_kind": "saree", "sell_unit": "piece"} for i in demo_data.TEXTILE_ITEMS]
    stock = stock_lines(rows)
    for buyer in data.buyer_types:
        assert decide.stock_match(buyer, stock).enough, buyer.code


def test_a_half_built_product_without_a_picture_is_finished_not_skipped() -> None:
    api = FakeApi({f"/materials/items/{demo_data.did('construction-demo-product')}": {"active": False, "photos": []}})
    demo_data.construction_materials(api)
    assert api.rows[f"/materials/items/{demo_data.did('construction-demo-product')}"]["active"] is True


def test_the_school_has_students_guardians_with_fake_numbers_and_dues() -> None:
    api = FakeApi()
    demo_data.education(api, date(2026, 10, 25))
    contacts = [b for (m, p), b in zip(api.log, api.bodies, strict=True) if m == "POST" and p == "/contacts"]
    assert len(contacts) == 3
    for c in contacts:
        assert re.fullmatch(r"\+00 000 000 71\d\d", c["phone"]), "the app's fake-number convention: +00 is not a dialling code"
        assert c["full_name"].endswith("(synthetic)")
    students = [b for (m, p), b in zip(api.log, api.bodies, strict=True) if m == "PUT" and p.startswith("/institution/students/") and "/payments/" not in p]
    assert [s["child_label"] for s in students] == ["Demo A", "Demo B", "Demo C"]
    plan = next(v for k, v in api.rows.items() if k.startswith("/institution/fee-plans/"))
    due = [ln["due_date"] for ln in plan["lines"]]
    assert sum(1 for d in due if d < "2026-10-25") == 2 and sum(1 for d in due if d > "2026-10-25") == 1, "two instalments already due, one to come"
    assert plan["academic_year"] == "2026-27"


def test_the_academic_year_follows_the_april_start() -> None:
    assert demo_data.academic_year(date(2026, 3, 31)) == "2025-26" and demo_data.academic_year(date(2026, 4, 1)) == "2026-27" and demo_data.academic_year(date(2099, 12, 1)) == "2099-00"


def test_the_placeholder_is_a_real_picture_and_small() -> None:
    png = demo_data.placeholder_png()
    image = Image.open(io.BytesIO(png))
    image.load()
    assert image.size == (640, 480) and len(png) < 10_000
