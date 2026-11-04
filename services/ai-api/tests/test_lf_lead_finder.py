"""Lead Finder (ADR 0119): the sources (fixture; Google Places with a RECORDED fake response), dedupe, every decision rule (A3), the plan card and result card end to end on a demo workspace (A2),
a school refused (A5), and no code path that can place a real call (A6)."""

# ruff: noqa: E501
from __future__ import annotations

import ast
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.lead_finder import decide, dedupe, intent, packdata
from app.lead_finder.decide import Settings, Situation, StockLine
from app.lead_finder.service import LeadFinderService, stock_lines
from app.lead_finder.sources import (
    FIELD_MASK,
    PLACES_SKU,
    FixtureSource,
    GooglePlacesSource,
    Place,
    SearchRequest,
    SourceError,
    parse_places,
)
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import MATERIAL_STOCK, NOW, TEXTILE_STOCK, FakeLeadFinderRepo

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
TEXTILES = packdata.for_pack("textiles", PACKS)
MATERIALS = packdata.for_pack("construction_materials", PACKS)
STOCK = stock_lines(TEXTILE_STOCK)
IN_HOURS = datetime(2026, 11, 4, 6, 0, tzinfo=UTC)      # 11:30 IST
NIGHT = datetime(2026, 11, 4, 16, 0, tzinfo=UTC)        # 21:30 IST
URL = f"/v1/tenants/{TENANT_A.id}"
RECORDED = Path(__file__).parent / "fixtures" / "places_text_search_recorded.json"


def place(name: str = "Sri Lakshmi Sarees", category: str = "Saree shop", *, phone: str | None = "+00 000 5123 4567", rating: float | None = 4.5, reviews: int | None = 300, area: str = "Jayanagar") -> Place:
    return Place(place_id=f"fx_{abs(hash(name)) % 10**12}", name=name, category=category, area=area, lat=12.93, lng=77.58, phone=phone, website=None, rating=rating, review_count=reviews)


def sit(**kw: Any) -> Situation:
    return Situation(now=kw.pop("now", IN_HOURS), **kw)


# ---------------------------------------------------------------------------------------------------------------------------------- data
def test_the_pack_files_say_which_business_types_have_a_lead_finder() -> None:
    assert TEXTILES is not None and MATERIALS is not None
    assert packdata.for_pack("education", PACKS) is None, "a school has no Lead Finder data: no outreach"
    assert packdata.for_pack("../textiles", PACKS) is None, "a path is never a pack id"
    for data in (TEXTILES, MATERIALS):
        assert set(data.questions) == {"sells", "price", "quantity", "supplier", "timing", "decision"}
        assert all({"en", "te"} <= set(q) for q in data.questions.values())
        assert len(data.fixture) >= 20


def test_every_fixture_business_is_invented_with_a_reserved_number() -> None:
    assert TEXTILES is not None
    result = FixtureSource(TEXTILES).search(SearchRequest(query="saree shops", area="Jayanagar", max_results=20))
    assert len(result.places) == 20 and result.cost_paise == 0 and result.requests == 0 and result.sku == "fixture"
    assert all(p.phone is None or p.phone.startswith("+00 ") for p in result.places)
    again = FixtureSource(TEXTILES).search(SearchRequest(query="saree shops", area="Jayanagar", max_results=20))
    assert [p.place_id for p in again.places] == [p.place_id for p in result.places], "the same search finds the same places"
    assert len({p.place_id for p in result.places}) == 20


# ---------------------------------------------------------------------------------------------------------------------------------- Google Places (contract tests, recorded response, no network)
def _places(handler: Any) -> GooglePlacesSource:
    return GooglePlacesSource("test-key-not-real", 300, client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_places_asks_only_for_the_fields_it_needs_and_bills_one_enterprise_request() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["headers"], seen["body"] = str(request.url), request.headers, json.loads(request.content)
        return httpx.Response(200, json=json.loads(RECORDED.read_text()))

    result = _places(handler).search(SearchRequest(query="saree shops", area="Jayanagar Bengaluru", max_results=20))
    assert seen["url"] == "https://places.googleapis.com/v1/places:searchText"
    assert seen["headers"]["X-Goog-FieldMask"] == FIELD_MASK and seen["headers"]["X-Goog-Api-Key"] == "test-key-not-real"
    assert seen["body"] == {"textQuery": "saree shops in Jayanagar Bengaluru", "pageSize": 20, "regionCode": "IN", "languageCode": "en"}
    assert "places.reviews" not in FIELD_MASK and "places.photos" not in FIELD_MASK, "no Atmosphere field: it would bill a dearer SKU"
    assert result.sku == PLACES_SKU and result.requests == 1 and result.cost_paise == 300
    names = [p.name for p in result.places]
    assert "Closed Sarees (recorded)" not in names, "a closed business is dropped"
    assert all(p.place_id and p.name for p in result.places) and len(result.places) == 3
    first = result.places[0]
    assert first.phone == "080 2345 6789" and first.rating == 4.4 and first.review_count == 512 and first.category == "Saree store" and first.area


def test_places_never_logs_the_key_and_a_failure_is_a_failed_search_not_a_retry(caplog: pytest.LogCaptureFixture) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(403, json={"error": {"message": "API key not valid"}})

    source = _places(handler)
    with pytest.raises(SourceError):
        source.search(SearchRequest(query="saree shops", area=None, max_results=5))
    assert len(calls) == 1 and "test-key-not-real" not in caplog.text and "test-key-not-real" not in repr(source)


def test_malformed_place_rows_are_dropped_never_guessed() -> None:
    body = {"places": [{"id": "bad id with spaces", "displayName": {"text": "X"}}, {"id": "ok_1"}, {"id": "ok_2", "displayName": {"text": "Real"}, "rating": 9}, "junk"]}
    out = parse_places(body, 20)
    assert [p.place_id for p in out] == ["ok_2"] and out[0].rating is None


# ---------------------------------------------------------------------------------------------------------------------------------- dedupe
def test_a_business_already_ours_is_not_found_again() -> None:
    known = dedupe.Known.from_context({
        "customers": [{"phone_key": "9845012345", "name": "Ravi Kumar"}], "companies": [{"name": "Meenakshi Silks Pvt Ltd"}],
        "prospects": [{"place_id": "fx_seen", "phone_key": "000051112222", "name_key": "kaveri textiles", "area": "Jayanagar", "suppressed": False},
                      {"place_id": "fx_stop", "phone_key": "000059998888", "name_key": "vasavi pattu", "area": "Jayanagar", "suppressed": True}],
    })
    cases = {
        "customer phone": (Place("p1", "Another Name", "Saree shop", "Jayanagar", None, None, "+91 98450 12345", None, None, None), "customer"),
        "company name": (Place("p2", "Meenakshi Silks", "Saree shop", "Jayanagar", None, None, "+00 000 5000 0001", None, None, None), "company"),
        "same place": (Place("fx_seen", "Different", "Saree shop", "Jayanagar", None, None, None, None, None, None), "prospect"),
        "nearly same name, same area": (Place("p3", "Kaveri Textile", "Textile shop", "Jayanagar", None, None, None, None, None, None), "prospect"),
        "suppressed by phone": (Place("p4", "New Name", "Saree shop", "Jayanagar", None, None, "+00 0005 9998 888", None, None, None), "suppressed"),
        "suppressed by name": (Place("p5", "Sri Vasavi Pattu", "Saree shop", "Jayanagar", None, None, None, None, None, None), "suppressed"),
        "suppressed by place": (Place("fx_stop", "Renamed", "Saree shop", "Jayanagar", None, None, None, None, None, None), "suppressed"),
        "new": (Place("p6", "Gayatri Saree Point", "Saree shop", "Jayanagar", None, None, "+00 000 5000 0002", None, None, None), None),
        "same name elsewhere": (Place("p7", "Kaveri Textiles", "Textile shop", "Malleswaram", None, None, None, None, None, None), None),
    }
    for label, (p, want) in cases.items():
        assert dedupe.duplicate_of(p, known) == want, label
    fresh, counts = dedupe.split([cases["new"][0], cases["new"][0], cases["customer phone"][0]], known)
    assert len(fresh) == 1 and counts == {"prospect": 1, "customer": 1}, "the same place twice in one result is one place"


# ---------------------------------------------------------------------------------------------------------------------------------- decisions (A3: every row of the job's table)
def _d(p: Place, stock: list[StockLine] = STOCK, settings: Settings | None = None, situation: Situation | None = None, **kw: Any) -> decide.Decision:
    assert TEXTILES is not None
    return decide.decide(p, TEXTILES, stock, settings or Settings(), situation or sit(approved_in_search=10), **kw)


def test_call_ready_needs_fit_over_the_bar_stock_hours_and_cap() -> None:
    d = _d(place())
    assert d.status == "call_ready" and d.reason == "fit_high" and d.fit >= 70 and d.stock.enough
    assert "Kanchi Pattu Bridal" in d.fit_reason or "Dharmavaram Silk Classic" in d.fit_reason


def test_skip_rows() -> None:
    assert _d(place("Annapurna Sweets", "Sweet shop")).reason == "not_a_buyer"
    assert _d(place(), suppressed=True).reason == "suppressed"
    assert _d(place(), last_contacted_at=IN_HOURS - timedelta(days=30)).reason == "contacted_recently"
    assert _d(place(), last_contacted_at=IN_HOURS - timedelta(days=91)).status == "call_ready", "after 90 days it may be called again"
    low = _d(place("Sai Ram Tailors", "Tailor", rating=3.0, reviews=2))
    assert low.status == "skipped" and low.reason == "fit_low" and low.fit < 50
    assert _d(place(phone=None)).reason == "no_phone"


def test_needs_owner_rows() -> None:
    middle = _d(place("Sai Saree Corner", "Saree shop", rating=3.9, reviews=20), stock=[s for s in STOCK if s.stock == "few_left"])
    assert middle.status == "needs_owner" and 50 <= middle.fit < 70 and middle.reason in ("fit_middle",)
    assert _d(place("Grand Fashion Mall", "Shopping mall saree section", reviews=9800)).reason == "very_large"
    assert _d(place("Krishna Handloom Weavers", "Saree wholesale")).reason == "competitor"
    few = [StockLine("Soft Silk Daily", "soft silk", None, "piece", None, "few_left")]
    low_stock = _d(place(), stock=few, settings=Settings(fit_bar=60))
    assert low_stock.status == "needs_owner" and low_stock.reason == "low_stock"
    none_match = _d(place(), stock=[StockLine("Cotton Towel", "towel", None, "piece", None, "in_stock")], settings=Settings(fit_bar=55))
    assert none_match.reason == "no_stock_match"


def test_the_first_ten_calls_of_every_new_search_need_the_owner() -> None:
    assert TEXTILES is not None
    places = [place(f"Silk House {i}", "Saree shop") for i in range(15)]
    fresh = decide.decide_all(places, TEXTILES, STOCK, Settings(), sit(approved_in_search=0))
    assert all(d.status == "needs_owner" and d.reason == "first_calls" for d in fresh), "no call goes out of a new search before the Owner said yes to ten"
    nine = decide.decide_all(places, TEXTILES, STOCK, Settings(), sit(approved_in_search=9))
    assert all(d.reason == "first_calls" for d in nine)
    ten = decide.decide_all(places, TEXTILES, STOCK, Settings(), sit(approved_in_search=10))
    assert all(d.status == "call_ready" for d in ten)
    one_approved = _d(place(), situation=sit(approved_in_search=0), owner_approved=True)
    assert one_approved.status == "call_ready" and one_approved.reason == "owner_approved"


def test_hours_and_the_daily_cap_make_it_wait_never_call() -> None:
    assert _d(place(), situation=sit(now=NIGHT, approved_in_search=10)).status == "researching"
    assert _d(place(), situation=sit(now=NIGHT, approved_in_search=10)).reason == "outside_hours"
    assert _d(place(), settings=Settings(call_from_hour=9, call_to_hour=21), situation=sit(now=datetime(2026, 11, 4, 3, 0, tzinfo=UTC), approved_in_search=10)).reason == "outside_hours", "08:30 IST is before 09:00"
    capped = _d(place(), settings=Settings(daily_call_cap=5), situation=sit(calls_today=3, ready_waiting=2, approved_in_search=10))
    assert capped.status == "researching" and capped.reason == "daily_cap"
    assert TEXTILES is not None
    many = decide.decide_all([place(f"Shop {i}") for i in range(6)], TEXTILES, STOCK, Settings(daily_call_cap=4), sit(approved_in_search=10))
    assert [d.status for d in many].count("call_ready") == 4, "each call-ready one counts against the cap for the next"


def test_the_score_is_bounded_and_explained_without_personal_data() -> None:
    d = _d(place(reviews=5000, rating=5.0))
    assert 0 <= d.fit <= 100 and len(d.fit_reason) <= 300 and "+00" not in d.fit_reason


def test_construction_materials_decides_with_its_own_buyers() -> None:
    assert MATERIALS is not None
    stock = stock_lines(MATERIAL_STOCK)
    d = decide.decide(place("Sri Sai Constructions", "Building contractor"), MATERIALS, stock, Settings(), sit(approved_in_search=10))
    assert d.status == "call_ready" and d.buyer_type == "contractor" and "OPC 53 Cement" in d.stock.matched
    assert decide.decide(place("Anantha Cement Dealers", "Cement dealer"), MATERIALS, stock, Settings(), sit(approved_in_search=10)).reason == "competitor"


# ---------------------------------------------------------------------------------------------------------------------------------- the words of the request
@pytest.mark.parametrize("text, area", [
    ("Find new retailers in Jayanagar Bengaluru", "Jayanagar Bengaluru"),
    ("find saree shops in Jayanagar", "Jayanagar"),
    ("Jayanagar లో కొత్త retailers వెతుకు", "Jayanagar"),
    ("जयनगर में नए दुकानें ढूंढो", "जयनगर"),
    ("ಜಯನಗರ ನಲ್ಲಿ ಹೊಸ ಅಂಗಡಿಗಳು ಹುಡುಕು", "ಜಯನಗರ"),
])
def test_the_request_is_understood_in_four_languages(text: str, area: str) -> None:
    assert TEXTILES is not None
    plan = intent.parse(text, TEXTILES)
    assert plan is not None and plan.area == area and plan.query


def test_other_questions_are_not_searches() -> None:
    assert TEXTILES is not None
    for text in ("what is the price of the kanchi saree?", "how many orders today", "find the invoice of Ravi"):
        assert intent.parse(text, TEXTILES) is None, text


# ---------------------------------------------------------------------------------------------------------------------------------- the API, end to end on a demo workspace (A2)
def _client(repo: FakeLeadFinderRepo, mode: str = "fixture", places: Any = None) -> Any:
    service = LeadFinderService(repo, mode=mode, places_key="test-key-not-real" if places else None, places_factory=(lambda k, c: places) if places else None, clock=lambda: NOW)
    c, _ = make_client(lead_finder=service)
    return c


def test_after_ten_yeses_the_rest_of_the_search_is_released_to_call_ready_and_new_stock_is_seen() -> None:
    """Day 2 (4 Nov 2026): the demo check found the rest of a search stayed on "Needs you" after the Owner's tenth yes, and a shop that waited on "nothing in our stock matches" never saw stock added later."""
    repo = FakeLeadFinderRepo("textiles", stock=[])
    c = _client(repo)
    plan = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    c.post(f"{URL}/lead-finder/searches/{plan['id']}/approve", headers=auth("a_owner"))
    waiting = [r for r in repo.rows.values() if r["status"] == "needs_owner"]
    assert waiting and {r["decision_reason"] for r in waiting} <= {"no_stock_match", "competitor", "very_large", "fit_middle"}, "no stock: nothing can be called"
    repo._stock = list(TEXTILE_STOCK)   # the owner adds sarees to the catalogue
    assert c.post(f"{URL}/prospects/redecide", headers=auth("a_owner")).json()["changed"] > 0
    first = [r for r in repo.rows.values() if r["decision_reason"] == "first_calls"]
    assert len(first) > 10, "with stock, they are would-be calls: the first ten of the search wait for the Owner"
    asked_later = first.pop()
    c.post(f"{URL}/prospects/actions", json={"ids": [asked_later["id"]], "action": "later"}, headers=auth("a_owner"))
    yes = sorted(first, key=lambda r: -r["fit_score"])[:10]
    out = c.post(f"{URL}/prospects/actions", json={"ids": [r["id"] for r in yes], "action": "call"}, headers=auth("a_owner")).json()
    assert all(x["ok"] and x["status"] == "call_ready" for x in out["results"])
    rest = [r for r in first if r not in yes]
    assert rest and all(r["status"] == "needs_owner" for r in rest)
    assert c.post(f"{URL}/prospects/redecide", headers=auth("a_owner")).json()["changed"] == len(rest)
    assert all(r["status"] == "call_ready" and r["decision_reason"] == "fit_high" for r in rest), "after ten yeses, the rest of the search is released"
    assert repo.rows[asked_later["id"]]["status"] == "needs_owner" and repo.rows[asked_later["id"]]["decision_reason"] == "asked_later", "the Owner's own 'later' stays"
    assert all(r["decision_reason"] in ("competitor", "very_large") for r in repo.rows.values() if r["status"] == "needs_owner" and r["id"] != asked_later["id"])


def test_a_demo_workspace_plans_approves_and_gets_a_result_card_without_google() -> None:
    reached: list[int] = []

    class Tripwire:
        provider = "places"

        def sku(self) -> str:
            return PLACES_SKU

        def estimate_paise(self, request: SearchRequest) -> int:
            reached.append(1)
            return 300

        def search(self, request: SearchRequest) -> Any:
            reached.append(1)
            raise AssertionError("a demo workspace reached Google")

    repo = FakeLeadFinderRepo("textiles", real_data_open=False)
    c = _client(repo, mode="places", places=Tripwire())
    assert c.get(f"{URL}/lead-finder/availability", headers=auth("a_sales")).json() == {"available": True, "source": "fixture", "reason": "ok"}
    plan = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar Bengaluru"}, headers=auth("a_sales"))
    assert plan.status_code == 201, plan.text
    card = plan.json()
    assert card["state"] == "planned" and card["provider"] == "fixture" and card["sku"] == "fixture" and card["est_cost_paise"] == 0 and card["max_results"] == 20
    assert card["searches_left_today"] == 5 and card["attribution"] is None and card["source_label"].startswith("Example search (made-up businesses) 'saree shops Jayanagar Bengaluru', 4 Nov")
    assert c.post(f"{URL}/lead-finder/searches/{card['id']}/approve", headers=auth("a_sales")).status_code == 403, "Sales plan; the Owner or an Admin says OK"
    done = c.post(f"{URL}/lead-finder/searches/{card['id']}/approve", headers=auth("a_owner"))
    assert done.status_code == 200, done.text
    result = done.json()
    counts = result["counts"]
    assert result["state"] == "done" and result["found"] == counts["new"] and counts["found"] == 20 and result["cost_paise"] == 0
    assert counts.get("needs_owner", 0) >= 10 and counts.get("call_ready", 0) == 0, "the first ten calls of a new search wait for the Owner"
    assert counts.get("skipped", 0) >= 3, "the sweet shop, the phone repair shop and the shop with no number are skipped"
    assert not reached, "nothing reached Google"
    listed = c.get(f"{URL}/prospects", headers=auth("a_sales")).json()["items"]
    assert len(listed) == result["found"] and all(p["source"] == "fixture" and p["source_label"] == card["source_label"] for p in listed)
    assert listed == sorted(listed, key=lambda p: -(p["fit_score"] or -1))
    # a second, identical search stores nothing twice
    again = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar Bengaluru"}, headers=auth("a_owner")).json()
    second = c.post(f"{URL}/lead-finder/searches/{again['id']}/approve", headers=auth("a_owner")).json()
    assert second["found"] == 0 and second["counts"]["duplicate_prospect"] == 20


def test_owner_test_with_the_gate_open_and_a_key_uses_places_and_shows_the_attribution() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=json.loads(RECORDED.read_text()))

    repo = FakeLeadFinderRepo("textiles", real_data_open=True)
    c = _client(repo, mode="places", places=_places(handler))
    card = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar Bengaluru"}, headers=auth("a_owner")).json()
    assert card["provider"] == "places" and card["sku"] == PLACES_SKU and card["est_cost_paise"] == 300 and card["cost_is_estimate"] and card["attribution"] == "Google Maps"
    assert card["source_label"].startswith("Google Maps search 'saree shops Jayanagar Bengaluru'")
    done = c.post(f"{URL}/lead-finder/searches/{card['id']}/approve", headers=auth("a_owner")).json()
    assert done["cost_paise"] == 300 and done["found"] == 3
    items = c.get(f"{URL}/prospects", headers=auth("a_owner")).json()["items"]
    assert all(p["attribution"] == "Google Maps" and p["source"] == "google_maps" for p in items)


def test_the_cap_of_searches_a_day_is_a_429() -> None:
    repo = FakeLeadFinderRepo("textiles")
    repo.settings["searches_per_day"] = 1
    c = _client(repo)
    for i, want in ((0, 200), (1, 429)):
        card = c.post(f"{URL}/lead-finder/plan", json={"query": "saree shops", "area": f"Area {i}"}, headers=auth("a_owner")).json()
        r = c.post(f"{URL}/lead-finder/searches/{card['id']}/approve", headers=auth("a_owner"))
        assert r.status_code == want, r.text
    assert r.json()["error"]["code"] == "search_cap_reached"


def test_bulk_actions_and_suppression_for_good() -> None:
    repo = FakeLeadFinderRepo("textiles")
    c = _client(repo)
    card = c.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    c.post(f"{URL}/lead-finder/searches/{card['id']}/approve", headers=auth("a_owner"))
    waiting = c.get(f"{URL}/prospects?status=needs_owner", headers=auth("a_owner")).json()["items"]
    ids = [p["id"] for p in waiting[:3]]
    r = c.post(f"{URL}/prospects/actions", json={"ids": ids[:2], "action": "call"}, headers=auth("a_owner")).json()
    assert [x["status"] for x in r["results"]] == ["call_ready", "call_ready"]
    stop = c.post(f"{URL}/prospects/actions", json={"ids": [ids[2]], "action": "do_not_call"}, headers=auth("a_sales")).json()["results"][0]
    assert stop["status"] == "not_interested"
    again = c.post(f"{URL}/prospects/actions", json={"ids": [ids[2]], "action": "call"}, headers=auth("a_owner")).json()["results"][0]
    assert again == {"id": ids[2], "ok": False, "status": None, "error": "prospect_state"}
    assert c.post(f"{URL}/prospects/actions", json={"ids": ids, "action": "call"}, headers=auth("a_viewer")).status_code == 403
    assert c.post(f"{URL}/prospects/actions", json={"ids": ids, "action": "phone_them"}, headers=auth("a_owner")).status_code == 422


def test_settings_screen() -> None:
    c = _client(FakeLeadFinderRepo("textiles"))
    assert c.get(f"{URL}/lead-finder/settings", headers=auth("a_sales")).json()["fit_bar"] == 70
    assert c.put(f"{URL}/lead-finder/settings", json={"fit_bar": 80}, headers=auth("a_sales")).status_code == 403
    assert c.put(f"{URL}/lead-finder/settings", json={"fit_bar": 80, "daily_call_cap": 10, "call_from_hour": 10, "call_to_hour": 18}, headers=auth("a_owner")).json()["fit_bar"] == 80
    assert c.put(f"{URL}/lead-finder/settings", json={"call_to_hour": 22}, headers=auth("a_owner")).status_code == 422, "never after 21:00"
    assert c.put(f"{URL}/lead-finder/settings", json={"call_from_hour": 15, "call_to_hour": 12}, headers=auth("a_owner")).status_code == 422


# ---------------------------------------------------------------------------------------------------------------------------------- A5: a school
def test_a_school_has_no_lead_finder_anywhere() -> None:
    c = _client(FakeLeadFinderRepo("education", module_on=False))
    assert c.get(f"{URL}/lead-finder/availability", headers=auth("a_owner")).json() == {"available": False, "source": None, "reason": "not_for_this_business"}, "hidden"
    for method, path, body in (("post", "/lead-finder/plan", {"text": "find new schools in Anantapur"}), ("get", "/lead-finder/settings", None), ("get", "/prospects", None),
                               ("post", "/prospects/actions", {"ids": [str(uuid.uuid4())], "action": "call"})):
        r = getattr(c, method)(f"{URL}{path}", headers=auth("a_owner"), **({"json": body} if body else {}))
        assert r.status_code == 403 and r.json()["error"]["code"] == "lead_finder_not_available", path
    # even with the module flag on by mistake, a pack without Lead Finder data is refused
    c2 = _client(FakeLeadFinderRepo("education", module_on=True))
    assert c2.post(f"{URL}/lead-finder/plan", json={"text": "find new retailers in Anantapur"}, headers=auth("a_owner")).status_code == 403


def test_the_flag_off_switches_it_off() -> None:
    r = _client(FakeLeadFinderRepo("textiles"), mode="off").post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "lead_finder_off"


def test_not_a_search_is_a_clear_422() -> None:
    r = _client(FakeLeadFinderRepo("textiles")).post(f"{URL}/lead-finder/plan", json={"text": "what is the price of silk"}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "not_a_search"


# ---------------------------------------------------------------------------------------------------------------------------------- A6: no code path can place a real call
PACKAGE = Path(__file__).resolve().parents[1] / "app" / "lead_finder"
FORBIDDEN_MODULES = ("app.telephony", "app.tasks.dialer", "app.outreach", "app.voice", "app.browser_voice", "app.whatsapp", "app.outbox")


def test_the_lead_finder_imports_no_dialer_no_telephony_and_no_sender() -> None:
    for path in PACKAGE.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
            for name in names:
                assert not name.startswith(FORBIDDEN_MODULES), f"{path.name} imports {name}"
        text = path.read_text(encoding="utf-8")
        for word in ("place_call", "make_call", "Dialer", "exotel", "Exotel"):
            assert word not in text.replace("no dialer", ""), f"{path.name} mentions {word}"


def test_the_only_call_route_is_the_simulator() -> None:
    from app.lead_finder.routes import router

    paths = {getattr(r, "path", "") for r in router.routes}
    call_paths = {p for p in paths if "call" in p}
    assert call_paths == {"/v1/tenants/{tenant_id}/prospects/{prospect_id}/simulated-call"}
