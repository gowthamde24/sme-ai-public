"""Deterministic proposed catalog matches; no pricing, decisions or external I/O."""
from datetime import date
import copy
import hashlib
import json
import re

MAPPER_VERSION = "1.0.0"
MAX_LINES = 5
MAX_QUANTITY = 10_000
MAX_FIELDS = 100
MAX_PRODUCTS = 5_000
MAX_ATTRIBUTES = 20
MAX_STRING_LENGTH = 200
MAX_CONFIG_CODES = 500
MAX_CONFIG_VALUES = 100
MAX_INTEGER = 1_000_000_000
MAX_DEPTH = 8
MAX_NODES = 400_000
MAX_OBJECT_FIELDS = MAX_CONFIG_CODES
MAX_CANDIDATES = 20
ROW_KEYS = ("line_no", "field_key", "value_code", "value_int", "value_date", "value_text", "basis")
CONFIG_KEYS = ("saree_type_to_categories", "fabric_to_values", "colour_to_values")
LINE_KEYS = ("saree_type", "quantity", "fabric", "colour")
ORDER_KEYS = ("budget", "deadline", "delivery_city", "payment_terms")
CODE = re.compile(r"[a-z][a-z0-9_]{0,40}\Z", re.ASCII)
MESSAGES = {
    "INVALID_TYPE": "Input has an invalid type.",
    "OUT_OF_RANGE": "Input exceeds an allowed bound.",
    "INVALID_FIELDS": "Object fields do not match the schema.",
    "INVALID_CODE": "Code does not match the required format.",
    "INVALID_FIELD_KEY": "Field key is not allowed at this scope.",
    "INVALID_VALUE_SLOT": "Field values do not match the field key.",
    "INVALID_UNIT": "Unit must be piece, set or null.",
    "INVALID_DATE": "Date must be a valid ISO date.",
    "EMPTY_STRING": "Identifier or comparison value is empty.",
    "DUPLICATE_SKU": "Catalog SKU is duplicated.",
    "DUPLICATE_ATTRIBUTE": "Normalized attribute key is duplicated.",
}


class _Invalid(Exception):
    pass


def _typed(value, kind):
    if type(value) is not kind:
        raise _Invalid("INVALID_TYPE")


def _list(value, maximum):
    _typed(value, list)
    if len(value) > maximum:
        raise _Invalid("OUT_OF_RANGE")


def _fields(value, keys):
    _typed(value, dict)
    if value.keys() != set(keys):
        raise _Invalid("INVALID_FIELDS")


def _integer(value, minimum, maximum):
    _typed(value, int)
    if value < minimum or value > maximum:
        raise _Invalid("OUT_OF_RANGE")


def _norm(value):
    return " ".join(value.casefold().split())


def _text(value):
    _typed(value, str)
    if not _norm(value):
        raise _Invalid("EMPTY_STRING")


def _code(value):
    _typed(value, str)
    if not CODE.fullmatch(value):
        raise _Invalid("INVALID_CODE")


def _unit(value):
    if value is not None:
        _typed(value, str)
        if value not in ("piece", "set"):
            raise _Invalid("INVALID_UNIT")


def _bounded(r):
    """Preflight collection sizes before item validation, sorting or hashing."""
    _typed(r, dict)
    for key, maximum in (("fields", MAX_FIELDS), ("catalog", MAX_PRODUCTS)):
        if key in r:
            _list(r[key], maximum)
    if "config" in r:
        _typed(r["config"], dict)
        for mapping in r["config"].values():
            _typed(mapping, dict)
            if len(mapping) > MAX_CONFIG_CODES:
                raise _Invalid("OUT_OF_RANGE")
            for values in mapping.values():
                _list(values, MAX_CONFIG_VALUES)
    if "catalog" in r:
        for product in r["catalog"]:
            _typed(product, dict)
            if "attributes" in product:
                _typed(product["attributes"], dict)
                if len(product["attributes"]) > MAX_ATTRIBUTES:
                    raise _Invalid("OUT_OF_RANGE")
    pending, count = [(r, 0)], 0
    while pending:
        value, depth = pending.pop()
        count += 1
        if depth > MAX_DEPTH or count > MAX_NODES:
            raise _Invalid("OUT_OF_RANGE")
        if type(value) is int:
            if value < -MAX_INTEGER or value > MAX_INTEGER:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is str:
            if len(value) > MAX_STRING_LENGTH:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is list:
            _list(value, MAX_PRODUCTS)
            pending.extend((item, depth + 1) for item in value)
        elif type(value) is dict:
            if len(value) > MAX_OBJECT_FIELDS:
                raise _Invalid("OUT_OF_RANGE")
            for key, item in value.items():
                _typed(key, str)
                if len(key) > MAX_STRING_LENGTH:
                    raise _Invalid("OUT_OF_RANGE")
                pending.append((item, depth + 1))
        elif type(value) not in (bool, type(None)):
            raise _Invalid("INVALID_TYPE")


def canonical_json(value):
    """Canonical sorted compact ASCII JSON; integers only, no floating point."""
    def check(item):
        if type(item) in (str, int, bool, type(None)):
            return
        if type(item) is list:
            for child in item:
                check(child)
        elif type(item) is dict:
            for key, child in item.items():
                _typed(key, str)
                check(child)
        else:
            raise _Invalid("INVALID_TYPE")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _validate(r):
    _fields(r, ("fields", "catalog", "config"))
    _fields(r["config"], CONFIG_KEYS)
    for mapping in r["config"].values():
        for code, values in mapping.items():
            _code(code)
            for value in values:
                _text(value)
    for row in r["fields"]:
        _fields(row, ROW_KEYS)
        _typed(row["field_key"], str)
        if row["line_no"] is not None:
            _integer(row["line_no"], 1, MAX_LINES)
        keys = ORDER_KEYS if row["line_no"] is None else LINE_KEYS
        if row["field_key"] not in keys:
            raise _Invalid("INVALID_FIELD_KEY")
        for key in ("value_code", "value_date", "value_text", "basis"):
            if row[key] is not None:
                _typed(row[key], str)
        if row["value_int"] is not None:
            _integer(row["value_int"], 0, MAX_INTEGER)
        if row["value_code"] is not None:
            _code(row["value_code"])
        if row["value_date"] is not None:
            try:
                if date.fromisoformat(row["value_date"]).isoformat() != row["value_date"]:
                    raise ValueError()
            except ValueError:
                raise _Invalid("INVALID_DATE") from None
        key = row["field_key"]
        slot = ("value_code" if key in ("saree_type", "fabric", "colour") else
                "value_int" if key in ("quantity", "budget") else
                "value_date" if key == "deadline" else "value_text")
        if any(row[k] is not None for k in ("value_code", "value_int", "value_date", "value_text") if k != slot):
            raise _Invalid("INVALID_VALUE_SLOT")
        if row["line_no"] is not None:
            if key == "quantity":
                _unit(row["basis"])
                if row["value_int"] is not None:
                    _integer(row["value_int"], 1, MAX_QUANTITY)
            elif row["basis"] is not None:
                raise _Invalid("INVALID_VALUE_SLOT")
    seen = set()
    for product in r["catalog"]:
        _fields(product, ("sku", "category", "attributes", "active", "sale_unit"))
        _text(product["sku"])
        _text(product["category"])
        _typed(product["active"], bool)
        _unit(product["sale_unit"])
        sku = _norm(product["sku"])
        if sku in seen:
            raise _Invalid("DUPLICATE_SKU")
        seen.add(sku)
        attributes = set()
        for key, value in product["attributes"].items():
            _text(key)
            _text(value)
            if _norm(key) in attributes:
                raise _Invalid("DUPLICATE_ATTRIBUTE")
            attributes.add(_norm(key))


def _hash(r):
    # Lists of rows/products are unordered snapshots. Preserve raw leaf values.
    inputs = {"fields": sorted(r["fields"], key=canonical_json),
              "catalog": sorted(r["catalog"], key=lambda p: p["sku"]),
              "config": {key: {code: sorted(values) for code, values in mapping.items()}
                         for key, mapping in r["config"].items()}}
    return hashlib.sha256(canonical_json({"mapper_version": MAPPER_VERSION, "inputs": inputs}).encode("utf-8")).hexdigest()


def _line(number, rows, catalog, config):
    slots = {}
    for row in rows:
        slots.setdefault(row["field_key"], []).append(row)
    duplicate = any(len(rows) > 1 for rows in slots.values())
    quantity_row = slots.get("quantity", [])
    quantity = quantity_row[0]["value_int"] if len(quantity_row) == 1 else None
    unit = quantity_row[0]["basis"] if len(quantity_row) == 1 else None

    def result(status, reason=None, products=(), alternatives=False):
        skus = sorted(p["sku"] for p in products)
        return {"line_no": number, "status": status, "reason": reason,
                "alternatives" if alternatives else "candidates": skus[:MAX_CANDIDATES],
                "truncated": len(skus) > MAX_CANDIDATES, "quantity": quantity, "unit": unit}

    if duplicate:
        return result("needs_input", "duplicate_slot")
    codes = {key: entries[0]["value_code"] for key, entries in slots.items() if key != "quantity"}
    if not codes.get("saree_type"):
        return result("needs_input", "missing_saree_type")
    if quantity is None:
        return result("needs_input", "missing_quantity")
    if unit is None:
        return result("needs_input", "missing_unit")
    if any(code == "other" for code in codes.values()):
        return result("needs_human", "other_value")
    if codes["saree_type"] not in config["saree_type_to_categories"]:
        return result("unmatched", "saree_type_not_mapped")
    categories = {_norm(v) for v in config["saree_type_to_categories"][codes["saree_type"]]}
    candidates = [p for p in catalog if p["active"] and _norm(p["category"]) in categories]
    if not candidates:
        return result("unmatched", "category", alternatives=True)
    for key, mapping in (("fabric", "fabric_to_values"), ("colour", "colour_to_values")):
        if codes.get(key) is not None:
            values = {_norm(v) for v in config[mapping].get(codes[key], [])}
            before = candidates
            candidates = [p for p in before if
                          any(_norm(k) == key and _norm(v) in values for k, v in p["attributes"].items())]
            if not candidates:
                return result("unmatched", key, before, alternatives=True)
    if len(candidates) == 1:
        product = candidates[0]
        if product["sale_unit"] is not None and product["sale_unit"] != unit:
            return result("needs_human", "unit_mismatch", candidates)
        return result("matched", products=candidates)
    return result("ambiguous", products=candidates)


def map_requirements(request):
    """Return proposals for a confirmed requirement snapshot; humans confirm all."""
    try:
        _bounded(request)
        _validate(request)
    except _Invalid as exc:
        code = str(exc)
        return {"status": "rejected", "codes": [code], "message": MESSAGES[code],
                "mapper_version": MAPPER_VERSION, "canonical_hash": None,
                "human_confirmation_required": True}
    order, grouped = [], {}
    for row in request["fields"]:
        if row["line_no"] is None:
            order.append(copy.deepcopy(row))
        else:
            grouped.setdefault(row["line_no"], []).append(row)
    lines = [_line(number, grouped[number], request["catalog"], request["config"])
             for number in sorted(grouped)]
    proposals, flags, seen = [], [], set()
    for line in lines:
        if line["status"] == "matched":
            sku = line["candidates"][0]
            proposals.append({"sku": sku, "qty": line["quantity"], "discount_bps": 0})
            if sku in seen and "duplicate_sku" not in flags:
                flags.append("duplicate_sku")
            seen.add(sku)
    return {"mapper_version": MAPPER_VERSION, "order": sorted(order, key=canonical_json),
            "lines": lines, "order_lines_proposal": proposals, "flags": flags,
            "human_confirmation_required": True, "canonical_hash": _hash(request)}
