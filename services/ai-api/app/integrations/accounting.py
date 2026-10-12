"""The accounting view of one export window: from the rows the database returned (`public.export_accounting_data`), build SALES (one per accepted order) and PAYMENTS, each with its GST split.
Pure and deterministic: no database, no clock, integer paise throughout; the files (Tally XML, Vyapar workbook, CSV, XLSX) are all written from this one structure so they cannot disagree.

GST: the quote carries the item tax, the shipping tax and the supply type (intra_state or inter_state). The tax is grouped by RATE (each quote line has a rate in basis points; the shipping rate is
derived from its tax and net). For an intra-state supply every rate's tax is split half CGST and half SGST (an odd paisa goes to SGST); for an inter-state supply it is IGST. The party is debited the
ORDER TOTAL; sales, freight and the tax ledgers are credited; any difference between the order total and the sum of those (a manual price with a rounded total, say) goes to a Round Off line, so a
voucher always balances to the paisa. A customer's GSTIN and the shop's own (job CA) come with the data and are written where the file format has a place for them (CSV, XLSX, Vyapar); the Tally files do not carry them (see tally.py)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app import gstin as gstin_module
from app.integrations.indian import percent

SALES_LEDGER = "Sales"
FREIGHT_LEDGER = "Freight Charges"
ROUND_LEDGER = "Round Off"
CASH_LEDGER = "Cash"
TAX_PARENT = "Duties & Taxes"


@dataclass(frozen=True)
class TaxLine:
    ledger: str  # e.g. "Output CGST @ 2.5%"
    kind: str  # cgst | sgst | igst
    bps: int  # the full GST rate, e.g. 500
    paise: int


@dataclass(frozen=True)
class Line:
    name: str
    sku: str
    unit: str
    qty: int
    unit_price_paise: int
    net_paise: int
    tax_paise: int
    tax_bps: int


@dataclass
class Sale:
    order_id: str
    order_no: int
    quote_no: int
    voucher_no: str
    date: str  # ISO, the India date of the acceptance
    party: str
    city: str | None
    state_code: str  # the delivery state, two letters as the quote holds it
    supply: str  # intra_state | inter_state
    merchandise_net_paise: int
    shipping_net_paise: int
    tax_lines: list[TaxLine]
    round_off_paise: int  # may be negative
    total_paise: int
    lines: list[Line] = field(default_factory=list)
    gstin: str = ""

    @property
    def tax_paise(self) -> int:
        return sum(t.paise for t in self.tax_lines)

    def check(self) -> bool:
        """The credit side equals the debit side."""
        return self.merchandise_net_paise + self.shipping_net_paise + self.tax_paise + self.round_off_paise == self.total_paise


@dataclass(frozen=True)
class Payment:
    payment_id: str
    order_no: int
    voucher_no: str
    sale_voucher_no: str
    date: str
    party: str
    kind: str  # payment (money in) | refund (money out)
    amount_paise: int
    gstin: str = ""


@dataclass
class Accounting:
    date_from: str
    date_to: str
    sales: list[Sale]
    payments: list[Payment]
    shop_gstin: str = ""

    def party_gstins(self) -> dict[str, str]:
        """The GSTIN of every party that has one in the window, by party name."""
        found: dict[str, str] = {}
        parties: list[tuple[str, str]] = [(s.party, s.gstin) for s in self.sales] + [(p.party, p.gstin) for p in self.payments]
        for name, gstin in parties:
            if gstin:
                found.setdefault(name, gstin)
        return found

    def parties(self) -> list[tuple[str, str | None]]:
        """Every distinct party (name, city) in the window, by name."""
        seen: dict[str, str | None] = {}
        for s in self.sales:
            seen.setdefault(s.party, s.city)
        for p in self.payments:
            seen.setdefault(p.party, None)
        return sorted(seen.items(), key=lambda kv: kv[0].lower())

    def tax_ledgers(self) -> list[tuple[str, str, int]]:
        """(ledger name, kind, full rate bps) of every GST ledger the window uses, in a stable order."""
        found: dict[str, tuple[str, int]] = {}
        for s in self.sales:
            for t in s.tax_lines:
                found.setdefault(t.ledger, (t.kind, t.bps))
        return sorted(((name, kind, bps) for name, (kind, bps) in found.items()), key=lambda x: (x[1], x[2], x[0]))

    def uses_freight(self) -> bool:
        return any(s.shipping_net_paise > 0 for s in self.sales)

    def uses_round_off(self) -> bool:
        return any(s.round_off_paise != 0 for s in self.sales)


def _gstin(value: object) -> str:
    """A GSTIN as the database gave it, only if it is well formed (a file never carries a number the application would refuse)."""
    return value if isinstance(value, str) and gstin_module.is_valid(value) else ""


def sale_voucher_no(order_no: int) -> str:
    return f"SO-{order_no:05d}"


def _tax_ledger(kind: str, bps: int) -> str:
    head = {"cgst": "Output CGST", "sgst": "Output SGST", "igst": "Output IGST"}[kind]
    rate = bps // 2 if kind in ("cgst", "sgst") else bps
    return f"{head} @ {percent(rate)}%"


def _buckets(order: dict[str, Any]) -> dict[int, int]:
    """Tax by full GST rate (bps). The quote's header figures are authoritative for the TOTAL tax; the lines say how it is spread over rates. Any difference is put on the highest rate."""
    by_rate: dict[int, int] = {}
    for ln in order.get("lines") or []:
        by_rate[int(ln["tax_bps"])] = by_rate.get(int(ln["tax_bps"]), 0) + int(ln["tax_paise"])
    ship_net, ship_tax = int(order.get("shipping_net_paise") or 0), int(order.get("shipping_tax_paise") or 0)
    if ship_tax > 0:
        rate = round(ship_tax * 10000 / ship_net) if ship_net > 0 else (max(by_rate) if by_rate else 0)
        by_rate[rate] = by_rate.get(rate, 0) + ship_tax
    total_tax = int(order.get("item_tax_paise") or 0) + ship_tax
    drift = total_tax - sum(by_rate.values())
    if drift != 0:
        top = max(by_rate) if by_rate else 0
        by_rate[top] = by_rate.get(top, 0) + drift
    return {bps: paise for bps, paise in by_rate.items() if paise != 0}


def build_sale(order: dict[str, Any]) -> Sale:
    supply = str(order.get("gst_supply") or "intra_state")
    tax_lines: list[TaxLine] = []
    for bps, paise in sorted(_buckets(order).items()):
        if supply == "inter_state":
            tax_lines.append(TaxLine(_tax_ledger("igst", bps), "igst", bps, paise))
        else:
            cgst = paise // 2
            tax_lines.append(TaxLine(_tax_ledger("cgst", bps), "cgst", bps, cgst))
            tax_lines.append(TaxLine(_tax_ledger("sgst", bps), "sgst", bps, paise - cgst))
    merch, ship = int(order.get("merchandise_net_paise") or 0), int(order.get("shipping_net_paise") or 0)
    total = int(order["total_paise"])
    tax = sum(t.paise for t in tax_lines)
    return Sale(
        order_id=str(order["order_id"]),
        order_no=int(order["order_no"]),
        quote_no=int(order.get("quote_no") or 0),
        voucher_no=sale_voucher_no(int(order["order_no"])),
        date=str(order["accepted_on"]),
        party=str(order.get("party") or "Walk-in customer"),
        city=order.get("city"),
        gstin=_gstin(order.get("gstin")),
        state_code=str(order.get("delivery_state") or ""),
        supply=supply,
        merchandise_net_paise=merch,
        shipping_net_paise=ship,
        tax_lines=tax_lines,
        round_off_paise=total - (merch + ship + tax),
        total_paise=total,
        lines=[
            Line(str(x["name"]), str(x["sku"]), str(x["sale_unit"]), int(x["qty"]), int(x["unit_price_paise"]), int(x["net_paise"]), int(x["tax_paise"]), int(x["tax_bps"]))
            for x in (order.get("lines") or [])
        ],
    )


def build(payload: dict[str, Any]) -> Accounting:
    sales = [build_sale(o) for o in payload.get("orders", [])]
    payments = [
        Payment(
            payment_id=str(p["payment_id"]),
            order_no=int(p["order_no"]),
            voucher_no=f"{'RC' if p['kind'] == 'payment' else 'PY'}-{int(p['order_no']):05d}-{str(p['payment_id'])[:8]}",
            sale_voucher_no=sale_voucher_no(int(p["order_no"])),
            date=str(p["occurred_on"]),
            party=str(p.get("party") or "Walk-in customer"),
            kind=str(p["kind"]),
            amount_paise=int(p["amount_paise"]),
            gstin=_gstin(p.get("gstin")),
        )
        for p in payload.get("payments", [])
    ]
    return Accounting(str(payload["from"]), str(payload["to"]), sales, payments, shop_gstin=_gstin(payload.get("shop_gstin")))
