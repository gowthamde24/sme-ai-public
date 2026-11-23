"""Pure plain-text quote rendering; approval and copying belong to humans."""
from datetime import date
import hashlib
import json
import re
import textwrap
import unicodedata

RENDERER_VERSION = "1.0.0"
MAX_WIDTH = 60
MAX_STRING = 200
MAX_LINES = 30
MAX_NOTES = 10
MAX_OUTPUT_LINES = 500
MAX_UNIT_PRICE = 100_000_000
MAX_QUANTITY = 10_000
MAX_RATE = 10_000
# The engine can multiply unit price by quantity and sum many lines.
MAX_AMOUNT = 2 * MAX_LINES * MAX_UNIT_PRICE * MAX_QUANTITY + 2 * MAX_UNIT_PRICE
MAX_TRACE = 300
MAX_TRACE_TEXT = 4_000
MAX_DEPTH = 10
MAX_NODES = 50_000
MAX_OBJECT_FIELDS = 40
EXPECTED_ENGINE_VERSION = "1.1.0"
HASH = re.compile(r"[0-9a-f]{64}\Z", re.ASCII)
MARKUP = str.maketrans({char: " " for char in "*_~`"})
LINE_KEYS = ("sku", "name", "quantity", "unit_price_applied", "price_break_applied",
             "line_subtotal", "discount", "net", "tax", "gross")
TOTAL_KEYS = ("subtotal", "discount", "net", "tax", "item_tax", "shipping_tax",
              "shipping", "shipping_gross", "total")
DISPLAY_KEYS = ("seller_name", "customer_name", "quote_ref", "issued_on", "valid_until",
                "line_labels", "payment_terms_text", "notes")
RULES = {
    "price.quantity_break": (("sku", "qty", "base_price", "applied", "unit_price"), ()),
    "quantity.minimum": (("sku", "qty", "minimum"), ()),
    "discount.ceiling": (("sku", "subtotal", "discount_bps", "ceiling_bps", "discount", "rounding"), ()),
    "tax.exclusive": (("sku", "discounted", "tax_bps", "net", "tax", "rounding"), ()),
    "tax.inclusive": (("sku", "discounted", "tax_bps", "net", "tax", "rounding"), ()),
    "margin.floor": (("sku", "net", "cost", "floor_bps"), ()),
    "shipping.net_threshold": (("net", "flat_fee", "shipping"), ("free_above", "tax_bps")),
    "shipping.tax.exclusive": (("fee", "tax_bps", "net", "tax", "gross", "rounding"), ()),
    "shipping.tax.inclusive": (("fee", "tax_bps", "net", "tax", "gross", "rounding"), ()),
    "credit.limit": (("balance", "credit_limit"), ()),
    "payment.terms": (("kind", "total", "advance_bps", "advance", "balance", "net_days", "due_date", "rounding"), ()),
    "quote.validity": (("as_of", "validity_days", "valid_until"), ()),
}


class _Invalid(Exception):
    pass


def _typed(value, kind):
    if type(value) is not kind:
        raise _Invalid("INVALID_TYPE")


def _integer(value, minimum=0, maximum=MAX_AMOUNT):
    _typed(value, int)
    if value < minimum or value > maximum:
        raise _Invalid("OUT_OF_RANGE")


def money(paise):
    """Format nonnegative integer paise as INR, using Indian digit grouping."""
    _integer(paise)
    rupees, fraction = divmod(paise, 100)
    digits = str(rupees)
    tail, head = digits[-3:], digits[:-3]
    groups = []
    while head:
        groups.insert(0, head[-2:])
        head = head[:-2]
    grouped = ",".join(groups + [tail])
    return "₹" + grouped + "." + str(fraction).zfill(2)


def rate(bps):
    """Basis points to an exact percentage, without floating point."""
    _integer(bps, 0, MAX_RATE)
    whole, fraction = divmod(bps, 100)
    return str(whole) + ("." + str(fraction).zfill(2).rstrip("0") if fraction else "") + "%"


def _string(value, maximum=MAX_STRING, allow_empty=False):
    _typed(value, str)
    if len(value) > maximum:
        raise _Invalid("OUT_OF_RANGE")
    if not allow_empty and not value.strip():
        raise _Invalid("EMPTY_STRING")
    if any(unicodedata.category(char) in ("Cc", "Cf", "Cs", "Zl", "Zp") for char in value):
        raise _Invalid("UNSAFE_STRING")


def _safe(value):
    return " ".join(value.translate(MARKUP).split())


def canonical_json(value):
    """Sorted compact ASCII JSON, strictly without floating point values."""
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


def _fields(value, required, optional=()):
    _typed(value, dict)
    if not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        raise _Invalid("INVALID_FIELDS")


def _list(value, maximum):
    _typed(value, list)
    if len(value) > maximum:
        raise _Invalid("OUT_OF_RANGE")


def _bounded(request):
    _typed(request, dict)
    q, d = request.get("quote", {}), request.get("display", {})
    _typed(q, dict)
    _typed(d, dict)
    for key, maximum in (("lines", MAX_LINES), ("trace", MAX_TRACE)):
        if key in q:
            _list(q[key], maximum)
    if "notes" in d:
        _list(d["notes"], MAX_NOTES)
    if "line_labels" in d:
        _typed(d["line_labels"], dict)
        if len(d["line_labels"]) > MAX_LINES:
            raise _Invalid("OUT_OF_RANGE")
    pending, count = [(request, (), 0)], 0
    while pending:
        value, path, depth = pending.pop()
        count += 1
        if depth > MAX_DEPTH or count > MAX_NODES:
            raise _Invalid("OUT_OF_RANGE")
        if type(value) is str:
            trace_text = len(path) == 4 and path[:2] == ("quote", "trace") and path[3] == "text"
            _string(value, MAX_TRACE_TEXT if trace_text else MAX_STRING, allow_empty=True)
        elif type(value) is int:
            if abs(value) > MAX_AMOUNT:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is list:
            _list(value, MAX_TRACE)
            pending.extend((item, path + (i,), depth + 1) for i, item in enumerate(value))
        elif type(value) is dict:
            if len(value) > MAX_OBJECT_FIELDS:
                raise _Invalid("OUT_OF_RANGE")
            for key, item in value.items():
                _string(key)
                pending.append((item, path + (key,), depth + 1))
        elif type(value) not in (bool, type(None)):
            raise _Invalid("INVALID_TYPE")


def _day(value):
    _string(value)
    try:
        result = date.fromisoformat(value)
        if result.isoformat() != value:
            raise ValueError()
        return result
    except ValueError:
        raise _Invalid("INVALID_DATE") from None


def _break(value):
    if value is not None:
        _fields(value, ("min_qty", "unit_price"))
        _integer(value["min_qty"], 1, MAX_QUANTITY)
        _integer(value["unit_price"], 0, MAX_UNIT_PRICE)


def _trace(q):
    indexed = {}
    for entry in q["trace"]:
        _fields(entry, ("rule_id", "inputs", "text"))
        rule = entry["rule_id"]
        _string(rule)
        if rule not in RULES:
            raise _Invalid("INVALID_FIELDS")
        _string(entry["text"], MAX_TRACE_TEXT)
        required, optional = RULES[rule]
        values = entry["inputs"]
        _fields(values, required, optional)
        for key, value in values.items():
            if key == "applied":
                _break(value)
            elif key in ("sku", "rounding", "kind", "as_of", "valid_until", "due_date"):
                _string(value)
                if key == "rounding" and value not in ("half_up", "half_even", "down"):
                    raise _Invalid("INVALID_QUOTE")
                if key == "kind" and value not in ("new", "repeat"):
                    raise _Invalid("INVALID_QUOTE")
                if key in ("as_of", "valid_until", "due_date"):
                    _day(value)
            elif key.endswith("_bps"):
                _integer(value, 0, MAX_RATE)
            elif key in ("qty", "minimum"):
                _integer(value, 1, MAX_QUANTITY)
            elif key in ("unit_price", "base_price", "flat_fee", "free_above", "fee"):
                _integer(value, 0, MAX_UNIT_PRICE)
            elif key == "net_days":
                _integer(value, 0, 180)
            elif key == "validity_days":
                _integer(value, 0, 365)
            else:
                _integer(value)
        identity = (rule, values.get("sku"))
        if identity in indexed:
            raise _Invalid("INVALID_QUOTE")
        indexed[identity] = values
    return indexed


def _validate(r):
    _fields(r, ("quote", "approved", "expected_engine_hash", "display"))
    _typed(r["approved"], bool)
    if not r["approved"]:
        raise _Invalid("NOT_APPROVED")
    q, d = r["quote"], r["display"]
    _string(q.get("status"))
    if q["status"] != "draft":
        raise _Invalid("NOT_APPROVED")
    _fields(q, ("status", "engine_version", "canonical_hash", "lines", "totals", "valid_until", "flags", "trace"), ("payment_terms",))
    for digest in (q["canonical_hash"], r["expected_engine_hash"]):
        _string(digest)
        if not HASH.fullmatch(digest):
            raise _Invalid("HASH_MISMATCH")
    if q["canonical_hash"] != r["expected_engine_hash"]:
        raise _Invalid("HASH_MISMATCH")
    _string(q["engine_version"])
    if q["engine_version"] != EXPECTED_ENGINE_VERSION:
        raise _Invalid("UNSUPPORTED_ENGINE")
    _fields(d, DISPLAY_KEYS)
    for key in DISPLAY_KEYS:
        if key not in ("line_labels", "notes"):
            _string(d[key])
            if not _safe(d[key]):
                raise _Invalid("EMPTY_STRING")
    issued, valid = _day(d["issued_on"]), _day(d["valid_until"])
    if valid < issued or d["valid_until"] != q["valid_until"]:
        raise _Invalid("DATE_MISMATCH")
    for value in list(d["line_labels"].values()) + d["notes"]:
        _string(value)
        if not _safe(value):
            raise _Invalid("EMPTY_STRING")
    if not q["lines"]:
        raise _Invalid("INVALID_QUOTE")
    seen = set()
    for line in q["lines"]:
        _fields(line, LINE_KEYS)
        _string(line["sku"])
        _string(line["name"])
        if line["sku"] in seen:
            raise _Invalid("INVALID_QUOTE")
        seen.add(line["sku"])
        _integer(line["quantity"], 1, MAX_QUANTITY)
        _integer(line["unit_price_applied"], 0, MAX_UNIT_PRICE)
        _break(line["price_break_applied"])
        for key in ("line_subtotal", "discount", "net", "tax", "gross"):
            _integer(line[key])
        if line["line_subtotal"] != line["quantity"] * line["unit_price_applied"] or line["discount"] > line["line_subtotal"] or line["gross"] != line["net"] + line["tax"]:
            raise _Invalid("INVALID_QUOTE")
    if d["line_labels"].keys() != seen:
        raise _Invalid("INVALID_FIELDS")
    t = q["totals"]
    _fields(t, TOTAL_KEYS)
    for value in t.values():
        _integer(value)
    for total_key, line_key in (("subtotal", "line_subtotal"), ("discount", "discount"), ("net", "net"), ("item_tax", "tax")):
        if t[total_key] != sum(line[line_key] for line in q["lines"]):
            raise _Invalid("INVALID_QUOTE")
    if t["tax"] != t["item_tax"] + t["shipping_tax"] or t["shipping_gross"] != t["shipping"] + t["shipping_tax"] or t["total"] != t["net"] + t["shipping"] + t["tax"]:
        raise _Invalid("INVALID_QUOTE")
    if "payment_terms" in q:
        terms = q["payment_terms"]
        _fields(terms, ("advance_amount", "balance", "due_date"))
        _integer(terms["advance_amount"])
        _integer(terms["balance"])
        if terms["advance_amount"] + terms["balance"] != t["total"]:
            raise _Invalid("INVALID_QUOTE")
        if _day(terms["due_date"]) < issued:
            raise _Invalid("DATE_MISMATCH")
    _fields(q["flags"], ("needs_owner_approval", "reasons"))
    _typed(q["flags"]["needs_owner_approval"], bool)
    _list(q["flags"]["reasons"], 4 * MAX_LINES + 1)
    for reason in q["flags"]["reasons"]:
        _typed(reason, dict)
        if reason.get("code") in ("DISCOUNT_ABOVE_CEILING", "BELOW_MINIMUM_ORDER_QUANTITY", "MARGIN_BELOW_FLOOR"):
            _fields(reason, ("code", "sku"))
            _string(reason["sku"])
            if reason["sku"] not in seen:
                raise _Invalid("INVALID_QUOTE")
        elif reason.get("code") == "CREDIT_LIMIT_EXCEEDED":
            _fields(reason, ("code", "balance", "credit_limit"))
            _integer(reason["balance"])
            _integer(reason["credit_limit"], 0, 1_000_000_000)
        else:
            raise _Invalid("INVALID_FIELDS")
    if q["flags"]["needs_owner_approval"] != bool(q["flags"]["reasons"]):
        raise _Invalid("INVALID_QUOTE")
    traces = _trace(q)
    if any(sku is not None and sku not in seen for rule, sku in traces):
        raise _Invalid("INVALID_QUOTE")
    validity = traces.get(("quote.validity", None))
    if not validity or validity["as_of"] != d["issued_on"] or validity["valid_until"] != q["valid_until"]:
        raise _Invalid("DATE_MISMATCH")
    shipping = [(rule, values) for (rule, sku), values in traces.items() if rule.startswith("shipping.tax.")]
    if len(shipping) != 1:
        raise _Invalid("INVALID_QUOTE")
    mode = shipping[0][0].rsplit(".", 1)[1]
    freight = shipping[0][1]
    if (freight["net"], freight["tax"], freight["gross"]) != (t["shipping"], t["shipping_tax"], t["shipping_gross"]):
        raise _Invalid("INVALID_QUOTE")
    for line in q["lines"]:
        tax = traces.get(("tax." + mode, line["sku"]))
        discount = traces.get(("discount.ceiling", line["sku"]))
        if not tax or not discount:
            raise _Invalid("INVALID_QUOTE")
        if (tax["net"], tax["tax"], tax["discounted"]) != (line["net"], line["tax"], line["line_subtotal"] - line["discount"]):
            raise _Invalid("INVALID_QUOTE")
        if (discount["subtotal"], discount["discount"]) != (line["line_subtotal"], line["discount"]):
            raise _Invalid("INVALID_QUOTE")
        if line["gross"] != line["line_subtotal"] - line["discount"] + (line["tax"] if mode == "exclusive" else 0):
            raise _Invalid("INVALID_QUOTE")
    return traces, mode


def render(request):
    """Render a lane-A-approved engine result; never approve or send anything."""
    try:
        _bounded(request)
        traces, mode = _validate(request)
    except _Invalid as exc:
        code = str(exc)
        message = {"NOT_APPROVED": "Quote is not approved.",
                   "HASH_MISMATCH": "Quote hash does not match approval."}.get(code, "Invalid quote text request.")
        return {"status": "rejected", "code": code, "message": message}
    q, d = request["quote"], request["display"]
    output = []

    def display(text):
        output.extend(textwrap.wrap(text, width=MAX_WIDTH, break_long_words=True,
                                    break_on_hyphens=False) or [""])

    def amount(label, value):
        # Amount tokens are shorter than MAX_WIDTH and never split across lines.
        output.extend(textwrap.wrap(label + ": " + money(value), width=MAX_WIDTH,
                                    break_long_words=False, break_on_hyphens=False))

    display("Approved quote")
    for label, key in (("Seller", "seller_name"), ("Customer", "customer_name"),
                       ("Reference", "quote_ref"), ("Issued", "issued_on"), ("Valid until", "valid_until")):
        display(label + ": " + _safe(d[key]))
    display("Prices include GST" if mode == "inclusive" else "Prices exclude GST")
    for line in q["lines"]:
        display("")
        display(_safe(d["line_labels"][line["sku"]]))
        display(str(line["quantity"]) + " x " + money(line["unit_price_applied"]) + " = " + money(line["line_subtotal"]))
        if line["discount"]:
            amount("Discount (" + rate(traces[("discount.ceiling", line["sku"])]["discount_bps"]) + ")", line["discount"])
        amount("Net", line["net"])
        amount("GST (" + rate(traces[("tax." + mode, line["sku"])]["tax_bps"]) + ")", line["tax"])
        amount("Line total", line["gross"])
    display("")
    t = q["totals"]
    amount("Merchandise subtotal", t["subtotal"])
    if t["discount"]:
        amount("Discounts", t["discount"])
    amount("Merchandise net", t["net"])
    amount("GST on merchandise", t["item_tax"])
    amount("Shipping net", t["shipping"])
    amount("GST on shipping (" + rate(traces[("shipping.tax." + mode, None)]["tax_bps"]) + ")", t["shipping_tax"])
    amount("Shipping total", t["shipping_gross"])
    amount("GST total", t["tax"])
    amount("Grand total", t["total"])
    if "payment_terms" in q:
        terms = q["payment_terms"]
        amount("Advance", terms["advance_amount"])
        amount("Balance", terms["balance"])
        display("Balance due: " + terms["due_date"])
    display("Valid until: " + d["valid_until"])
    display("Payment terms: " + _safe(d["payment_terms_text"]))
    if d["notes"]:
        display("Notes:")
        for note in d["notes"]:
            display("- " + _safe(note))
    if len(output) > MAX_OUTPUT_LINES or any(len(line) > MAX_WIDTH for line in output):
        return {"status": "rejected", "code": "OUT_OF_RANGE", "message": "Invalid quote text request."}
    text = "\n".join(output)
    digest = hashlib.sha256(canonical_json({"renderer_version": RENDERER_VERSION,
                                          "inputs": request}).encode("utf-8")).hexdigest()
    return {"text": text, "line_count": len(output), "canonical_hash": digest}
