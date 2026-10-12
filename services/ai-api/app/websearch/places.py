"""Finding retailers with Google Places (job BP, ADR 0078). Official API (Places API (New), Text Search) only.

What Google's terms let us keep, and what this module therefore does (sources in the ADR): a place ID may be stored indefinitely; other Places content (names, addresses, links, ratings, phone numbers) may not
be stored beyond Google's short cache allowance, and must be shown with Google's attribution. So: a search returns names and addresses to be SHOWN NOW; nothing but the place ID is ever written to the
database; a lead is made only when the owner confirms it with details the OWNER types (see routes_places). The phone number and website are Enterprise-tier fields: never requested."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from app.agents.web import SearchError
from app.websearch import clean

logger = logging.getLogger("app.websearch.places")

# at most 90: the lead made from a confirmed place has source "places:<ID>" in a column of 100 characters, so a card whose ID could not be confirmed is never shown
PLACE_ID = re.compile(r"^[A-Za-z0-9_-]{10,90}$")
FIELD_MASK_PRO = "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.businessStatus"
FIELD_MASK_IDS = "places.id"


@dataclass(frozen=True)
class PlaceHit:
    place_id: str
    name: str = field(repr=False)
    address: str = field(repr=False)
    maps_uri: str | None = field(default=None, repr=False)
    open_status: str | None = None  # OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY


class PlacesSearch(Protocol):
    def search(self, text_query: str, *, limit: int = 5) -> list[PlaceHit]: ...


class GooglePlaces:
    """POST https://places.googleapis.com/v1/places:searchText with X-Goog-Api-Key and X-Goog-FieldMask (required). Region IN, language en."""

    def __init__(self, api_key: str, *, tier: str = "pro", client: httpx.Client | None = None, base_url: str = "https://places.googleapis.com") -> None:
        if tier not in ("pro", "ids"):
            raise ValueError("PLACES_FIELD_TIER must be 'pro' or 'ids'")
        self._key = api_key
        self._mask = FIELD_MASK_PRO if tier == "pro" else FIELD_MASK_IDS
        self._base = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))

    def __repr__(self) -> str:
        return "GooglePlaces(<key hidden>)"

    def search(self, text_query: str, *, limit: int = 5) -> list[PlaceHit]:
        try:
            response = self._client.post(
                f"{self._base}/v1/places:searchText",
                json={"textQuery": text_query, "languageCode": "en", "regionCode": "IN", "pageSize": max(1, min(limit, 20))},
                headers={"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": self._mask, "Content-Type": "application/json"},
            )
        except httpx.TimeoutException:
            raise SearchError("timeout") from None
        except httpx.HTTPError as exc:
            logger.warning("places unreachable: %s", exc.__class__.__name__)
            raise SearchError("unavailable") from None
        if response.status_code in (401, 403):
            raise SearchError("unauthorized")
        if response.status_code == 429:
            raise SearchError("rate_limited")
        if response.status_code >= 400:
            logger.warning("places refused: http=%s", response.status_code)
            raise SearchError("unavailable")
        try:
            body = response.json()
        except ValueError:
            raise SearchError("bad_response") from None
        rows = body.get("places", []) if isinstance(body, dict) else None
        if not isinstance(rows, list):
            raise SearchError("bad_response")
        hits: list[PlaceHit] = []
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("id"), str) or not PLACE_ID.match(row["id"]):
                continue
            name = row.get("displayName")
            maps = clean.url(row.get("googleMapsUri"))
            status = row.get("businessStatus")
            hits.append(
                PlaceHit(
                    row["id"],
                    clean.text(name.get("text") if isinstance(name, dict) else None, 200),
                    clean.text(row.get("formattedAddress"), 300),
                    maps,
                    status if status in ("OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY") else None,
                )
            )
        return hits[:limit]


class FixturePlaces:
    """No network: a fixed list of invented shops, filtered by whether the query shares a word with a name or an address."""

    def __init__(self, hits: list[PlaceHit] | None = None) -> None:
        self._hits = hits if hits is not None else [
            PlaceHit("ChIJFIXTURE000000001", "Sri Lakshmi Silk House", "12 Main Road, Kanchipuram, Tamil Nadu", "https://maps.google.com/?cid=1", "OPERATIONAL"),
            PlaceHit("ChIJFIXTURE000000002", "Balaji Sarees Wholesale", "4 Gandhi Bazaar, Guntur, Andhra Pradesh", "https://maps.google.com/?cid=2", "OPERATIONAL"),
            PlaceHit("ChIJFIXTURE000000003", "Closed Textiles", "9 Old Street, Chennai", "https://maps.google.com/?cid=3", "CLOSED_PERMANENTLY"),
        ]
        self.queries: list[str] = []

    def search(self, text_query: str, *, limit: int = 5) -> list[PlaceHit]:
        self.queries.append(text_query)
        words = {w.lower() for w in text_query.split() if len(w) > 2}
        found = [h for h in self._hits if words & {w.lower().strip(",.") for w in f"{h.name} {h.address}".split()}]
        return (found or self._hits)[:limit]
