"""The quote REQUEST BUILDER: from what a person confirmed (the requirement's lines, the picks) and what the owner published (a price list version, a policy version) to the
exact request the pinned engine runs on. Pure: no I/O, no clock (the caller gives the date).

THE CONTRACT with the database (app.quote_build, migration 20261016090100 and 20261017090000): create_quote_draft refuses (SM216) any request that is not the one the database
builds from its own sources, so this module must produce it BYTE for byte as JSON:
  * price_list  = the items of the ORDERED products only, sorted by sku in CODE POINT order (Python's default string order);
                  each {sku, name, unit_price, minimum_order_quantity, price_breaks [{min_qty, unit_price}] by min_qty, tax_bps}; never a cost;
  * order_lines = one {sku, qty} per requirement line, in LINE order, with no discount;
  * customer    = {kind: "new"} or {kind: "repeat", credit_limit: the policy's repeat credit limit};
  * policy      = {discount_ceiling_bps, shipping{flat_fee, tax_bps[, free_above]}, validity_days, payment_terms{new_advance_bps, repeat_advance_bps, net_days},
                  tax_mode: "exclusive", rounding_mode};
  * as_of       = the quote date (today in India), ISO.
The integration tests build requests with this module and with the database side by side and require them equal."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

SETTLED = ("confirmed", "corrected")
IST = timezone(
    timedelta(hours=5, minutes=30)
)  # India has no daylight saving: a fixed offset is the whole rule


def today_ist(now: datetime | None = None) -> date:
    """Today's calendar date in India (the date a quote is made on)."""
    return (now or datetime.now(UTC)).astimezone(IST).date()


@dataclass(frozen=True)
class PriceItem:
    product_id: str
    sku: str
    name: str
    sale_unit: str
    unit_price_paise: int
    minimum_order_quantity: int
    tax_bps: int
    breaks: tuple[tuple[int, int], ...] = ()  # (min_qty, unit_price_paise), ascending by min_qty


@dataclass(frozen=True)
class Policy:
    discount_ceiling_bps: int
    shipping_flat_fee_paise: int
    shipping_free_above_paise: int | None
    shipping_tax_bps: int
    validity_days: int
    new_advance_bps: int
    repeat_advance_bps: int
    net_days: int
    rounding_mode: str
    repeat_credit_limit_paise: int
    seller_state: str
    required_inputs: tuple[str, ...] = ("delivery_state",)


@dataclass(frozen=True)
class Pick:
    line_no: int
    product_id: str
    qty: int
    sale_unit: str


@dataclass
class Line:
    """One requirement line as the confirmed fields say it (requirement_v1: only confirmed or corrected fields are ever here)."""

    line_no: int
    saree_type: str | None = None
    quantity: int | None = None
    basis: str | None = None
    fabric: str | None = None
    colour: str | None = None

    @property
    def complete(self) -> bool:
        return self.saree_type is not None and self.quantity is not None

    @property
    def half_settled(self) -> bool:
        """Exactly one of saree type and quantity is settled: the database refuses such a quote (SM217), so does the builder."""
        return (self.saree_type is None) != (self.quantity is None)


@dataclass
class RequirementFacts:
    lines: list[Line] = field(default_factory=list)
    delivery_city: str | None = None
    payment_terms: dict[str, Any] | None = None
    deadline: str | None = None
    budget: dict[str, Any] | None = None


def requirement_facts(rows: list[dict[str, Any]]) -> RequirementFacts:
    """Group requirement rows into lines and order-level facts. ONLY a field a person confirmed or corrected counts (the database reads the same): a field an agent
    proposed and nobody reviewed, or one a person rejected, is never part of a quote."""
    by_line: dict[int, Line] = {}
    facts = RequirementFacts()
    settled = [r for r in rows if r.get("state") in SETTLED]
    for row in sorted(
        settled, key=lambda r: (r["line_no"] is not None, r["line_no"] or 0, str(r["field_key"]))
    ):
        key, line_no = row["field_key"], row["line_no"]
        if line_no is None:
            if key == "delivery_city":
                facts.delivery_city = row.get("value_text")
            elif key == "payment_terms":
                facts.payment_terms = {
                    "code": row.get("value_code"),
                    "number": row.get("value_int"),
                    "basis": row.get("basis"),
                }
            elif key == "deadline":
                facts.deadline = row.get("value_date")
            elif key == "budget":
                facts.budget = {"paise": row.get("value_int"), "basis": row.get("basis")}
            continue
        line = by_line.setdefault(line_no, Line(line_no=line_no))
        if key == "saree_type":
            line.saree_type = row.get("value_code")
        elif key == "quantity":
            line.quantity, line.basis = row.get("value_int"), row.get("basis")
        elif key == "fabric":
            line.fabric = row.get("value_code")
        elif key == "colour":
            line.colour = row.get("value_code")
    facts.lines = [by_line[n] for n in sorted(by_line)]
    return facts


def policy_json(policy: Policy) -> dict[str, Any]:
    shipping: dict[str, Any] = {
        "flat_fee": policy.shipping_flat_fee_paise,
        "tax_bps": policy.shipping_tax_bps,
    }
    if policy.shipping_free_above_paise is not None:
        shipping["free_above"] = policy.shipping_free_above_paise
    return {
        "discount_ceiling_bps": policy.discount_ceiling_bps,
        "shipping": shipping,
        "validity_days": policy.validity_days,
        "payment_terms": {
            "new_advance_bps": policy.new_advance_bps,
            "repeat_advance_bps": policy.repeat_advance_bps,
            "net_days": policy.net_days,
        },
        "tax_mode": "exclusive",
        "rounding_mode": policy.rounding_mode,
    }


class MissingInput(Exception):
    """A line has no pick, or its pick's product is not on the price list: nothing is guessed. `lines` names them."""

    def __init__(self, lines: list[int]) -> None:
        super().__init__("quote_input_missing")
        self.lines = lines


def quotable_lines(facts: RequirementFacts) -> list[Line]:
    """The lines a quote covers: those with a confirmed saree type AND quantity. (A line with only one of them cannot be quoted, and the database refuses a quote that
    has such a line: the person must settle it first.)"""
    return [line for line in facts.lines if line.complete]


def build_request(
    as_of: date,
    kind: str,
    facts: RequirementFacts,
    picks: list[Pick],
    items: dict[str, PriceItem],
    policy: Policy,
) -> dict[str, Any]:
    """The engine request for these sources. Raises MissingInput (a line without a pick or with an unpriced product) or ValueError for an impossible customer kind."""
    if kind not in ("new", "repeat"):
        raise ValueError("customer kind")
    by_line = {p.line_no: p for p in picks}
    half_settled = [line.line_no for line in facts.lines if line.half_settled]
    lines = quotable_lines(facts)
    missing = half_settled + [
        line.line_no
        for line in lines
        if line.line_no not in by_line or by_line[line.line_no].product_id not in items
    ]
    if missing or not lines:
        raise MissingInput(sorted(set(missing)) or [0])
    order_lines: list[dict[str, Any]] = []
    entries: dict[str, dict[str, Any]] = {}
    for line in lines:
        pick = by_line[line.line_no]
        item = items[pick.product_id]
        if item.sku in entries or item.sale_unit != pick.sale_unit:
            raise MissingInput([line.line_no])
        order_lines.append({"sku": item.sku, "qty": pick.qty})
        entries[item.sku] = {
            "sku": item.sku,
            "name": item.name,
            "unit_price": item.unit_price_paise,
            "minimum_order_quantity": item.minimum_order_quantity,
            "price_breaks": [{"min_qty": q, "unit_price": p} for q, p in sorted(item.breaks)],
            "tax_bps": item.tax_bps,
        }
    customer: dict[str, Any] = (
        {"kind": "new"}
        if kind == "new"
        else {"kind": "repeat", "credit_limit": policy.repeat_credit_limit_paise}
    )
    return {
        "as_of": as_of.isoformat(),
        "price_list": [
            entries[sku] for sku in sorted(entries)
        ],  # code point order, the engine's and the database's
        "customer": customer,
        "order_lines": order_lines,
        "policy": policy_json(policy),
    }
