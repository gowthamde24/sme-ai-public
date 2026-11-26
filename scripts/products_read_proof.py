"""STAGING PROOF of the products reading (26 Nov 2026): two MADE-UP price-list pictures go through `POST /what-you-sell/products/read` of the local API (the real AI model, the staging database), as the synthetic demo textiles owner.

  python3 -I scripts/products_read_proof.py --i-know-this-is-staging [--api-url http://localhost:8000]

Picture 1 looks like a handwritten notebook page (a handwriting font on ruled paper, slightly turned, English names); picture 2 is a Telugu and Hindi list (Telugu and Devanagari fonts, Telugu numerals on one line). No real data, no
person, no real shop. It prints what the model copied against what was written and counts the matches (name and price). The pictures are dropped by the route after a good reading; this script also drops what is left."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

FONTS = {
    "hand": "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "telugu": "/System/Library/Fonts/KohinoorTelugu.ttc",
    "hindi": "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
}
NOTEBOOK = [("Kanchipuram silk red", 8500), ("Pochampally ikat blue", 1800), ("Mysore crepe green", 4800), ("Cotton saree plain", 650), ("Dupatta net", 250), ("Blouse piece", 300)]
INDIC = [("కంచి పట్టు చీర ఎరుపు", 9200), ("పోచంపల్లి ఇక్కత్ చీర", 2100), ("మైసూర్ క్రేప్ ఆకుపచ్చ", 5200), ("सूती साड़ी सफ़ेद", 700), ("दुपट्टा", 350)]
TELUGU_DIGITS = str.maketrans("0123456789", "౦౧౨౩౪౫౬౭౮౯")


def picture(rows: list[tuple[str, int]], fonts: list[str], *, ruled: bool, turn: float, telugu_digits_on: int | None = None) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (1100, 1500), (246, 240, 222) if ruled else (255, 255, 255))
    d = ImageDraw.Draw(img)
    if ruled:
        for y in range(120, 1450, 90):
            d.line([(40, y), (1060, y)], fill=(170, 190, 220), width=2)
        d.line([(110, 40), (110, 1460)], fill=(220, 120, 120), width=3)
    y = 60
    for i, (name, price) in enumerate(rows):
        font = ImageFont.truetype(fonts[i % len(fonts)], 52)
        digits = str(price).translate(TELUGU_DIGITS) if telugu_digits_on == i else str(price)
        d.text((130, y), f"{name}", fill=(25, 40, 120), font=font)
        d.text((820, y), f"{digits}", fill=(25, 40, 120), font=ImageFont.truetype(fonts[0], 52))
        y += 90
    img = img.rotate(turn, expand=True, fillcolor=(246, 240, 222))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=82)
    return out.getvalue()


def score(drafts: list[dict[str, Any]], truth: list[tuple[str, int]]) -> tuple[int, int, int]:
    """(rows found, prices right, names right): a name counts as right when its text is contained in what the model copied (or the other way round), a price when the paise equal the rupees written."""
    prices = {p * 100 for _, p in truth}
    names = [n.casefold() for n, _ in truth]
    got_names = sum(1 for n in names if any(n in d["name"].casefold() or d["name"].casefold() in n for d in drafts))
    got_prices = sum(1 for p in prices if any(d["price_paise"] == p for d in drafts))
    return len(drafts), got_prices, got_names


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", default="http://localhost:8000")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    s = ss.Seeder("https://sme-api-620338396268.asia-south1.run.app")
    s.api = a.api_url.rstrip("/")
    token = s.sign_in(f"demo-textiles@{ss.DEMO_DOMAIN}", ss.secret_get("sme-demo-textiles-password") or "")["access_token"]
    me = s.call(token, "GET", "/v1/me")[1]
    tenant = str(me["memberships"][0]["tenant"]["id"])
    t = f"/v1/tenants/{tenant}"
    cases = [("1 handwritten-looking notebook, English", picture(NOTEBOOK, [FONTS["hand"]], ruled=True, turn=3.0), NOTEBOOK),
             ("2 Telugu and Hindi list, one Telugu numeral", picture(INDIC, [FONTS["telugu"], FONTS["telugu"], FONTS["telugu"], FONTS["hindi"], FONTS["hindi"]], ruled=False, turn=-2.0, telugu_digits_on=1), INDIC)]
    ok_all = True
    for label, jpg, truth in cases:
        st, f = s.call(token, "POST", f"{t}/assistant/files", {"name": "price-list.jpg", "content_type": "image/jpeg", "size_bytes": len(jpg), "data_base64": base64.b64encode(jpg).decode("ascii")})
        if st != 201 or not isinstance(f, dict):
            print(f"{label}: upload failed (HTTP {st})")
            ok_all = False
            continue
        st, out = s.call(token, "POST", f"{t}/what-you-sell/products/read", {"file_id": f["file_id"]})
        if st != 200 or not isinstance(out, dict):
            print(f"{label}: read failed (HTTP {st}) {str(out)[:200]}")
            ok_all = False
            continue
        found, prices, names = score(out["drafts"], truth)
        print(f"\n{label}: read_by={out['read_by']} pages={out['pages']} rows={found} (written {len(truth)}); prices right {prices}/{len(truth)}, names right {names}/{len(truth)}; notes {out['notes']}")
        for d in out["drafts"]:
            print(f"   {d['confidence']:<6} {d['price_paise'] if d['price_paise'] is not None else '-':>8}  {d['unit'] or '-':<6} {d['name']}  {('(' + d['notes'] + ')') if d['notes'] else ''}")
        ok_all = ok_all and prices >= len(truth) - 1
        s.call(token, "POST", f"{t}/what-you-sell/products/read", {"file_id": f["file_id"]})   # a second read of a dropped file: 404 (nothing is kept)
    print("\nRESULT:", "ALL READ (at most one price off per picture)" if ok_all else "NEEDS A LOOK")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
