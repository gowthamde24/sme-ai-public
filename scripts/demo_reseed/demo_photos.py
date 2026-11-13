"""Neutral placeholder pictures for the 18 catalogue items of the staging workspace "Neelambari Silks (demo)" (owner, 13 Nov 2026: "neutral saree photos for the catalogue tiles until I send real ones").

These are DRAWN pictures (a flat-lay of a plain saree: body colour, zari border, a pallu), not photographs of real products, and they carry no text. One per item, a different colour family for each of the four categories.
The owner's own pictures replace them in the app (Catalogue > the item > Photos); removing the last picture of a published item needs the item to be switched off first, as for any item.

  python3 -I scripts/demo_reseed/demo_photos.py preview <folder>                       draw the 18 pictures into a folder (nothing else happens: no network, no database)
  python3 -I scripts/demo_reseed/demo_photos.py apply --i-know-this-changes-staging --project-ref uiallwgywitryxatcqxf

apply: checks the project is stack19-staging; makes the workspace's private bucket (the app's own function); uploads each picture and its thumbnail as the app does (the same JPEG sizes: 1280 px at most, thumbnail 320 px);
registers each one with the app's own function `catalogue_photo_add` as the workspace owner; switches the 18 items on (an item needs a picture to be on). Run again any time: nothing is doubled (the ids come from the item).
The staging service key is read into memory from the Supabase CLI and never printed or written. Messages carry no key, no response body."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

STAGING_REF = "uiallwgywitryxatcqxf"
STAGING_NAME = "stack19-staging"
TENANT_NAME = "Neelambari Silks (demo)"
PREFIX = "stack19.demo-reseed.neelambari:"
KEYS = ("ss_tissue", "ss_meenakari", "ss_checks", "ss_kadiyal", "ss_buttas", "ss_selfgold", "lw_kanchi", "lw_vpure", "lw_vhandloom", "ps_selfdesign", "ps_reshamwarp", "ps_tissuecontrast", "ps_meenakari", "ps_reshamkuttu", "ps_zari", "ps_3cord", "ps_4cord", "hl_pure")
# (body, border, zari) per item: soft pastels for semi silk, earthy for lightweight, deep jewel colours for pure silk, indigo for handloom
PALETTE: dict[str, tuple[str, str, str]] = {
    "ss_tissue": ("#F2D7C9", "#B5655C", "#D9B45A"), "ss_meenakari": ("#CFE3D8", "#2E7D6B", "#D9B45A"), "ss_checks": ("#D8D2EE", "#5B4FA3", "#D9B45A"),
    "ss_kadiyal": ("#F6E3A8", "#B4572C", "#D9B45A"), "ss_buttas": ("#C9E0F0", "#2F6C99", "#D9B45A"), "ss_selfgold": ("#F0C9D4", "#A63A5A", "#E0BE62"),
    "lw_kanchi": ("#C7603E", "#2F3B66", "#D9B45A"), "lw_vpure": ("#8E3B46", "#E7C9A2", "#D9B45A"), "lw_vhandloom": ("#6D7B4B", "#C6A25E", "#D9B45A"),
    "ps_selfdesign": ("#B3202F", "#1F3D2B", "#E3C063"), "ps_reshamwarp": ("#1F4E8C", "#C8962E", "#E3C063"), "ps_tissuecontrast": ("#C0397B", "#2D6A4F", "#E3C063"),
    "ps_meenakari": ("#1B7A5C", "#9C2A3A", "#E3C063"), "ps_reshamkuttu": ("#6A2C7D", "#E0A53A", "#E3C063"), "ps_zari": ("#D9A21B", "#7A1F2B", "#F0D27A"),
    "ps_3cord": ("#7B1E3A", "#D8B25A", "#E3C063"), "ps_4cord": ("#0F6B73", "#B8442E", "#E3C063"), "hl_pure": ("#27406E", "#E9E2D0", "#C9B27A"),
}
W, H = 1000, 1250


class PhotoError(Exception):
    """A readable failure. Messages never contain a key or a response body."""


def item_id(key: str) -> uuid.UUID:
    return uuid.UUID(hashlib.md5((PREFIX + "item-" + key).encode()).hexdigest())


def photo_id(key: str) -> uuid.UUID:
    return uuid.UUID(hashlib.md5((PREFIX + "photo-" + key).encode()).hexdigest())


def rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def shade(c: tuple[int, int, int], k: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, round(v * k))) for v in c)  # type: ignore[return-value]


def draw(key: str) -> Image.Image:
    """A plain flat-lay of a saree: a soft backdrop, the draped body in its colour with a weave, two border bands with a zari line, and a pallu with a row of small motifs. Made from the item's key only."""
    rnd = random.Random(key)
    body_c, border_c, zari_c = (rgb(x) for x in PALETTE[key])
    img = Image.new("RGB", (W, H), (240, 236, 229))
    d = ImageDraw.Draw(img)
    for y in range(H):   # a soft backdrop gradient
        v = round(14 * y / H)
        d.line([(0, y), (W, y)], fill=(244 - v, 240 - v, 233 - v))
    # the fabric: a long rectangle laid at a slight angle (drawn straight, then rotated)
    fw, fh = 640, 1060
    cloth = Image.new("RGB", (fw, fh), body_c)
    cd = ImageDraw.Draw(cloth)
    for x in range(0, fw, 4):   # the weave: fine vertical threads, each a touch lighter or darker
        cd.line([(x, 0), (x, fh)], fill=shade(body_c, 0.95 + 0.1 * rnd.random()))
    for y in range(0, fh, 6):
        cd.line([(0, y), (fw, y)], fill=shade(body_c, 0.97 + 0.06 * rnd.random()), width=1)
    # soft drape folds
    folds = Image.new("L", (fw, fh), 128)
    fd = ImageDraw.Draw(folds)
    for _ in range(7):
        x0 = rnd.randint(40, fw - 40)
        fd.line([(x0, 0), (x0 + rnd.randint(-60, 60), fh)], fill=rnd.choice((96, 160)), width=rnd.randint(14, 34))
    folds = folds.filter(ImageFilter.GaussianBlur(18))
    cloth = Image.composite(Image.new("RGB", (fw, fh), (0, 0, 0)), cloth, folds.point(lambda p: max(0, 128 - p) * 2 if p < 128 else 0))
    cloth = Image.composite(Image.new("RGB", (fw, fh), (255, 255, 255)), cloth, folds.point(lambda p: max(0, p - 128) // 2 if p > 128 else 0))
    cd = ImageDraw.Draw(cloth)
    # the borders: two bands along the long edges, each with a zari line inside it
    bw = 78
    for x0 in (0, fw - bw):
        cd.rectangle([x0, 0, x0 + bw, fh], fill=border_c)
        for t in range(0, fh, 5):
            cd.line([(x0, t), (x0 + bw, t)], fill=shade(border_c, 0.9 + 0.2 * rnd.random()))
        inner = x0 + (bw - 14 if x0 == 0 else 0)
        cd.rectangle([inner, 0, inner + 14, fh], fill=zari_c)
        cd.rectangle([inner + (6 if x0 == 0 else 4), 0, inner + (8 if x0 == 0 else 10), fh], fill=shade(zari_c, 1.12))
    # the pallu: the last 250 px, with a broad zari band and a row of small motifs
    py = fh - 250
    cd.rectangle([bw + 14, py, fw - bw - 14, py + 26], fill=zari_c)
    cd.rectangle([bw + 14, py + 40, fw - bw - 14, py + 52], fill=border_c)
    for row, y in enumerate(range(py + 80, fh - 30, 56)):
        for x in range(bw + 70 + (28 if row % 2 else 0), fw - bw - 40, 56):
            r = 9
            cd.ellipse([x - r, y - r, x + r, y + r], fill=zari_c)
            cd.ellipse([x - 3, y - 3, x + 3, y + 3], fill=border_c)
    # a few small buttas over the body
    for _ in range(int(14 + 14 * rnd.random())):
        x = rnd.randint(bw + 60, fw - bw - 60)
        y = rnd.randint(60, py - 60)
        r = rnd.randint(4, 7)
        cd.ellipse([x - r, y - r, x + r, y + r], fill=shade(zari_c, 0.92))
    ang = rnd.choice((-4, -3, 3, 4))   # the cloth lies at a slight angle: rotated with its own mask, so the corners show the backdrop
    mk = Image.new("L", (fw, fh), 255).rotate(ang, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=0)
    cloth = cloth.rotate(ang, resample=Image.Resampling.BICUBIC, expand=True, fillcolor=(0, 0, 0))
    shadow = Image.new("RGBA", cloth.size, (0, 0, 0, 0))
    shadow.putalpha(mk.point(lambda p: p // 4))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    px, py2 = (W - cloth.width) // 2, (H - cloth.height) // 2
    img.paste(shadow, (px + 10, py2 + 14), shadow)
    img.paste(cloth, (px, py2), mk)
    return img


def jpeg(image: Image.Image, side: int, quality: int) -> tuple[bytes, tuple[int, int]]:
    out = image.copy()
    out.thumbnail((side, side), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue(), out.size


def run(argv: list[str], stdin: str | None = None) -> str:
    done = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=180, check=False)
    if done.returncode != 0:
        raise PhotoError(f"`{argv[0]} {argv[1] if len(argv) > 1 else ''}` failed (exit {done.returncode}).")
    return done.stdout


def json_from(text: str) -> Any:
    return json.JSONDecoder().raw_decode(text[min(i for i in (text.find("["), text.find("{")) if i >= 0):])[0]


def query(sql: str) -> list[dict[str, Any]]:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as f:
        f.write(sql)
        path = f.name
    try:
        out = json_from(run(["supabase", "db", "query", "--linked", "--agent", "no", "-o", "json", "-f", path]))
    finally:
        Path(path).unlink(missing_ok=True)
    rows = out.get("rows") if isinstance(out, dict) else out
    return rows if isinstance(rows, list) else []


def guard(args: argparse.Namespace) -> None:
    if not args.i_know_this_changes_staging:
        raise PhotoError("Refusing to run: pass --i-know-this-changes-staging (this writes pictures and catalogue rows on the HOSTED stack19-staging project).")
    if args.project_ref != STAGING_REF:
        raise PhotoError("Refusing to run: --project-ref is not the stack19-staging project.")
    listed = json_from(run(["supabase", "projects", "list", "--agent", "no", "-o", "json"]))
    match = [p for p in listed if p.get("id") == STAGING_REF or p.get("ref") == STAGING_REF]
    if len(match) != 1 or match[0].get("name") != STAGING_NAME:
        raise PhotoError(f"Refusing to run: the project under that ref is not named {STAGING_NAME}.")


def upload(service: str, bucket: str, path: str, data: bytes) -> None:
    req = urllib.request.Request(f"https://{STAGING_REF}.supabase.co/storage/v1/object/{bucket}/{path}", method="POST", data=data,
                                 headers={"apikey": service, "Authorization": f"Bearer {service}", "Content-Type": "image/jpeg", "x-upsert": "true", "User-Agent": "stack19-demo-photos"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status not in (200, 201):
                raise PhotoError(f"A picture could not be stored (HTTP {r.status}).")
    except urllib.error.HTTPError as e:
        raise PhotoError(f"A picture could not be stored (HTTP {e.code}).") from None


def preview(folder: Path) -> int:
    folder.mkdir(parents=True, exist_ok=True)
    for key in KEYS:
        data, _ = jpeg(draw(key), 1280, 85)
        (folder / f"{key}.jpg").write_bytes(data)
    print(f"Drew {len(KEYS)} pictures into {folder}.")
    return 0


def apply(args: argparse.Namespace) -> int:
    guard(args)
    ctx = query(f"select t.id as tenant, (select m.user_id from public.memberships m where m.tenant_id = t.id and m.role = 'owner' order by m.created_at limit 1) as owner from public.tenants t where t.name = '{TENANT_NAME}' and t.archived_at is null")
    if len(ctx) != 1 or not ctx[0].get("owner"):
        raise PhotoError("Expected exactly one workspace with that name and an owner.")
    tenant, owner = ctx[0]["tenant"], ctx[0]["owner"]
    claims = f"select set_config('request.jwt.claim.sub', '{owner}', true), set_config('request.jwt.claims', json_build_object('sub', '{owner}', 'role', 'authenticated', 'aud', 'authenticated', 'aal', 'aal2')::text, true)"
    bucket = query(f"{claims};\nselect public.catalogue_ensure_bucket('{tenant}') as b;")
    bucket_name = (bucket[0] if bucket else {}).get("b") or f"cat-{tenant}"
    keys = json_from(run(["supabase", "projects", "api-keys", "--project-ref", STAGING_REF, "--agent", "no", "-o", "json"]))
    service = str(next(k["api_key"] for k in keys if k.get("id") == "service_role"))   # in memory only
    values: list[str] = []
    for key in KEYS:
        image = draw(key)
        photo, (w, h) = jpeg(image, 1280, 85)
        thumb, _ = jpeg(image, 320, 80)
        iid, pid = item_id(key), photo_id(key)
        upload(service, bucket_name, f"{iid}/{pid}.jpg", photo)
        upload(service, bucket_name, f"{iid}/{pid}_t.jpg", thumb)
        values.append(f"('{pid}', '{iid}', {w}, {h}, {len(photo)}, {len(thumb)})")
        print(f"  {key}: {len(photo) // 1024} KB, thumbnail {len(thumb) // 1024} KB")
    sql = (
        f"{claims};\n"
        f"select public.catalogue_photo_add(v.pid::uuid, '{tenant}'::uuid, v.iid::uuid, v.w, v.h, v.b, v.tb) from (values {', '.join(values)}) as v(pid, iid, w, h, b, tb);\n"
        f"update public.catalogue_items c set active = true, updated_by = '{owner}' where c.tenant_id = '{tenant}' and not c.active and c.id in ({', '.join(repr(str(item_id(k))) for k in KEYS)});\n"
        f"select (select count(*) from public.catalogue_photos p where p.tenant_id = '{tenant}' and p.removed_at is null and p.item_id in ({', '.join(repr(str(item_id(k))) for k in KEYS)})) as photos,"
        f" (select count(*) from public.catalogue_items c where c.tenant_id = '{tenant}' and c.active) as active_items;"
    )
    out = query(sql)
    print(f"Registered. {out[-1] if out else ''}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("preview")
    p.add_argument("folder", type=Path)
    a = sub.add_parser("apply")
    a.add_argument("--i-know-this-changes-staging", action="store_true")
    a.add_argument("--project-ref", required=True)
    args = ap.parse_args(argv)
    try:
        return preview(args.folder) if args.cmd == "preview" else apply(args)
    except PhotoError as e:
        print(f"Stopped: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
