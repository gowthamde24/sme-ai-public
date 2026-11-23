"""Pure construction-materials calculator (job CN, blueprint section 5.2, ADR 0085). No model maths, no clock, no network, no floats.

It sits beside the saree quote engine (`quote_engine.quote`, pinned, untouched) and has its OWN version, `CONSTRUCTION_ENGINE_VERSION`. The same rules exist three times, kept equal by golden vectors
(`tests/fixtures/construction_vectors.json`): here (the reference), in `packages/quote-engine/ts/construction.ts` (the web and the public calculator) and in the database (`app.cq_compute`, which re-computes
every stored quote and refuses a quote whose figures differ).

Money is integer paise, rates are integer basis points (1 bps = 0.01 %), the area is integer HUNDREDTHS of the unit (1,000 sq ft = 100000) and pieces per area unit are integer THOUSANDTHS (4.5 = 4500).

For an AREA line (a paver block, a tile):
    pieces      = ceil(area x pieces_per_area x (1 + wastage))                    one rounding, upwards, at the end
    pallets     = ceil(pieces / pieces_per_pallet)                                 the pieces are rounded up to whole pallets only if the owner chose that
    material    = pieces x price                         when the unit sold is the piece
                = billed area x price                    when the unit sold is the area unit; billed area = the area the delivered pieces cover (what is delivered is what is billed), or the
                                                         customer's own area when the owner turned `bill_wastage` off
For a DIRECT line (bags of cement, tonnes of sand, a truckload): quantity x price (an optional wastage per line, default none).
Transport (one rule for the whole order; the owner's): per trip (a truck carries `truck_capacity` pieces or area), per kilometre slab (a charge per trip by distance), optionally free above an amount of
material. Trips = ceil(load / capacity), always reported (a delivery plan needs them even when freight is free). Loading and unloading: a flat amount per order or per trip. Laying: a rate per area unit.
GST is per item from the rate the OWNER entered (never assumed): a missing rate refuses the quote. The same for transport, handling and laying. Advance default 50 %, balance on delivery or on credit days,
validity default 7 days.

Rejections are structured (`status: rejected`, closed `codes`), never an exception; only a wrong type raises TypeError, as in the saree engine."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

CONSTRUCTION_ENGINE_VERSION = "1.0.0"

# Operational limits (not business rules). They keep every intermediate product inside a 64-bit database integer, and the order total inside what `orders` can hold (INR 1 crore).
MAX_AREA_X100 = 100_000_000  # 10 lakh sq ft
MAX_PIECES_PER_AREA_X1000 = 1_000_000  # 1,000 pieces per sq ft
MAX_PIECES = 10_000_000
MAX_QUANTITY = 10_000_000
MAX_UNIT_PRICE = 100_000_000  # INR 10 lakh per unit
MAX_SERVICE_AMOUNT = 100_000_000
MAX_BPS = 10_000
MAX_WASTAGE_BPS = 5_000
MAX_LINES = 20
MAX_SLABS = 10
MAX_KM = 5_000
MAX_CAPACITY = 1_000_000
MAX_CREDIT_DAYS = 180
MAX_VALIDITY_DAYS = 365
MAX_TOTAL = 1_000_000_000
MAX_ID = 128
MAX_MONEY_INPUT = 1_000_000_000

SOLD_PER = ("piece", "sq_ft", "sq_m", "box", "bag", "tonne", "cft", "truckload")
AREA_UNITS = ("sq_ft", "sq_m")
TRANSPORT_KINDS = ("none", "per_trip", "per_km_slab")
ROUNDING = ("half_up", "half_even", "down")


def canonical_json(value: Any) -> str:
    """Canonical UTF-8 JSON text; no floating point values are accepted (the same text the saree engine hashes)."""
    _json_types(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _json_types(value: Any) -> None:
    if type(value) in (str, int, bool, type(None)):
        return
    if type(value) is list:
        for item in value:
            _json_types(item)
        return
    if type(value) is dict:
        for key, item in value.items():
            if type(key) is not str:
                raise TypeError("JSON object keys must be strings")
            _json_types(item)
        return
    raise TypeError("Only integer JSON values are supported")


class _Invalid(Exception):
    pass


def _typed(value: Any, kind: type) -> Any:
    if type(value) is not kind:
        raise TypeError("Expected " + kind.__name__)
    return value


def _fields(obj: Any, required: tuple[str, ...], optional: tuple[str, ...] = ()) -> None:
    _typed(obj, dict)
    if not set(required) <= obj.keys() or obj.keys() - set(required) - set(optional):
        raise _Invalid("INVALID_FIELDS")


def _int(value: Any, lo: int = 0, hi: int | None = None) -> int:
    _typed(value, int)
    if value < lo or (hi is not None and value > hi):
        raise _Invalid("OUT_OF_RANGE")
    return value


def _choice(value: Any, choices: tuple[str, ...]) -> str:
    _typed(value, str)
    if value not in choices:
        raise _Invalid("INVALID_CHOICE")
    return value


def _text(value: Any, allow_empty: bool = False) -> str:
    _typed(value, str)
    if (not value and not allow_empty) or len(value) > MAX_ID:
        raise _Invalid("OUT_OF_RANGE")
    return value


def _ceil_div(numerator: int, denominator: int) -> int:
    return -((-numerator) // denominator)


def _rounder(mode: str):  # noqa: ANN202 - a tiny closure
    def rounded(numerator: int, denominator: int) -> int:
        whole, remainder = divmod(numerator, denominator)
        if mode == "down":
            return whole
        return whole + int(2 * remainder > denominator or (2 * remainder == denominator and (mode == "half_up" or whole % 2 == 1)))

    return rounded


_SECTIONS = ("as_of", "lines", "policy", "customer")


def _validate(r: dict[str, Any]) -> date:
    _fields(r, _SECTIONS, ("laying", "distance_km"))
    _typed(r["as_of"], str)
    try:
        day = date.fromisoformat(r["as_of"])
        if day.isoformat() != r["as_of"] or not 2020 <= day.year <= 2100:
            raise ValueError
    except ValueError:
        raise _Invalid("INVALID_DATE") from None
    if "laying" in r:
        _typed(r["laying"], bool)
    if "distance_km" in r:
        _int(r["distance_km"], 0, MAX_KM)
    _typed(r["lines"], list)
    if not r["lines"]:
        raise _Invalid("EMPTY_ORDER")
    if len(r["lines"]) > MAX_LINES:
        raise _Invalid("OUT_OF_RANGE")
    skus: set[str] = set()
    for line in r["lines"]:
        if type(line) is dict and "gst_bps" not in line:
            raise _Invalid("MISSING_GST_RATE")  # an item's GST rate is entered by the owner, never assumed
        _fields(
            line,
            ("sku", "name", "mode", "sold_per", "unit_price_paise", "gst_bps"),
            ("hsn", "area_unit", "area_x100", "pieces_per_area_x1000", "pieces_per_pallet", "quantity", "min_order_qty", "wastage_bps", "round_to_pallet"),
        )
        if _text(line["sku"]) in skus:
            raise _Invalid("DUPLICATE_SKU")
        skus.add(line["sku"])
        _text(line["name"])
        _choice(line["mode"], ("area", "direct"))
        _choice(line["sold_per"], SOLD_PER)
        _int(line["unit_price_paise"], 0, MAX_UNIT_PRICE)
        _int(line["gst_bps"], 0, MAX_BPS)
        if "hsn" in line and line["hsn"] is not None:
            hsn = _text(line["hsn"])
            if not (hsn.isdigit() and 4 <= len(hsn) <= 8):
                raise _Invalid("INVALID_HSN")
        if "min_order_qty" in line:
            _int(line["min_order_qty"], 1, MAX_QUANTITY)
        if "wastage_bps" in line:
            _int(line["wastage_bps"], 0, MAX_WASTAGE_BPS)
        if "round_to_pallet" in line:
            _typed(line["round_to_pallet"], bool)
        if "pieces_per_pallet" in line:
            _int(line["pieces_per_pallet"], 1, MAX_PIECES)
        if line["mode"] == "area":
            for key in ("area_unit", "area_x100", "pieces_per_area_x1000"):
                if key not in line:
                    raise _Invalid("INVALID_FIELDS")
            if "quantity" in line:
                raise _Invalid("INVALID_FIELDS")
            _choice(line["area_unit"], AREA_UNITS)
            _int(line["area_x100"], 1, MAX_AREA_X100)
            _int(line["pieces_per_area_x1000"], 1, MAX_PIECES_PER_AREA_X1000)
            if line["sold_per"] not in ("piece", line["area_unit"]):
                raise _Invalid("INVALID_SOLD_PER")
        else:
            if "quantity" not in line:
                raise _Invalid("INVALID_FIELDS")
            if any(k in line for k in ("area_unit", "area_x100", "pieces_per_area_x1000")):
                raise _Invalid("INVALID_FIELDS")
            _int(line["quantity"], 1, MAX_QUANTITY)
            if line["sold_per"] in AREA_UNITS:
                raise _Invalid("INVALID_SOLD_PER")
    units = {line["area_unit"] for line in r["lines"] if line["mode"] == "area"}
    if len(units) > 1:
        raise _Invalid("MIXED_AREA_UNITS")
    _validate_policy(r["policy"], units)
    c = r["customer"]
    _fields(c, ("outstanding_paise",), ("credit_limit_paise",))
    _int(c["outstanding_paise"], 0, MAX_MONEY_INPUT)
    if c.get("credit_limit_paise") is not None:
        _int(c["credit_limit_paise"], 0, MAX_MONEY_INPUT)
    try:
        day + timedelta(days=max(r["policy"]["validity_days"], r["policy"]["credit_days"]))
    except OverflowError:
        raise _Invalid("DATE_OVERFLOW") from None
    return day


def _validate_policy(p: Any, units: set[str]) -> None:
    _fields(
        p,
        ("default_wastage_bps", "round_to_pallet", "bill_wastage", "transport", "advance_bps", "credit_days", "validity_days", "rounding_mode"),
        ("handling", "laying"),
    )
    _int(p["default_wastage_bps"], 0, MAX_WASTAGE_BPS)
    _typed(p["round_to_pallet"], bool)
    _typed(p["bill_wastage"], bool)
    _int(p["advance_bps"], 0, MAX_BPS)
    _int(p["credit_days"], 0, MAX_CREDIT_DAYS)
    _int(p["validity_days"], 0, MAX_VALIDITY_DAYS)
    _choice(p["rounding_mode"], ROUNDING)
    t = p["transport"]
    _fields(t, ("kind",), ("capacity_basis", "truck_capacity", "rate_per_trip_paise", "slabs", "free_above_paise", "gst_bps"))
    kind = _choice(t["kind"], TRANSPORT_KINDS)
    if kind == "none":
        # no freight charge; a truck capacity may still be given so the trips (the delivery plan) are known
        if set(t) - {"kind", "capacity_basis", "truck_capacity"} or ("capacity_basis" in t) != ("truck_capacity" in t):
            raise _Invalid("INVALID_FIELDS")
        if "capacity_basis" in t:
            _choice(t["capacity_basis"], ("pieces", "area"))
            _int(t["truck_capacity"], 1, MAX_CAPACITY)
    else:
        if "gst_bps" not in t:
            raise _Invalid("MISSING_GST_RATE")
        _int(t["gst_bps"], 0, MAX_BPS)
        if "capacity_basis" in t:
            _choice(t["capacity_basis"], ("pieces", "area"))
        if ("capacity_basis" in t) != ("truck_capacity" in t):
            raise _Invalid("INVALID_FIELDS")
        if "truck_capacity" in t:
            _int(t["truck_capacity"], 1, MAX_CAPACITY)
        if "free_above_paise" in t and t["free_above_paise"] is not None:
            _int(t["free_above_paise"], 1, MAX_MONEY_INPUT)
        if kind == "per_trip":
            if "rate_per_trip_paise" not in t or "truck_capacity" not in t or "slabs" in t:
                raise _Invalid("INVALID_FIELDS")
            _int(t["rate_per_trip_paise"], 0, MAX_SERVICE_AMOUNT)
        else:
            if "slabs" not in t or "rate_per_trip_paise" in t:
                raise _Invalid("INVALID_FIELDS")
            _typed(t["slabs"], list)
            if not 1 <= len(t["slabs"]) <= MAX_SLABS:
                raise _Invalid("OUT_OF_RANGE")
            previous = -1
            for slab in t["slabs"]:
                _fields(slab, ("up_to_km", "charge_paise"))
                if _int(slab["up_to_km"], 0, MAX_KM) <= previous:
                    raise _Invalid("INVALID_SLABS")
                previous = slab["up_to_km"]
                _int(slab["charge_paise"], 0, MAX_SERVICE_AMOUNT)
        if t.get("capacity_basis") == "area" and not units:
            raise _Invalid("INVALID_FIELDS")
    if "handling" in p:
        _fields(p["handling"], ("per", "amount_paise", "gst_bps"))
        _choice(p["handling"]["per"], ("order", "trip"))
        _int(p["handling"]["amount_paise"], 0, MAX_SERVICE_AMOUNT)
        _int(p["handling"]["gst_bps"], 0, MAX_BPS)
    if "laying" in p:
        _fields(p["laying"], ("rate_paise_per_area", "gst_bps"))
        _int(p["laying"]["rate_paise_per_area"], 0, MAX_SERVICE_AMOUNT)
        _int(p["laying"]["gst_bps"], 0, MAX_BPS)


def _empty(codes: list[str], digest: str | None, flags: list[dict[str, Any]], trace: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "status": "rejected",
        "codes": codes,
        "engine_version": CONSTRUCTION_ENGINE_VERSION,
        "canonical_hash": digest,
        "flags": {"needs_owner_approval": True, "reasons": flags},
        "trace": trace,
    }


def calculate(request: dict[str, Any]) -> dict[str, Any]:
    """Return a draft calculation or a structured rejection. Only a value of the wrong type raises (TypeError)."""
    try:
        _json_types(request)
        _typed(request, dict)
        _check_size(request)
    except _Invalid as exc:
        return _empty([str(exc)], None, [], [])
    payload = canonical_json({"engine_version": CONSTRUCTION_ENGINE_VERSION, "inputs": request})
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    try:
        day = _validate(request)
    except _Invalid as exc:
        return _empty([str(exc)], digest, [], [])
    out = _run(request, day, digest)
    if out["status"] == "draft":
        out["range"] = _range(request, day, digest, out)
    return out


def _check_size(request: dict[str, Any]) -> None:
    # nesting and length are bounded before any element is inspected
    if len(request) > 8:
        raise _Invalid("OUT_OF_RANGE")
    if isinstance(request.get("lines"), list) and len(request["lines"]) > MAX_LINES:
        raise _Invalid("OUT_OF_RANGE")
    stack: list[tuple[Any, int]] = [(request, 0)]
    count = 0
    while stack:
        value, depth = stack.pop()
        count += 1
        if depth > 6 or count > 5_000:
            raise _Invalid("OUT_OF_RANGE")
        if type(value) is dict:
            if len(value) > 24:
                raise _Invalid("OUT_OF_RANGE")
            stack.extend((v, depth + 1) for v in value.values())
        elif type(value) is list:
            if len(value) > 24:
                raise _Invalid("OUT_OF_RANGE")
            stack.extend((v, depth + 1) for v in value)
        elif type(value) is str and len(value) > MAX_ID:
            raise _Invalid("OUT_OF_RANGE")
        elif type(value) is int and abs(value) > 10**12:
            raise _Invalid("OUT_OF_RANGE")


def _range(request: dict[str, Any], day: date, digest: str, exact: dict[str, Any]) -> dict[str, int]:
    """The estimate a customer is shown before an exact quote: LOW = no wastage and no pallet rounding, HIGH = the quote itself (wastage and pallets as chosen). Both are totals incl. GST."""
    low_request = json.loads(json.dumps(request))
    low_request["policy"]["default_wastage_bps"] = 0
    low_request["policy"]["round_to_pallet"] = False
    for line in low_request["lines"]:
        if "wastage_bps" in line:
            line["wastage_bps"] = 0
        if "round_to_pallet" in line:
            line["round_to_pallet"] = False
    low = _run(low_request, day, digest)
    low_total = low["totals"]["total"] if low["status"] == "draft" else exact["totals"]["total"]
    return {"total_low": min(low_total, exact["totals"]["total"]), "total_high": exact["totals"]["total"]}


def _run(r: dict[str, Any], day: date, digest: str) -> dict[str, Any]:  # noqa: C901, PLR0912, PLR0915 - one straight calculation, kept in the order of the blueprint
    p = r["policy"]
    rounded = _rounder(p["rounding_mode"])
    flags: list[dict[str, Any]] = []
    trace: list[dict[str, Any]] = []

    def flag(code: str, **numbers: Any) -> None:
        flags.append({"code": code, **numbers})

    def rule(rule_id: str, **numbers: Any) -> None:
        trace.append({"rule_id": rule_id, "inputs": numbers, "text": rule_id + ": " + canonical_json(numbers)})

    lines: list[dict[str, Any]] = []
    load_pieces = 0
    load_area_x100 = 0
    uncounted: list[str] = []
    ordered_area_x100 = 0
    area_unit: str | None = None
    basis = p["transport"].get("capacity_basis")
    for src in r["lines"]:
        sku = src["sku"]
        wastage = src.get("wastage_bps", p["default_wastage_bps"] if src["mode"] == "area" else 0)
        if src["mode"] == "area":
            a, ppa = src["area_x100"], src["pieces_per_area_x1000"]
            area_unit = src["area_unit"]
            ordered_area_x100 += a
            base_pieces = _ceil_div(a * ppa, 100_000)
            pieces = _ceil_div(a * ppa * (MAX_BPS + wastage), 100_000 * MAX_BPS)
            pallets = None
            ppp = src.get("pieces_per_pallet")
            use_pallets = src.get("round_to_pallet", p["round_to_pallet"])
            if ppp is not None:
                pallets = _ceil_div(pieces, ppp)
                if use_pallets:
                    pieces = pallets * ppp
            if pieces > MAX_PIECES:
                return _empty(["OUT_OF_RANGE"], digest, flags, trace)
            delivered_area_x100 = _ceil_div(pieces * 100_000, ppa)
            rule("quantity.area", sku=sku, area_x100=a, pieces_per_area_x1000=ppa, wastage_bps=wastage, pieces_without_wastage=base_pieces, pieces=pieces,
                 pieces_per_pallet=ppp, pallets=pallets, pallet_rounding=bool(use_pallets and ppp is not None), delivered_area_x100=delivered_area_x100)
            if src["sold_per"] == "piece":
                billed_qty = pieces
                material = pieces * src["unit_price_paise"]
                rule("material.per_piece", sku=sku, quantity=pieces, unit_price_paise=src["unit_price_paise"], material=material)
            else:
                billed_area = delivered_area_x100 if p["bill_wastage"] else a
                billed_qty = billed_area
                material = rounded(billed_area * src["unit_price_paise"], 100)
                rule("material.per_area", sku=sku, billed_area_x100=billed_area, bill_wastage=p["bill_wastage"], unit_price_paise=src["unit_price_paise"], material=material)
            minimum_check = pieces if src["sold_per"] == "piece" else _ceil_div(billed_qty, 100)
            line_load = pieces
            load_pieces += pieces
            load_area_x100 += delivered_area_x100
            quantity_out = {"pieces": pieces, "pieces_without_wastage": base_pieces, "pallets": pallets, "delivered_area_x100": delivered_area_x100, "billed_quantity": billed_qty,
                            "billed_per": src["sold_per"]}
        else:
            q = src["quantity"]
            pieces_q = _ceil_div(q * (MAX_BPS + wastage), MAX_BPS)
            material = pieces_q * src["unit_price_paise"]
            rule("material.direct", sku=sku, quantity=q, wastage_bps=wastage, quantity_billed=pieces_q, unit_price_paise=src["unit_price_paise"], material=material)
            minimum_check = pieces_q
            line_load = pieces_q if src["sold_per"] == "piece" else 0
            if src["sold_per"] == "piece":
                load_pieces += pieces_q
            else:
                uncounted.append(sku)
            quantity_out = {"pieces": pieces_q if src["sold_per"] == "piece" else None, "pieces_without_wastage": None, "pallets": None, "delivered_area_x100": None,
                            "billed_quantity": pieces_q, "billed_per": src["sold_per"]}
        if "min_order_qty" in src:
            rule("quantity.minimum", sku=sku, quantity=minimum_check, minimum=src["min_order_qty"])
            if minimum_check < src["min_order_qty"]:
                flag("BELOW_MINIMUM_ORDER_QUANTITY", sku=sku)
        tax = rounded(material * src["gst_bps"], MAX_BPS)
        rule("tax.item", sku=sku, material=material, gst_bps=src["gst_bps"], tax=tax)
        lines.append({"sku": sku, "name": src["name"], "hsn": src.get("hsn"), "mode": src["mode"], "unit_price_paise": src["unit_price_paise"], "gst_bps": src["gst_bps"],
                      **quantity_out, "load": line_load, "material": material, "tax": tax, "gross": material + tax})
    material_total = sum(x["material"] for x in lines)

    # ---- trips and freight
    t = p["transport"]
    capacity = t.get("truck_capacity")
    if capacity is None:
        trips, load = (1, 0)
    else:
        load = load_pieces if basis == "pieces" else load_area_x100
        capacity_scaled = capacity if basis == "pieces" else capacity * 100
        trips = max(1, _ceil_div(load, capacity_scaled))
        for sku in uncounted:
            flag("LINE_NOT_COUNTED_IN_TRIPS", sku=sku)
        rule("trips", basis=basis, load=load, capacity=capacity_scaled, trips=trips)
    transport = 0
    if t["kind"] == "per_trip":
        transport = trips * t["rate_per_trip_paise"]
        rule("transport.per_trip", trips=trips, rate_per_trip_paise=t["rate_per_trip_paise"], transport=transport)
    elif t["kind"] == "per_km_slab":
        distance = r.get("distance_km")
        if distance is None:
            return _empty(["DISTANCE_MISSING"], digest, flags, trace)
        slab = next((s for s in t["slabs"] if distance <= s["up_to_km"]), None)
        if slab is None:
            flag("DISTANCE_BEYOND_SLABS", distance_km=distance)
            return _empty(["DISTANCE_BEYOND_SLABS"], digest, flags, trace)
        transport = trips * slab["charge_paise"]
        rule("transport.km_slab", distance_km=distance, up_to_km=slab["up_to_km"], charge_per_trip_paise=slab["charge_paise"], trips=trips, transport=transport)
    free_above = t.get("free_above_paise")
    free = False
    if free_above is not None and t["kind"] != "none":
        free = material_total > free_above
        rule("transport.free_above", material=material_total, free_above_paise=free_above, free=free)
        if free:
            transport = 0
    transport_tax = rounded(transport * t["gst_bps"], MAX_BPS) if t["kind"] != "none" else 0

    # ---- handling (loading and unloading)
    handling, handling_tax = 0, 0
    if "handling" in p:
        h = p["handling"]
        handling = h["amount_paise"] * (trips if h["per"] == "trip" else 1)
        handling_tax = rounded(handling * h["gst_bps"], MAX_BPS)
        rule("handling", per=h["per"], amount_paise=h["amount_paise"], trips=trips, handling=handling, tax=handling_tax)

    # ---- laying
    laying, laying_tax = 0, 0
    if r.get("laying"):
        if "laying" not in p or area_unit is None:
            return _empty(["LAYING_RATE_MISSING"], digest, flags, trace)
        lp = p["laying"]
        laying = rounded(ordered_area_x100 * lp["rate_paise_per_area"], 100)
        laying_tax = rounded(laying * lp["gst_bps"], MAX_BPS)
        rule("laying", area_x100=ordered_area_x100, rate_paise_per_area=lp["rate_paise_per_area"], laying=laying, tax=laying_tax)

    item_tax = sum(x["tax"] for x in lines)
    tax = item_tax + transport_tax + handling_tax + laying_tax
    subtotal = material_total + transport + handling + laying
    total = subtotal + tax
    if total > MAX_TOTAL:
        return _empty(["TOTAL_TOO_LARGE"], digest, flags, trace)
    advance = rounded(total * p["advance_bps"], MAX_BPS)
    balance = total - advance
    credit_days = p["credit_days"]
    due = (day + timedelta(days=credit_days)).isoformat() if credit_days > 0 else None
    c = r["customer"]
    limit = c.get("credit_limit_paise")
    exposure = c["outstanding_paise"] + balance
    if limit is not None:
        rule("credit.limit", outstanding_paise=c["outstanding_paise"], balance=balance, credit_limit_paise=limit, exposure=exposure)
        if exposure > limit:
            flag("CREDIT_LIMIT_EXCEEDED", exposure=exposure, credit_limit_paise=limit)
    valid = (day + timedelta(days=p["validity_days"])).isoformat()
    rule("payment.terms", total=total, advance_bps=p["advance_bps"], advance=advance, balance=balance, credit_days=credit_days, due_date=due)
    rule("quote.validity", as_of=day.isoformat(), validity_days=p["validity_days"], valid_until=valid)
    return {
        "status": "draft",
        "engine_version": CONSTRUCTION_ENGINE_VERSION,
        "canonical_hash": digest,
        "lines": lines,
        "trips": trips,
        "totals": {
            "material": material_total, "transport": transport, "handling": handling, "laying": laying, "subtotal": subtotal,
            "item_tax": item_tax, "transport_tax": transport_tax, "handling_tax": handling_tax, "laying_tax": laying_tax, "tax": tax, "total": total,
        },
        "payment_terms": {"advance_amount": advance, "balance": balance, "credit_days": credit_days, "due_date": due, "balance_on": "credit_days" if credit_days > 0 else "delivery"},
        "valid_until": valid,
        "flags": {"needs_owner_approval": True, "reasons": flags},
        "trace": trace,
    }
