"""`make seed-demo-manual`: the local demo for the manual-price quote. It refuses a non-local stack before any network call, holds no
secret, is idempotent, and what it seeds is enough to make a manual quote from the seeded enquiry (real stack, real application)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import importlib.util
import re
import sys
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Stack, User, bearer
from fastapi.testclient import TestClient

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
SCRIPT = SCRIPTS / "seed_demo_manual.py"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("seed_demo_manual", SCRIPT)
assert spec and spec.loader
seed: Any = importlib.util.module_from_spec(spec)
sys.modules["seed_demo_manual"] = seed
spec.loader.exec_module(seed)

NOT_A_NETWORK = httpx.Client(
    transport=httpx.MockTransport(lambda r: pytest.fail("the seed made a network call"))
)


def config(stack: Stack, **over: str) -> Any:
    values = {"supabase_url": stack.url, "anon_key": stack.anon_key, "api_url": "http://localhost:8000"}
    return seed.Config(**{**values, **over})


@pytest.fixture(scope="module")
def demo(stack: Stack, client: TestClient) -> Any:
    http = httpx.Client()
    first, enquiry = seed.run(config(stack), api=client, http=http)
    second, enquiry_again = seed.run(config(stack), api=client, http=http)
    return first, second, enquiry, enquiry_again


def owner(stack: Stack) -> User:
    from conftest import challenge_verify

    r = httpx.post(
        f"{stack.url}/auth/v1/token?grant_type=password",
        headers={"apikey": stack.anon_key},
        json={"email": seed.DEMO_EMAIL, "password": "Demo-Only-Local-Password-1!"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    factors = httpx.get(
        f"{stack.url}/auth/v1/user",
        headers={"apikey": stack.anon_key, "Authorization": f"Bearer {body['access_token']}"},
        timeout=15,
    ).json()["factors"]
    factor_id = next(f["id"] for f in factors if f["status"] == "verified")
    from seed_demo import local_factor_secret

    done = challenge_verify(stack, body["access_token"], factor_id, local_factor_secret(body["user"]["id"]))
    assert done.status_code == 200
    return User(label="demo", id=uuid.UUID(body["user"]["id"]), token=done.json()["access_token"])


# ==== safety (no stack needed beyond the fixture's urls) ====
@pytest.mark.parametrize(
    "over",
    [
        {"supabase_url": "https://abcdefgh.supabase.co"},
        {"supabase_url": "http://127.0.0.1.evil.example:54321"},
        {"supabase_url": "http://localhost.evil.example"},
        {"supabase_url": "http://10.0.0.5:54321"},
        {"api_url": "https://api.example.com"},
        {"api_url": "http://0.0.0.0:8000"},
    ],
)
def test_it_refuses_anything_but_a_local_stack_before_any_network_call(stack: Stack, over: dict[str, str]) -> None:
    with pytest.raises(seed.SeedError, match="Refusing to run"):
        seed.run(config(stack, **over), api=NOT_A_NETWORK, http=NOT_A_NETWORK)


def test_the_script_holds_no_secret_and_is_not_used_by_the_application() -> None:
    text = SCRIPT.read_text()
    assert not re.search(r"SERVICE_ROLE|SUPABASE_SERVICE|service_role|JWT_SECRET|supabase\.co", text)
    assert "DEMO VALUE ONLY" in text, "the GST rate is commented as a demo value, never a default"
    root = SCRIPT.parents[1]
    for folder in ("services/ai-api/app", "apps/web/app", "apps/web/lib", "supabase/migrations"):
        for path in (root / folder).rglob("*"):
            if path.is_file() and path.suffix in {".py", ".ts", ".tsx", ".sql"}:
                assert "seed_demo_manual" not in path.read_text(errors="ignore"), path


def test_everything_it_makes_is_invented() -> None:
    assert seed.WORKSPACE_NAME.startswith("DEMO ")
    for code, name, *_ in seed.ITEM_TYPES:
        assert name.startswith("DEMO ") and code.startswith("DEMO-")
    assert 10 <= len(seed.ITEM_TYPES) <= 14
    assert not re.search(r"@|\+?\d{8,}|https?://", seed.ENQUIRY_TEXT + seed.ENQUIRY_SUBJECT)
    for _, _, _, low, high in seed.ITEM_TYPES:
        assert low is None or high is None or low <= high


# ==== the seeded workspace, on the real stack ====
def test_a_second_run_changes_nothing(demo: Any) -> None:
    first, second, enquiry, again = demo
    assert first.tenant_id == second.tenant_id and enquiry == again


def test_the_workspace_has_the_item_types_in_position_order_with_their_ranges(demo: Any, stack: Stack, client: TestClient) -> None:
    first, *_ = demo
    r = client.get(f"/v1/tenants/{first.tenant_id}/item-types", headers=bearer(owner(stack)))
    assert r.status_code == 200
    got = r.json()
    assert [t["code"] for t in got] == [c for c, *_ in seed.ITEM_TYPES]
    assert {t["code"]: (t["min_price_paise"], t["max_price_paise"]) for t in got} == {
        c: (lo, hi) for c, _, _, lo, hi in seed.ITEM_TYPES
    }
    assert all(t["active"] for t in got)


def test_the_policy_in_force_carries_the_typed_gst_rate(demo: Any, stack: Stack, client: TestClient) -> None:
    first, *_ = demo
    r = client.get(f"/v1/tenants/{first.tenant_id}/quote-policy-versions", headers=bearer(owner(stack)))
    assert r.status_code == 200
    versions = r.json()
    assert len(versions) == 1 and versions[0]["in_force"] is True
    assert versions[0]["gst_rate_bps"] == seed.GST_RATE_BPS


def test_a_manual_quote_can_be_made_from_the_seeded_enquiry(demo: Any, stack: Stack, client: TestClient) -> None:
    first, _, enquiry, _ = demo
    user = owner(stack)
    # the quote screens' own check: is a manual quote possible here
    body = {
        "id": str(uuid.uuid4()),
        "customer_kind": "new",
        "lines": [
            {"item_type_code": "DEMO-01", "qty": 40, "unit_price_paise": 100_000},
            {"item_type_code": "DEMO-04", "qty": 20, "unit_price_paise": 10},  # far under the range: saved and flagged, never refused
        ],
    }
    r = client.post(f"/v1/tenants/{first.tenant_id}/enquiries/{enquiry}/manual-quotes", json=body, headers=bearer(user))
    assert r.status_code == 201, r.text
    quote = r.json()
    assert quote["pricing_kind"] == "manual"
    assert quote["review_flags"] == ["TYPED_PRICE_OUTSIDE_RANGE"]
