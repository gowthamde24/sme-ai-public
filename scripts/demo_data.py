"""The demo data of the three businesses that example data cannot give (job DG), written ONCE and used by the hosted seed (scripts/seed_staging.py) and the local seed (scripts/seed_demo_school.py).

Both go through OUR API as the demo owner (row-level security applies, nothing is written around it) and are idempotent: every row has a fixed id and a second run changes nothing. They create a row only when it is
absent and never overwrite one that is there, so a re-seed or a deploy can never undo what a person did (the construction product the owner hid stays hidden; DG found a smoke test flipping it back on every run).

  * construction_materials: ONE visible demo product with its own figures (price, GST, pieces per area, ...), a generated placeholder picture (an active product needs one) and the materials rules, so the quote screen has something to quote on a fresh workspace;
  * education: a school with its institution profile, a class, three students with a guardian each (FAKE phone numbers) and a fee plan with two instalments already due and one to come, one part payment, so the fee
    ledger has an audience and the figures differ.

THE PHONE NUMBERS are in the app's existing fake-number convention: country code `+00`, which is not a dialling code, so a number written `+00 000 000 71NN` can never ring or message anyone, anywhere (the
real-data gate itself only accepts such numbers while it is closed). The children's labels are `Demo A`, `Demo B`, `Demo C`; the guardians are `Demo Parent A (synthetic)` and so on. Nothing here is a real person."""

from __future__ import annotations

import json
import struct
import uuid
import zlib
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
NS = uuid.UUID("3f6c1c2e-8a41-4d0a-9b57-6e1d2c4f9a10")
Call = Callable[..., tuple[int, Any]]  # call(method, path_after_the_tenant, body=None, raw=(bytes, content_type)) -> (status, json)
I = "/institution"  # the school routes live under the tenant's /institution
PHONES = ["+00 000 000 7101", "+00 000 000 7102", "+00 000 000 7103"]


class DemoError(Exception):
    """A readable failure; no message holds a key, a token or a response body."""


def did(name: str) -> str:
    return str(uuid.uuid5(NS, name))


def placeholder_png(width: int = 640, height: int = 480, rgb: tuple[int, int, int] = (176, 98, 62)) -> bytes:
    """A plain coloured picture, made here with the standard library (no imaging package in the seed): an invented placeholder, clearly not a photo of anything."""
    row = b"\x00" + bytes(rgb) * width

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(row * height, 9)) + chunk(b"IEND", b"")


def _ok(label: str, result: tuple[int, Any], want: tuple[int, ...] = (200, 201)) -> Any:
    status, body = result
    if status not in want:
        code = body.get("error", {}).get("code") if isinstance(body, dict) and isinstance(body.get("error"), dict) else None
        raise DemoError(f"{label}: HTTP {status}" + (f" ({code})" if code else ""))
    return body


# ----------------------------------------------------------------------------- construction materials
def construction_materials(call: Call) -> dict[str, str]:
    """The materials rules (the worked example's, without laying) and ONE visible demo product. Created only when absent."""
    vectors = json.loads((ROOT / "packages/quote-engine/tests/fixtures/construction_vectors.json").read_text(encoding="utf-8"))["vectors"]
    policy = next(v for v in vectors if v["name"].startswith("worked_example"))["request"]["policy"]
    policy = {k: v for k, v in policy.items() if k != "laying"}
    item = did("construction-demo-product")
    if call("GET", "/materials/policy")[1].get("current") is None:
        _ok("materials policy", call("POST", "/materials/policy", {"version_id": did("construction-demo-policy"), "policy": policy}))
    status, current = call("GET", f"/materials/items/{item}")  # an item that does not exist answers 422 invalid_reference, not 404
    body = {"name": "Demo: Paver block 200 x 100 mm, 80 mm (synthetic)", "sell_unit": "sq_ft", "area_unit": "sq_ft", "stock_status": "in_stock", "price_paise": 6500}
    if status == 200 and isinstance(current, dict) and (current.get("active") or current.get("photos")):
        return {"demo product": "already there (left as it is)"}  # shown, or hidden by a person after it had a picture: not ours to change
    if status != 200:
        # a product can be shown to customers only once its figures are complete: made hidden, figures set, then (below) a picture, then shown
        _ok("demo product", call("PUT", f"/materials/items/{item}", {**body, "active": False}))
        _ok("demo product figures", call("PUT", f"/catalogue/{item}/custom", {"values": {"product_type": "paver_block", "thickness_mm": "80", "size": "200 x 100 mm", "pieces_per_area": 4.5, "pieces_per_pallet": 500, "minimum_order": 100, "lead_days": 3, "hsn_code": "68101990", "gst_rate_percent": 18}}))
    # an active product needs a photo (the database refuses otherwise: SM521); a generated placeholder, uploaded through the API like a real one
    _ok("demo product picture", call("POST", f"/materials/items/{item}/photos?photo_id={did('construction-demo-photo')}", raw=(placeholder_png(), "image/png")))
    _ok("demo product shown", call("PUT", f"/materials/items/{item}", {**body, "active": True}))
    return {"demo product": "created (a placeholder picture, shown to customers)"}


# ----------------------------------------------------------------------------- education
def academic_year(today: date) -> str:
    start = today.year if today.month >= 4 else today.year - 1
    return f"{start}-{(start + 1) % 100:02d}"


def education(call: Call, today: date) -> dict[str, str]:
    """A school with a class, three students (fake guardian phones) and a fee plan with dues. Each piece only when absent."""
    out: dict[str, str] = {}
    if not call("GET", f"{I}/profile")[1].get("configured"):
        _ok("institution", call("PUT", f"{I}/profile", {"institution_type": "school", "year_start_month": 4, "terms": [], "parent_languages": ["en", "te"]}))
        out["institution"] = "set (a school, the year starts in April)"
    programme = did("school-class-5")
    _ok("class", call("PUT", f"{I}/programmes/{programme}", {"name": "Demo: Class 5", "kind": "class", "group_kind": "none", "active": True}))
    students: list[str] = []
    for i, label in enumerate(("Demo A", "Demo B", "Demo C")):
        contact, student = did(f"school-guardian-{i}"), did(f"school-student-{i}")
        _ok("guardian", call("POST", "/contacts", {"id": contact, "full_name": f"Demo Parent {'ABC'[i]} (synthetic)", "phone": PHONES[i]}), (200, 201, 409))
        _ok("student", call("PUT", f"{I}/students/{student}", {"contact_id": contact, "is_adult": False, "child_label": label, "programme_id": programme, "admission_no": f"DEMO-{i + 1:03d}", "joined_on": (today - timedelta(days=200)).isoformat()}))
        students.append(student)
    plan = did("school-fee-plan")
    if call("GET", f"{I}/fee-plans/{plan}")[0] != 200:
        lines = [(1, today - timedelta(days=60), 600_000), (2, today - timedelta(days=20), 600_000), (3, today + timedelta(days=45), 600_000)]
        _ok("fee plan", call("PUT", f"{I}/fee-plans/{plan}", {"name": "Demo: Class 5 fees (synthetic)", "programme_id": programme, "academic_year": academic_year(today), "lines": [{"head": "tuition", "instalment_no": n, "due_date": d.isoformat(), "amount_paise": a} for n, d, a in lines]}))
        out["fee plan"] = "created: two instalments of Rs 6,000 already due, one to come"
    for i, student in enumerate(students):
        _ok("fee assignment", call("PUT", f"{I}/fee-assignments/{did(f'school-assignment-{i}')}", {"student_id": student, "plan_id": plan}))
    # one part payment, so the three families do not owe the same
    _ok("payment", call("PUT", f"{I}/students/{students[0]}/payments/{did('school-payment-0')}", {"received_on": today.isoformat(), "amount_paise": 400_000, "method": "upi"}))
    out["students"] = "three, with a guardian each (fake +00 numbers); one part payment of Rs 4,000"
    return out
