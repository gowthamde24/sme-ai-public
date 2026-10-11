"""make seed-demo-catalogue: TWELVE invented sarees (a catalogue) in the ONE demo workspace, on a LOCAL stack (job AY, ADR 0069). Everything is invented; every name starts with "DEMO".

What it makes (through OUR API, as the demo owner, exactly as the web will):
  * twelve catalogue items (fabric, colours, zari, border, occasions, a price band, stock status), all active, two of them with an exact price the Owner set;
  * one to three PLACEHOLDER photos each: simple pictures GENERATED here (a solid colour with a woven-looking pattern and the word DEMO). No real product photo, no camera, no file from anywhere. Each is uploaded
    the way a person's photo is (the API resizes it, makes a thumbnail and keeps no metadata) into the demo workspace's private bucket in the LOCAL Supabase Storage.
Idempotent (fixed ids: a second run changes nothing). Refuses a URL that is not this machine. Needs `make db-start` (Storage on), `make dev-api-local` and `make seed-demo-manual`. Not part of `make check`.
`make db-reset` wipes the demo (and the bucket's rows; the files stay in the local Storage volume until `supabase stop --no-backup`)."""

from __future__ import annotations

import io
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402
from seed_demo import DEMO_EMAIL, SeedError, demo_id, load_config, require_local  # noqa: E402
from seed_demo_manual import ManualDemoSeeder  # noqa: E402

PALETTE: dict[str, tuple[int, int, int]] = {
    "red": (190, 30, 45), "maroon": (110, 20, 40), "pink": (230, 120, 165), "orange": (235, 130, 30), "yellow": (240, 200, 40),
    "green": (30, 130, 70), "blue": (35, 90, 190), "navy": (20, 35, 95), "purple": (110, 50, 150), "black": (25, 25, 30),
    "white": (240, 240, 235), "cream": (240, 225, 190), "gold": (205, 160, 45), "silver": (185, 190, 195), "brown": (110, 70, 40),
    "grey": (130, 130, 135), "multi": (200, 90, 140),
}  # fmt: skip

ITEMS: list[dict[str, Any]] = [
    # key, name, fabric, colours, zari, border, occasions, band, stock, photos, exact price (paise) set by the Owner
    {"key": "k1", "name": "DEMO Maroon Kanchi pattu", "fabric": "kanchi_pattu", "colours": ["maroon", "gold"], "zari": "rich", "border": "Temple border in gold zari", "occasions": ["wedding", "festival"], "band": "25k_50k", "stock": "in_stock", "photos": 3, "price": 3_850_000},
    {"key": "k2", "name": "DEMO Peacock green Kanchi pattu", "fabric": "kanchi_pattu", "colours": ["green", "gold"], "zari": "rich", "border": "Peacock motif border", "occasions": ["wedding"], "band": "25k_50k", "stock": "few_left", "photos": 2, "price": None},
    {"key": "k3", "name": "DEMO Royal blue Dharmavaram silk", "fabric": "dharmavaram_silk", "colours": ["blue", "silver"], "zari": "light", "border": "Contrast border, silver zari", "occasions": ["festival", "party"], "band": "10k_25k", "stock": "in_stock", "photos": 2, "price": None},
    {"key": "k4", "name": "DEMO Pink Dharmavaram silk", "fabric": "dharmavaram_silk", "colours": ["pink"], "zari": "light", "border": "Small checks border", "occasions": ["festival"], "band": "10k_25k", "stock": "in_stock", "photos": 1, "price": None},
    {"key": "k5", "name": "DEMO Cream soft silk", "fabric": "soft_silk", "colours": ["cream", "gold"], "zari": "light", "border": "Thin gold line", "occasions": ["party", "daily"], "band": "5k_10k", "stock": "in_stock", "photos": 2, "price": 780_000},
    {"key": "k6", "name": "DEMO Orange soft silk", "fabric": "soft_silk", "colours": ["orange"], "zari": "none", "border": None, "occasions": ["festival", "daily"], "band": "5k_10k", "stock": "made_to_order", "photos": 1, "price": None},
    {"key": "k7", "name": "DEMO Yellow cotton silk", "fabric": "cotton_silk", "colours": ["yellow", "red"], "zari": "none", "border": "Woven red border", "occasions": ["daily", "festival"], "band": "under_5k", "stock": "in_stock", "photos": 1, "price": None},
    {"key": "k8", "name": "DEMO Navy cotton silk", "fabric": "cotton_silk", "colours": ["navy"], "zari": "light", "border": "Plain border", "occasions": ["daily"], "band": "under_5k", "stock": "few_left", "photos": 1, "price": None},
    {"key": "k9", "name": "DEMO Purple Banarasi", "fabric": "banarasi", "colours": ["purple", "gold"], "zari": "rich", "border": "Brocade border", "occasions": ["wedding", "party"], "band": "above_50k", "stock": "made_to_order", "photos": 3, "price": None},
    {"key": "k10", "name": "DEMO Red Mysore silk", "fabric": "mysore_silk", "colours": ["red"], "zari": "light", "border": "Gold stripe", "occasions": ["wedding", "festival"], "band": "10k_25k", "stock": "in_stock", "photos": 2, "price": None},
    {"key": "k11", "name": "DEMO White Uppada", "fabric": "uppada", "colours": ["white", "multi"], "zari": "light", "border": "Colourful pallu", "occasions": ["party", "festival"], "band": "10k_25k", "stock": "in_stock", "photos": 1, "price": None},
    {"key": "k12", "name": "DEMO Black georgette", "fabric": "georgette", "colours": ["black", "silver"], "zari": "none", "border": None, "occasions": ["party"], "band": "5k_10k", "stock": "few_left", "photos": 1, "price": None},
]  # fmt: skip


def placeholder(colours: list[str], variant: int, label: str) -> bytes:
    """A simple picture: the item's main colour, a woven-looking pattern in its second colour (or a lighter shade), and the word DEMO. Pure geometry, generated here; nothing is read from anywhere."""
    base = PALETTE[colours[0]]
    accent = PALETTE[colours[1]] if len(colours) > 1 else tuple(min(255, c + 70) for c in base)
    width, height = 640, 800
    image = Image.new("RGB", (width, height), base)
    draw = ImageDraw.Draw(image)
    step = 40 + 16 * (variant % 3)
    if variant % 3 == 0:  # diamonds
        for y in range(0, height + step, step):
            for x in range(0, width + step, step):
                cx, cy = x + (step // 2 if (y // step) % 2 else 0), y
                draw.polygon(
                    [
                        (cx, cy - step // 3),
                        (cx + step // 3, cy),
                        (cx, cy + step // 3),
                        (cx - step // 3, cy),
                    ],
                    outline=accent,
                )
    elif variant % 3 == 1:  # diagonal stripes
        for k in range(-height, width, step):
            draw.line([(k, 0), (k + height, height)], fill=accent, width=3)
    else:  # dots
        for y in range(step // 2, height, step):
            for x in range(step // 2, width, step):
                draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=accent)
    border = 70
    draw.rectangle([0, 0, width, border], fill=accent)
    draw.rectangle([0, height - border, width, height], fill=accent)
    draw.text((width // 2 - 60, height // 2 - 10), f"DEMO  {label}", fill=(255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class CatalogueDemoSeeder(ManualDemoSeeder):
    lines: list[str]

    def _upload(self, item_id: str, photo_id: str, data: bytes) -> dict[str, Any]:
        try:
            r = self.api.request(
                "POST",
                f"{self.c.api_url}/v1/tenants/{self.tenant_id}/catalogue/items/{item_id}/photos?photo_id={photo_id}",
                content=data,
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "image/png"},
                timeout=60,
            )
        except httpx.HTTPError:
            raise SeedError(
                "The API is not reachable. Start it with `make dev-api-local`, then run this again."
            ) from None
        if r.status_code != 200:
            raise SeedError(
                f"Could not upload a demo photo (HTTP {r.status_code}). Is Storage on (`make db-start` after the AY change) and the API recent?"
            )
        body: dict[str, Any] = r.json()
        return body

    def catalogue(self) -> None:
        self.lines = []
        base = f"/v1/tenants/{self.tenant_id}/catalogue/items"
        for it in ITEMS:
            item_id = demo_id(f"cat-{it['key']}")
            body: dict[str, Any] = {
                "name": it["name"], "fabric": it["fabric"], "colours": it["colours"], "zari": it["zari"], "border": it["border"],
                "occasions": it["occasions"], "price_band": it["band"], "stock_status": it["stock"], "active": False,
            }  # fmt: skip
            r = self._api("PUT", f"{base}/{item_id}", body)
            if r.status_code != 200:
                raise SeedError(f"Could not save the demo item {it['key']} (HTTP {r.status_code}).")
            for n in range(it["photos"]):
                self._upload(
                    item_id,
                    demo_id(f"cat-{it['key']}-photo-{n}"),
                    placeholder(it["colours"], n + int(it["key"][1:]), it["key"].upper()),
                )
            final = {**body, "active": True}
            if it["price"] is not None:
                final["price_paise"] = it["price"]
            r = self._api("PUT", f"{base}/{item_id}", final)
            if r.status_code != 200:
                raise SeedError(
                    f"Could not activate the demo item {it['key']} (HTTP {r.status_code})."
                )
            saved = r.json()["item"]
            self.lines.append(
                f"  {it['name']}: {saved['photo_count']} photo(s), {saved['price_band_label']}"
                + (f", {saved['price_text']}" if saved["price_text"] else "")
            )


def run(
    config: Any, *, api: httpx.Client | None = None, http: httpx.Client | None = None
) -> CatalogueDemoSeeder:
    require_local(config.supabase_url, "Supabase URL")
    require_local(config.api_url, "API URL")
    api_client = httpx.Client() if api is None else api
    http_client = httpx.Client() if http is None else http
    try:
        seeder = CatalogueDemoSeeder(config, api_client, http_client)
        seeder.sign_in()
        seeder.workspace()
        seeder.catalogue()
        return seeder
    finally:
        if api is None:
            api_client.close()
        if http is None:
            http_client.close()


def main() -> int:
    config = load_config()
    try:
        s = run(config)
    except SeedError as exc:
        print(f"seed-demo-catalogue: {exc}", file=sys.stderr)
        return 1
    print(
        "seed-demo-catalogue: done (twelve invented sarees with generated placeholder pictures; no real product photo)."
    )
    print("\n".join(s.lines))
    print(f"  catalogue:    GET {config.api_url}/v1/tenants/{s.tenant_id}/catalogue/items")
    print(f"  sign in as {DEMO_EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
