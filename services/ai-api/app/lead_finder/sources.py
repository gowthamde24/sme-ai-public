"""Where prospects come from (ADR 0119): one interface, `ProspectSource`, and two implementations behind the flag LEAD_FINDER=off|fixture|places.

  FixtureSource       INVENTED businesses from the pack's lead_finder.json, the same shape as Google's, '+00' numbers (the reserved demo range). Demo workspaces and every test use it. Never reaches the network.
  GooglePlacesSource  Google Places API (New), Text Search, ONE request per search, a field mask that asks only for what the decision needs. Used ONLY where the real-data gate is open (the Owner Test
                      workspace) and only when a key exists; the database refuses its results anywhere else too.

Billing (Google's SKUs are chosen by the field mask): the mask below includes nationalPhoneNumber, websiteUri, rating and userRatingCount, so every request bills ONE "Text Search Enterprise" request
(places.id alone would be "Essentials ID Only", displayName/location/types "Pro"). The phone number is what makes calling possible, so Enterprise is the cheapest SKU that does the job.
The cost in paise is a configured ESTIMATE (LEAD_FINDER_PLACES_COST_PAISE), shown as an estimate. A response is never logged (it is third-party content); the key is never logged."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.lead_finder.packdata import PackLeadFinder

logger = logging.getLogger("app.lead_finder.sources")

TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.primaryTypeDisplayName", "places.types", "places.formattedAddress", "places.location", "places.businessStatus",
    "places.nationalPhoneNumber", "places.websiteUri", "places.rating", "places.userRatingCount",
])
PLACES_SKU = "places_text_search_enterprise"
FIXTURE_SKU = "fixture"
MAX_RESULTS = 20


@dataclass(frozen=True)
class Place:
    place_id: str
    name: str
    category: str | None
    area: str | None
    lat: float | None
    lng: float | None
    phone: str | None
    website: str | None
    rating: float | None
    review_count: int | None
    # the fixture's own label of what it invented (buyer, competitor ...); None for a real place
    fixture_kind: str | None = None


@dataclass(frozen=True)
class SearchRequest:
    query: str
    area: str | None
    max_results: int
    language: str = "en"


@dataclass(frozen=True)
class SourceResult:
    places: list[Place]
    sku: str
    requests: int
    cost_paise: int


class SourceError(Exception):
    """The source could not answer (network, quota, a bad key). The search is marked failed; nothing is retried automatically (a retry would bill again)."""


class ProspectSource(Protocol):
    provider: str

    def sku(self) -> str: ...
    def estimate_paise(self, request: SearchRequest) -> int: ...
    def search(self, request: SearchRequest) -> SourceResult: ...


# ------------------------------------------------------------------------------------------------------------------------------------- fixture
def _h(*parts: str) -> int:
    return int.from_bytes(hashlib.sha256("|".join(parts).encode("utf-8")).digest()[:8], "big")


class FixtureSource:
    """Synthetic prospects per business type. Deterministic for the same (query, area): a second identical search finds the same places (and the database stores none of them twice)."""

    provider = "fixture"

    def __init__(self, data: PackLeadFinder) -> None:
        self._data = data

    def sku(self) -> str:
        return FIXTURE_SKU

    def estimate_paise(self, request: SearchRequest) -> int:
        return 0

    def search(self, request: SearchRequest) -> SourceResult:
        area = (request.area or "Town Centre").strip()[:60]
        key = f"{request.query.strip().lower()}|{area.lower()}"
        templates = sorted(self._data.fixture, key=lambda t: _h(key, t.name))
        base_lat, base_lng = 12.9 + (_h(area, "lat") % 1000) / 10000, 77.5 + (_h(area, "lng") % 1000) / 10000
        places: list[Place] = []
        for t in templates[: min(request.max_results, MAX_RESULTS)]:
            name = t.name.replace("{area}", area)
            n = _h(key, name)
            phone = None if t.kind == "no_phone" else f"+00 000 5{n % 1000:03d} {(n // 1000) % 10000:04d}"
            places.append(Place(
                place_id=f"fx_{hashlib.sha256((self._data.pack_id + '|' + area.lower() + '|' + name.lower()).encode()).hexdigest()[:24]}",
                name=name, category=t.category, area=area, lat=round(base_lat + (n % 200) / 10000, 6), lng=round(base_lng + ((n // 200) % 200) / 10000, 6),
                phone=phone, website=None, rating=t.rating, review_count=t.reviews, fixture_kind=t.kind,
            ))
        return SourceResult(places=places, sku=FIXTURE_SKU, requests=0, cost_paise=0)


# ------------------------------------------------------------------------------------------------------------------------------------- Google Places
_PLACE_ID = re.compile(r"^[A-Za-z0-9_.:-]{3,200}$")


def _area_of(address: str | None) -> str | None:
    """The neighbourhood from a formatted address: the part before the city (", Bengaluru, Karnataka 560011, India" -> the first one or two parts)."""
    if not address:
        return None
    parts = [p.strip() for p in address.split(",") if p.strip()]
    return ", ".join(parts[-4:-2])[:160] if len(parts) >= 4 else (parts[0][:160] if parts else None)


def parse_places(body: Any, max_results: int) -> list[Place]:
    """Google's response -> places. Anything malformed is dropped, never guessed; a closed business is dropped."""
    out: list[Place] = []
    if not isinstance(body, dict):
        return out
    for p in body.get("places") or []:
        if not isinstance(p, dict):
            continue
        pid = p.get("id")
        name = (p.get("displayName") or {}).get("text") if isinstance(p.get("displayName"), dict) else None
        if not isinstance(pid, str) or not _PLACE_ID.match(pid) or not isinstance(name, str) or not name.strip():
            continue
        if p.get("businessStatus") not in (None, "OPERATIONAL"):
            continue
        loc: dict[str, Any] = p["location"] if isinstance(p.get("location"), dict) else {}
        cat = (p.get("primaryTypeDisplayName") or {}).get("text") if isinstance(p.get("primaryTypeDisplayName"), dict) else None
        if not cat and isinstance(p.get("types"), list) and p["types"]:
            cat = str(p["types"][0]).replace("_", " ")
        rating = p.get("rating")
        reviews = p.get("userRatingCount")
        out.append(Place(
            place_id=pid, name=name.strip()[:200], category=(cat or None) and str(cat)[:80], area=_area_of(p.get("formattedAddress")),
            lat=float(loc["latitude"]) if isinstance(loc.get("latitude"), (int, float)) else None, lng=float(loc["longitude"]) if isinstance(loc.get("longitude"), (int, float)) else None,
            phone=p.get("nationalPhoneNumber") if isinstance(p.get("nationalPhoneNumber"), str) else None, website=p.get("websiteUri") if isinstance(p.get("websiteUri"), str) else None,
            rating=float(rating) if isinstance(rating, (int, float)) and 0 <= rating <= 5 else None, review_count=int(reviews) if isinstance(reviews, int) and reviews >= 0 else None,
        ))
        if len(out) >= max_results:
            break
    return out


class GooglePlacesSource:
    """Text Search (New): POST places:searchText with X-Goog-Api-Key and X-Goog-FieldMask, pageSize <= 20, regionCode IN. ONE request per search (no next page: the cap is 20 results)."""

    provider = "places"

    def __init__(self, api_key: str, cost_paise_per_request: int, *, client: httpx.Client | None = None, timeout: float = 10.0) -> None:
        if not api_key:
            raise ValueError("no key")
        self._key = api_key
        self._cost = max(0, int(cost_paise_per_request))
        self._client = client or httpx.Client(timeout=httpx.Timeout(timeout, connect=5.0))

    def __repr__(self) -> str:  # the key never appears in a log line or a traceback
        return "GooglePlacesSource(key=<hidden>)"

    def sku(self) -> str:
        return PLACES_SKU

    def estimate_paise(self, request: SearchRequest) -> int:
        return self._cost

    def search(self, request: SearchRequest) -> SourceResult:
        text = request.query.strip() if not request.area else f"{request.query.strip()} in {request.area.strip()}"
        payload = {"textQuery": text[:250], "pageSize": max(1, min(request.max_results, MAX_RESULTS)), "regionCode": "IN", "languageCode": request.language if request.language in ("en", "hi", "te", "kn", "ta", "ml") else "en"}
        headers = {"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": FIELD_MASK, "Content-Type": "application/json"}
        try:
            response = self._client.post(TEXT_SEARCH_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("places search unreachable: %s", exc.__class__.__name__)
            raise SourceError("unreachable") from None
        if response.status_code != 200:
            logger.error("places search refused: status %s", response.status_code)
            raise SourceError(f"status {response.status_code}")
        try:
            body = response.json()
        except ValueError:
            raise SourceError("not json") from None
        return SourceResult(places=parse_places(body, request.max_results), sku=PLACES_SKU, requests=1, cost_paise=self._cost)
