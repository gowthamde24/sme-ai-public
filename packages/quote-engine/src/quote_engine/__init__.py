"""Pure synthetic quote calculation; see docs/plans/t009-quote-engine.md."""
from datetime import date, timedelta
import hashlib
import json

ENGINE_VERSION = "1.0.0"


def canonical_json(value):
    """Canonical UTF-8 JSON text; no floating point values are accepted."""
    _json_types(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _json_types(value):
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


def _typed(value, kind):
    if type(value) is not kind:
        raise TypeError("Expected " + kind.__name__)
    return value


class _Invalid(Exception):
    pass


def _fields(obj, required, optional=()):
    _typed(obj, dict)
    if not set(required) <= obj.keys() or obj.keys() - set(required) - set(optional):
        raise _Invalid("INVALID_FIELDS")


def _integer(value, minimum=0, maximum=None):
    _typed(value, int)
    if value < minimum or (maximum is not None and value > maximum):
        raise _Invalid("OUT_OF_RANGE")
    return value


def _choice(value, choices):
    _typed(value, str)
    if value not in choices:
        raise _Invalid("INVALID_CHOICE")


def _validate(r):
    _fields(r, ("as_of", "price_list", "customer", "order_lines", "policy"))
    _typed(r["as_of"], str)
    try:
        day = date.fromisoformat(r["as_of"])
        if day.isoformat() != r["as_of"]:
            raise ValueError()
    except ValueError:
        raise _Invalid("INVALID_DATE") from None
    _typed(r["price_list"], list)
    catalog = {}
    for item in r["price_list"]:
        _fields(item, ("sku", "name", "unit_price", "minimum_order_quantity", "price_breaks", "tax_bps"), ("cost",))
        for key in ("sku", "name"):
            _typed(item[key], str)
            if not item[key]:
                raise _Invalid("EMPTY_IDENTIFIER")
        if item["sku"] in catalog:
            raise _Invalid("DUPLICATE_SKU")
        catalog[item["sku"]] = item
        _integer(item["unit_price"])
        _integer(item["minimum_order_quantity"], 1)
        _integer(item["tax_bps"])
        if "cost" in item:
            _integer(item["cost"])
        _typed(item["price_breaks"], list)
        previous_qty, previous_price = 0, item["unit_price"]
        for br in item["price_breaks"]:
            _fields(br, ("min_qty", "unit_price"))
            qty = _integer(br["min_qty"], 1)
            price = _integer(br["unit_price"])
            if qty <= previous_qty or price > previous_price:
                raise _Invalid("INVALID_PRICE_BREAKS")
            previous_qty, previous_price = qty, price
    c, p = r["customer"], r["policy"]
    _fields(c, ("kind",), ("credit_limit",))
    _choice(c["kind"], ("new", "repeat"))
    if "credit_limit" in c:
        _integer(c["credit_limit"])
    _fields(p, ("discount_ceiling_bps", "shipping", "validity_days", "payment_terms", "tax_mode"), ("rounding_mode", "margin_floor_bps"))
    _integer(p["discount_ceiling_bps"], 0, 10000)
    _integer(p["validity_days"])
    _choice(p["tax_mode"], ("exclusive", "inclusive"))
    _choice(p.get("rounding_mode", "half_up"), ("half_up", "half_even", "down"))
    if "margin_floor_bps" in p:
        _integer(p["margin_floor_bps"], 0, 10000)
        if any("cost" not in item for item in catalog.values()):
            raise _Invalid("MISSING_COST")
    _fields(p["shipping"], ("flat_fee",), ("free_above",))
    for value in p["shipping"].values():
        _integer(value)
    _fields(p["payment_terms"], ("new_advance_bps", "repeat_advance_bps", "net_days"))
    for key in ("new_advance_bps", "repeat_advance_bps"):
        _integer(p["payment_terms"][key], 0, 10000)
    _integer(p["payment_terms"]["net_days"])
    try:
        day + timedelta(days=max(p["validity_days"], p["payment_terms"]["net_days"]))
    except OverflowError:
        raise _Invalid("DATE_OVERFLOW") from None
    _typed(r["order_lines"], list)
    if not r["order_lines"]:
        raise _Invalid("EMPTY_ORDER")
    seen = set()
    for line in r["order_lines"]:
        _fields(line, ("sku", "qty"), ("discount_bps",))
        _typed(line["sku"], str)
        _integer(line["qty"], 1)
        _integer(line.get("discount_bps", 0), 0, 10000)
        if line["sku"] in seen:
            raise _Invalid("DUPLICATE_ORDER_SKU")
        seen.add(line["sku"])
    return day, catalog


def quote(request):
    """Return a Quote or structured Rejection dict; only wrong types raise."""
    payload = canonical_json({"engine_version": ENGINE_VERSION, "inputs": request})
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    reasons, trace = [], []

    def flag(code, **numbers):
        reasons.append({"code": code, **numbers})

    def rule(rule_id, **numbers):
        trace.append({"rule_id": rule_id, "inputs": numbers,
                      "text": rule_id + ": " + canonical_json(numbers)})

    def rejection(codes):
        return {"status": "rejected", "codes": codes, "engine_version": ENGINE_VERSION,
                "canonical_hash": digest, "flags": {"needs_owner_approval": bool(reasons), "reasons": reasons}, "trace": trace}

    try:
        day, catalog = _validate(request)
    except _Invalid as exc:
        return rejection([str(exc)])
    unknown = [line["sku"] for line in request["order_lines"] if line["sku"] not in catalog]
    if unknown:
        for sku in unknown:
            flag("UNKNOWN_SKU", sku=sku)
            rule("catalog.unknown", sku=sku)
        return rejection(["UNKNOWN_SKU"])
    p = request["policy"]
    mode = p.get("rounding_mode", "half_up")

    def rounded(numerator, denominator):
        whole, remainder = divmod(numerator, denominator)
        if mode == "down":
            return whole
        return whole + int(2 * remainder > denominator or
                           (2 * remainder == denominator and (mode == "half_up" or whole % 2 == 1)))

    lines = []
    for requested in request["order_lines"]:
        sku, qty = requested["sku"], requested["qty"]
        item = catalog[sku]
        price, applied = item["unit_price"], None
        for br in item["price_breaks"]:
            if qty >= br["min_qty"]:
                price, applied = br["unit_price"], dict(br)
        rule("price.quantity_break", sku=sku, qty=qty, base_price=item["unit_price"], applied=applied, unit_price=price)
        rule("quantity.minimum", sku=sku, qty=qty, minimum=item["minimum_order_quantity"])
        if qty < item["minimum_order_quantity"]:
            flag("BELOW_MINIMUM_ORDER_QUANTITY", sku=sku)
        rate = requested.get("discount_bps", 0)
        subtotal = price * qty
        discount = rounded(subtotal * rate, 10000)
        discounted = subtotal - discount
        rule("discount.ceiling", sku=sku, subtotal=subtotal, discount_bps=rate, ceiling_bps=p["discount_ceiling_bps"], discount=discount, rounding=mode)
        if rate > p["discount_ceiling_bps"]:
            flag("DISCOUNT_ABOVE_CEILING", sku=sku)
        tax_rate = item["tax_bps"]
        if p["tax_mode"] == "exclusive":
            net = discounted
            tax = rounded(net * tax_rate, 10000)
        else:
            net = rounded(discounted * 10000, 10000 + tax_rate)
            tax = discounted - net
        rule("tax." + p["tax_mode"], sku=sku, discounted=discounted, tax_bps=tax_rate, net=net, tax=tax, rounding=mode)
        if "margin_floor_bps" in p:
            cost = item["cost"] * qty
            floor = p["margin_floor_bps"]
            rule("margin.floor", sku=sku, net=net, cost=cost, floor_bps=floor)
            if (net - cost) * 10000 < net * floor:
                flag("MARGIN_BELOW_FLOOR", sku=sku)
        lines.append({"sku": sku, "name": item["name"], "quantity": qty,
                      "unit_price_applied": price, "price_break_applied": applied,
                      "line_subtotal": subtotal, "discount": discount, "net": net,
                      "tax": tax, "gross": net + tax})
    net = sum(line["net"] for line in lines)
    tax = sum(line["tax"] for line in lines)
    shipping_rule = p["shipping"]
    shipping = shipping_rule["flat_fee"]
    if "free_above" in shipping_rule and net > shipping_rule["free_above"]:
        shipping = 0
    rule("shipping.net_threshold", net=net, **shipping_rule, shipping=shipping)
    total = net + tax + shipping
    customer, terms = request["customer"], p["payment_terms"]
    advance_bps = terms[customer["kind"] + "_advance_bps"]
    advance = rounded(total * advance_bps, 10000)
    balance = total - advance
    if customer["kind"] == "repeat":
        limit = customer.get("credit_limit", 0)
        rule("credit.limit", balance=balance, credit_limit=limit)
        if balance > limit:
            flag("CREDIT_LIMIT_EXCEEDED", balance=balance, credit_limit=limit)
    due = (day + timedelta(days=terms["net_days"])).isoformat()
    valid = (day + timedelta(days=p["validity_days"])).isoformat()
    rule("payment.terms", kind=customer["kind"], total=total, advance_bps=advance_bps, advance=advance, balance=balance, net_days=terms["net_days"], due_date=due, rounding=mode)
    rule("quote.validity", as_of=day.isoformat(), validity_days=p["validity_days"], valid_until=valid)
    return {"status": "draft", "engine_version": ENGINE_VERSION, "canonical_hash": digest,
            "lines": lines, "totals": {"subtotal": sum(line["line_subtotal"] for line in lines),
            "discount": sum(line["discount"] for line in lines), "net": net,
            "tax": tax, "shipping": shipping, "total": total},
            "payment_terms": {"advance_amount": advance, "balance": balance, "due_date": due},
            "valid_until": valid, "flags": {"needs_owner_approval": bool(reasons), "reasons": reasons}, "trace": trace}
