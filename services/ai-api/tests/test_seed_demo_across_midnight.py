"""The demo seed across midnight in India (CI 4 Nov 2026: 8 integration tests failed with "Could not make the demo quote (HTTP 409)" when one seed made the demo quote at 23:56 IST and the next asked for
it again at 00:03 IST). A quote is dated with today in India, so its fixed id asked for again on another day is a conflict. The seed now finds the quote it made and leaves it: pinned at 23:30 and
00:30 IST. Against a fake API that keeps the database's rule; no network."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("seed_demo_manual_for_midnight", SCRIPTS / "seed_demo_manual.py")
assert spec is not None and spec.loader is not None
seed: Any = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)
IST = timezone(timedelta(hours=5, minutes=30))


class FakeQuotesApi:
    """POST /enquiries/{e}/manual-quotes dates the quote with today in India (as the API does); the same id again is a replay on the same day and a 409 conflict on another (as the database does)."""

    def __init__(self) -> None:
        self.now = datetime(2026, 11, 4, 18, 0, tzinfo=UTC)   # 23:30 IST
        self.quotes: dict[str, str] = {}
        self.posts = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET" and "/quotes/" in path:
            qid = path.rsplit("/", 1)[1]
            return httpx.Response(200, json={"id": qid, "as_of": self.quotes[qid]}) if qid in self.quotes else httpx.Response(404, json={"error": {"code": "not_found"}})
        if request.method == "POST" and path.endswith("/manual-quotes"):
            self.posts += 1
            body = json.loads(request.content)
            day = self.now.astimezone(IST).date().isoformat()
            if body["id"] in self.quotes and self.quotes[body["id"]] != day:
                return httpx.Response(409, json={"error": {"code": "conflict"}})
            self.quotes[body["id"]] = day
            return httpx.Response(201, json={"quote_id": body["id"]})
        return httpx.Response(404)


def seeder(api: FakeQuotesApi) -> Any:
    config = seed.Config(supabase_url="http://127.0.0.1:54421", anon_key="anon", api_url="http://localhost:8000")
    s = seed.ManualDemoSeeder(config, httpx.Client(transport=httpx.MockTransport(api)), httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500))))
    s.tenant_id = "00000000-0000-0000-0000-00000000000a"
    return s


def test_the_demo_quote_made_at_2330_ist_is_found_again_at_0030_ist_not_asked_for_again() -> None:
    api = FakeQuotesApi()
    first = seeder(api)
    first.waiting_quote("enquiry-1")
    assert api.posts == 1 and list(api.quotes.values()) == ["2026-11-04"]
    api.now = datetime(2026, 11, 4, 19, 0, tzinfo=UTC)   # 00:30 IST, the next day in India
    second = seeder(api)
    second.waiting_quote("enquiry-1")   # before the fix: SeedError "Could not make the demo quote (HTTP 409)"
    assert api.posts == 1 and second.summary.reused == 1, "the quote is found, not asked for again"


def test_the_fake_keeps_the_databases_rule() -> None:
    api = FakeQuotesApi()
    client = httpx.Client(transport=httpx.MockTransport(api))
    body = {"id": "q1", "customer_kind": "new", "lines": []}
    assert client.post("http://x/v1/tenants/t/enquiries/e/manual-quotes", json=body).status_code == 201
    assert client.post("http://x/v1/tenants/t/enquiries/e/manual-quotes", json=body).status_code == 201, "the same day: a replay"
    api.now += timedelta(hours=1)
    assert client.post("http://x/v1/tenants/t/enquiries/e/manual-quotes", json=body).status_code == 409, "the next day in India: a conflict"
