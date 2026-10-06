"""Builds the requests of the golden vectors (fixtures/golden_*.json) from their small description.

Not a test module. A vector lists product names (one order line each) and optional display strings; the
quote itself is priced by the real engine, as in test_quote_text.request.
"""
import copy
import json
from pathlib import Path

from test_quote_text import fixture, request

FIXTURES = Path(__file__).parent / "fixtures"
# Where a string can sit in a request: the engine's product name, and every display string.
LOCATIONS = ("line_name", "line_label", "seller_name", "customer_name", "quote_ref",
             "payment_terms_text", "note")


def load(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def build(names, display=None):
    """A rendered-quote request with one order line per product name; `display` overrides display keys."""
    source = fixture()["engine_request"]
    source["price_list"], source["order_lines"] = [], []
    source["policy"]["discount_ceiling_bps"] = 10000
    for i, name in enumerate(names):
        sku = "SYN-TEXT-" + str(i)
        source["price_list"].append({"sku": sku, "name": name, "unit_price": 12345 + 100 * i,
                                     "minimum_order_quantity": 1, "price_breaks": [], "tax_bps": 1250})
        source["order_lines"].append({"sku": sku, "qty": 2 + i, "discount_bps": 500 * (i % 2)})
    r = request(source)
    for line in r["quote"]["lines"]:
        r["display"]["line_labels"][line["sku"]] = line["name"]
    r["display"].update(copy.deepcopy(display or {}))
    return r


def place(value, location):
    """A valid request with `value` in one location."""
    r = build(["Synthetic weave"])
    if location == "line_name":
        r = build([value])
        r["display"]["line_labels"]["SYN-TEXT-0"] = "Synthetic weave"
    elif location == "line_label":
        r["display"]["line_labels"]["SYN-TEXT-0"] = value
    elif location == "note":
        r["display"]["notes"] = [value]
    else:
        r["display"][location] = value
    return r
