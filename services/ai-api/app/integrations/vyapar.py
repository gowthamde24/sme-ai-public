"""The Vyapar workbook. WHAT VYAPAR ACCEPTS (read 2026-10-11, see docs/runbooks/accounting-export.md for the sources): the Vyapar app imports PARTIES and ITEMS from an Excel template (Utilities > Import
Parties / Import Items: it shows every error and imports only when there are none); it publishes NO import for sale invoices. Sale invoices go in through Vyapar TaxOne's Bulk Upload (an Excel
sheet with a mapping screen; headers without dots or dollar signs, dates DD/MM/YYYY, under 30 MB). Vyapar publishes no list of the template's header names, so the names below are the common ones,
kept in ONE table (HEADERS) that is easy to change: compare them with the template the Vyapar app gives you (Import Parties > Download sample) and rename if a header differs.

One workbook, four sheets: Parties, Items, Sales (one row per invoice line, plus one per freight charge), Payments. Rates are the GST percentage; amounts are rupees with two decimals; dates DD/MM/YYYY;
no header contains a dot or a dollar sign. The GSTIN column is present and empty: the application holds none."""

from __future__ import annotations

from typing import Any

from app.integrations.accounting import Accounting
from app.integrations.indian import dmy, percent, rupees
from app.integrations.xlsx import write_xlsx

HEADERS: dict[str, list[str]] = {
    "Parties": ["Party Name", "GSTIN", "Phone No", "Email", "City", "State", "Opening Balance"],
    "Items": ["Item Name", "Item Code", "HSN", "Unit", "Sale Price", "Tax Rate"],
    "Sales": ["Invoice No", "Invoice Date", "Party Name", "GSTIN", "Place of Supply", "Item Name", "Item Code", "Quantity", "Unit", "Rate", "Tax Rate", "Taxable Amount", "Tax Amount", "Total Amount"],
    "Payments": ["Receipt No", "Date", "Party Name", "Type", "Amount", "Against Invoice No"],
}


def _money(paise: int) -> float:
    return float(rupees(paise))


def workbook(acc: Accounting) -> bytes:
    parties: list[list[Any]] = [HEADERS["Parties"]]
    for name, city in acc.parties():
        parties.append([name, "", "", "", city or "", "", ""])
    items_seen: dict[str, list[Any]] = {}
    sales: list[list[Any]] = [HEADERS["Sales"]]
    for s in acc.sales:
        for ln in s.lines:
            items_seen[ln.sku] = [ln.name, ln.sku, "", ln.unit, _money(ln.unit_price_paise), float(percent(ln.tax_bps))]
            sales.append([s.voucher_no, dmy(s.date), s.party, s.gstin, s.state_code, ln.name, ln.sku, ln.qty, ln.unit, _money(ln.unit_price_paise), float(percent(ln.tax_bps)),
                          _money(ln.net_paise), _money(ln.tax_paise), _money(ln.net_paise + ln.tax_paise)])
        if s.shipping_net_paise:
            ship_tax = max(0, s.tax_paise - sum(ln.tax_paise for ln in s.lines))
            sales.append([s.voucher_no, dmy(s.date), s.party, s.gstin, s.state_code, "Freight Charges", "", 1, "", _money(s.shipping_net_paise), "", _money(s.shipping_net_paise), _money(ship_tax),
                          _money(s.shipping_net_paise + ship_tax)])
        if s.round_off_paise:
            sales.append([s.voucher_no, dmy(s.date), s.party, s.gstin, s.state_code, "Round Off", "", 1, "", _money(s.round_off_paise), "", _money(s.round_off_paise), 0.0, _money(s.round_off_paise)])
    items = [HEADERS["Items"], *sorted(items_seen.values(), key=lambda r: str(r[1]))]
    payments: list[list[Any]] = [HEADERS["Payments"]]
    for p in acc.payments:
        payments.append([p.voucher_no, dmy(p.date), p.party, "Payment In" if p.kind == "payment" else "Payment Out", _money(p.amount_paise), p.sale_voucher_no])
    return write_xlsx([("Parties", parties), ("Items", items), ("Sales", sales), ("Payments", payments)])
