"""`make seed-demo-catalogue` (job AY): twelve invented sarees with GENERATED placeholder pictures in the demo workspace. It refuses a non-local stack before any network call, holds no secret, makes no file
and reads no photo from anywhere (the pictures are drawn in memory), is idempotent, and what it makes shows in the catalogue with working signed URLs (real stack, real Storage). Nothing is sent."""

# ruff: noqa: E501

from __future__ import annotations

import importlib.util
import io
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Stack
from fastapi.testclient import TestClient
from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
SCRIPT = SCRIPTS / "seed_demo_catalogue.py"
sys.path.insert(0, str(SCRIPTS))
import seed_demo_manual as manual  # noqa: E402
from seed_demo import Config  # noqa: E402

spec = importlib.util.spec_from_file_location("seed_demo_catalogue", SCRIPT)
assert spec and spec.loader
seed: Any = importlib.util.module_from_spec(spec)
sys.modules["seed_demo_catalogue"] = seed
spec.loader.exec_module(seed)

NOT_A_NETWORK = httpx.Client(transport=httpx.MockTransport(lambda r: pytest.fail("the seed made a network call")))


def config(stack: Stack, **over: str) -> Any:
    values = {"supabase_url": stack.url, "anon_key": stack.anon_key, "api_url": "http://localhost:8000"}
    return Config(**{**values, **over})


@pytest.fixture(scope="module")
def demo(stack: Stack, client: TestClient) -> Any:
    http = httpx.Client()
    manual.run(config(stack), api=client, http=http)
    first = seed.run(config(stack), api=client, http=http)
    second = seed.run(config(stack), api=client, http=http)
    return first, second, client


@pytest.mark.parametrize("over", [{"supabase_url": "https://abcdefgh.supabase.co"}, {"api_url": "https://api.example.com"}])
def test_it_refuses_anything_but_a_local_stack_before_any_network_call(stack: Stack, over: dict[str, str]) -> None:
    with pytest.raises(seed.SeedError, match="Refusing to run"):
        seed.run(config(stack, **over), api=NOT_A_NETWORK, http=NOT_A_NETWORK)


def test_the_script_holds_no_secret_reads_no_file_and_is_not_used_by_the_application() -> None:
    text = SCRIPT.read_text()
    assert not re.search(r"SERVICE_ROLE|SUPABASE_SERVICE|service_role|JWT_SECRET|supabase\.co", text)
    assert not re.search(r"open\(|Path\(|read_bytes|read_text|\.jpg|\.jpeg|requests\.", text.split("def main")[0].replace("Path(__file__)", "")), "the pictures are drawn in memory: nothing is read from anywhere"
    for path in (Path(__file__).resolve().parents[2] / "services" / "ai-api" / "app").rglob("*.py"):
        assert "seed_demo_catalogue" not in path.read_text(), path


def test_the_placeholders_are_plain_generated_pictures() -> None:
    for variant in range(3):
        data = seed.placeholder(["maroon", "gold"], variant, "K1")
        image = Image.open(io.BytesIO(data))
        assert image.format == "PNG" and image.size == (640, 800)
        assert dict(image.getexif()) == {}


def test_it_makes_twelve_active_items_with_photos_and_a_second_run_changes_nothing(demo: Any) -> None:
    first, second, client = demo
    assert first.tenant_id == second.tenant_id
    assert len(first.lines) == 12 and first.lines == second.lines
    from test_demo_seed_manual import owner

    headers = {"Authorization": f"Bearer {owner(Stack(url=first.c.supabase_url, anon_key=first.c.anon_key)).token}"}
    listing = client.get(f"/v1/tenants/{first.tenant_id}/catalogue/items?limit=50", headers=headers).json()["items"]
    demo_items = [i for i in listing if i["name"].startswith("DEMO ")]
    assert len(demo_items) == 12 and all(i["active"] and i["photo_count"] >= 1 for i in demo_items)
    assert sum(i["photo_count"] for i in demo_items) == sum(it["photos"] for it in seed.ITEMS), "a second run added no photo"
    assert sorted(i["price_text"] for i in demo_items if i["price_text"]) == ["₹38,500.00", "₹7,800.00"]
    cover = demo_items[0]["cover"]
    assert httpx.get(cover["thumb_url"], timeout=20).status_code == 200


def test_the_demo_covers_every_fabric_family_stock_state_and_band() -> None:
    assert {it["fabric"] for it in seed.ITEMS} >= {"kanchi_pattu", "dharmavaram_silk", "soft_silk", "cotton_silk", "banarasi", "mysore_silk", "uppada", "georgette"}
    assert {it["stock"] for it in seed.ITEMS} == {"in_stock", "few_left", "made_to_order"}
    assert {it["band"] for it in seed.ITEMS} == {"under_5k", "5k_10k", "10k_25k", "25k_50k", "above_50k"}
    assert all(1 <= it["photos"] <= 8 for it in seed.ITEMS) and len(seed.ITEMS) == 12
