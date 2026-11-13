"""Google Places ROUTE 1 (owner decision 12 Nov 2026; docs/plans/lead-finder-places-storage.md): from Google only the place ID and the coordinates are kept (the coordinates 30 days), and OUR decision. The
name, phone, address, website, rating and reviews are fetched fresh by place ID, for one answer, and dropped. The database side is pgTAP 191; here: what the API hands the database, what it shows, and the mock."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.lead_finder.service import LeadFinderService
from app.lead_finder.sources import (
    GooglePlaceDetails,
    MockPlaceDetails,
    MockPlacesSource,
    SearchRequest,
    SourceError,
)
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, FakeLeadFinderRepo

URL = f"/v1/tenants/{TENANT_A.id}"
GOOGLE_ONLY = {"place_id", "lat", "lng", "status", "decision_reason", "fit_score", "fit_reason", "stock_match"}


def world(*, gate: bool = True, mode: str = "places", mock: bool = True, key: str | None = None, details: Any = None) -> tuple[Any, FakeLeadFinderRepo]:
    repo = FakeLeadFinderRepo("textiles", real_data_open=gate)
    service = LeadFinderService(repo, mode=mode, places_key=key, places_mock=mock, details_factory=(lambda k: details) if details else None, clock=lambda: NOW)
    client, _ = make_client(lead_finder=service)
    return client, repo


def search(client: Any) -> dict[str, Any]:
    plan = client.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    return dict(client.post(f"{URL}/lead-finder/searches/{plan['id']}/approve", headers=auth("a_owner")).json())


def test_a_places_search_hands_the_database_only_the_place_id_the_coordinates_and_our_decision() -> None:
    client, repo = world()
    handed: list[dict[str, Any]] = []
    original = repo.search_finish

    def spy(*args: Any, **kwargs: Any) -> dict[str, Any]:
        handed.extend(args[3])
        return original(*args, **kwargs)

    repo.search_finish = spy  # type: ignore[method-assign]
    done = search(client)
    assert done["provider"] == "places" and done["state"] == "done" and handed, done
    assert all(set(item) == GOOGLE_ONLY for item in handed), "nothing but the allowed keys"
    assert all(item["place_id"].startswith("pm:") for item in handed)
    stored = list(repo.rows.values())
    assert stored and all(r["source"] == "google_maps" and all(r[k] is None for k in ("name", "name_key", "category", "area", "phone", "phone_key", "website", "rating", "review_count")) for r in stored)
    assert all(r["lat"] is not None and r["fit_score"] is not None for r in stored)


def test_the_list_shows_fresh_details_and_nothing_of_them_is_stored() -> None:
    client, repo = world()
    search(client)
    page = client.get(f"{URL}/prospects?limit=50", headers=auth("a_owner")).json()
    assert page["items"] and all(p["details_available"] is True and p["name"] and p["attribution"] == "Google Maps" for p in page["items"])
    assert any(p["phone"] and p["phone"].startswith("+00 ") for p in page["items"]), "the mock's numbers are in the reserved range"
    assert all(r["name"] is None and r["phone"] is None for r in repo.rows.values()), "the answer carried them; the rows did not"
    one = client.get(f"{URL}/prospects/{page['items'][0]['id']}", headers=auth("a_owner")).json()
    assert one["name"] == page["items"][0]["name"] and one["details_available"] is True


def test_when_google_cannot_answer_the_screen_says_the_details_are_unavailable() -> None:
    class Down:
        def fetch(self, ids: list[str]) -> dict[str, Any]:
            raise SourceError("unreachable")

    client, repo = world(mock=False, key="test-key-not-real", details=Down())
    pid = "pm:x:0:aaaa"
    rid = "11111111-1111-4111-8111-111111111111"
    repo.rows[rid] = {"id": rid, "search_id": None, "source": "google_maps", "source_label": "Google Maps search", "place_id": pid, "lat": 12.9, "lng": 77.5, "status": "call_ready", "decision_reason": "fit_high", "fit_score": 80,
                       "fit_reason": "x", "stock_match": None, "owner_approved": False, "suppressed": False, "ask_after": None, "last_contacted_at": None, "lead_id": None, "qualification": None,
                       "created_at": NOW.isoformat(), "updated_at": NOW.isoformat(), "fetched_at": NOW.isoformat(), **{k: None for k in ("name", "name_key", "category", "area", "phone", "phone_key", "website", "rating", "review_count")}}
    item = client.get(f"{URL}/prospects", headers=auth("a_owner")).json()["items"][0]
    assert item["details_available"] is False and item["name"] is None and item["phone"] is None and item["fit_score"] == 80
    call = client.post(f"{URL}/prospects/{rid}/simulated-call", json={"persona": "interested"}, headers=auth("a_owner"))
    assert call.status_code == 409 and call.json()["error"]["code"] == "details_unavailable", call.text


def test_with_the_gate_closed_or_the_flag_off_nothing_reaches_a_places_source() -> None:
    client, _ = world(gate=False)
    assert search(client)["provider"] == "fixture", "a demo workspace is searched with the invented fixture, whatever the flag says"
    client, _ = world(mode="fixture")
    assert search(client)["provider"] == "fixture"


def test_google_place_details_asks_only_for_its_field_mask_and_reads_the_answer(caplog: pytest.LogCaptureFixture) -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("/ChIJ_gone"):
            return httpx.Response(404, json={})
        return httpx.Response(200, json={"id": "ChIJ_one", "displayName": {"text": "Sri Lakshmi Sarees"}, "nationalPhoneNumber": "098450 12345", "formattedAddress": "12, 4th Block, Jayanagar, Bengaluru, Karnataka 560011, India",
                                         "rating": 4.4, "userRatingCount": 210, "businessStatus": "OPERATIONAL", "location": {"latitude": 12.93, "longitude": 77.58}})

    source = GooglePlaceDetails("test-key-not-real", client=httpx.Client(transport=httpx.MockTransport(handler)))
    got = source.fetch(["ChIJ_one", "ChIJ_gone", "bad id with spaces"])
    assert set(got) == {"ChIJ_one"} and got["ChIJ_one"].name == "Sri Lakshmi Sarees" and got["ChIJ_one"].phone == "098450 12345"
    assert [r.url.path for r in seen] == ["/v1/places/ChIJ_one", "/v1/places/ChIJ_gone"], "one request per place; an invalid id is never sent"
    assert "reviews" not in seen[0].headers["X-Goog-FieldMask"] and "photos" not in seen[0].headers["X-Goog-FieldMask"]
    assert seen[0].headers["X-Goog-Api-Key"] == "test-key-not-real" and "test-key-not-real" not in repr(source) and "test-key-not-real" not in caplog.text


def test_the_mock_is_deterministic_stateless_and_in_the_reserved_number_range() -> None:
    from app.lead_finder import packdata

    data = packdata.for_pack("textiles")
    assert data is not None
    found = MockPlacesSource(data).search(SearchRequest(query="saree shops", area="Jayanagar", max_results=20)).places
    again = MockPlaceDetails().fetch([p.place_id for p in found])
    assert set(again) == {p.place_id for p in found}
    assert all(again[p.place_id] == p for p in found), "the details rebuilt from the id are the places that were found"
    assert all(p.phone is None or p.phone.startswith("+00 ") for p in found)
    assert MockPlaceDetails().fetch(["pm:textiles:99:aaaa", "pm:nothing:0:aa", "fx_abc", "pm:textiles:x:aa"]) == {}
