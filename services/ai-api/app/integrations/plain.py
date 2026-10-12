"""The plain exports: one CSV (UTF-8 with a byte-order mark so Excel reads Telugu and Hindi names) and one XLSX with the same rows split over three sheets. For an accountant or a spreadsheet:
amounts are rupees with two decimals in columns that say (INR), dates are DD/MM/YYYY, a party's GSTIN and the seller's (the shop's own) are columns that are empty when we hold none. Every text cell is made safe against spreadsheet
formula injection (CSV: a leading apostrophe is added when a cell starts with = + - @ tab or CR)."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from app.integrations.accounting import Accounting
from app.integrations.indian import dmy, rupees
from app.integrations.xlsx import write_xlsx
from app.leads.export import sanitize_csv_cell

CSV_HEADERS = [
    "Record", "Date", "Voucher No", "Order No", "Party", "GSTIN", "Place of Supply", "Supply", "Taxable Value (INR)", "CGST (INR)", "SGST (INR)", "IGST (INR)", "Freight (INR)",
    "Round Off (INR)", "Total (INR)", "Reference", "Seller GSTIN",
]  # fmt: skip
SALE_LINE_HEADERS = ["Voucher No", "Date", "Party", "Item", "Item Code", "Quantity", "Unit", "Rate (INR)", "Taxable Value (INR)", "GST %", "GST (INR)", "Line Total (INR)"]
PAYMENT_HEADERS = ["Voucher No", "Date", "Party", "Type", "Amount (INR)", "Order No", "Against Invoice"]


_AMOUNT = re.compile(r"^-?[0-9]+\.[0-9]{2}$")


def _safe(cell: Any) -> str:
    """A computed amount (digits, a dot, two decimals, maybe a minus sign) is left alone; every other cell is neutralised."""
    text = str(cell)
    return text if _AMOUNT.fullmatch(text) else sanitize_csv_cell(cell)


def _tax(s: Any, kind: str) -> int:
    return sum(t.paise for t in s.tax_lines if t.kind == kind)


def register_rows(acc: Accounting) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for s in acc.sales:
        rows.append(["Sale", dmy(s.date), s.voucher_no, s.order_no, s.party, s.gstin, s.state_code, s.supply.replace("_", "-"), rupees(s.merchandise_net_paise),
                     rupees(_tax(s, "cgst")), rupees(_tax(s, "sgst")), rupees(_tax(s, "igst")), rupees(s.shipping_net_paise), rupees(s.round_off_paise), rupees(s.total_paise),
                     f"quote {s.quote_no}", acc.shop_gstin])
    for p in acc.payments:
        rows.append(["Payment received" if p.kind == "payment" else "Refund paid", dmy(p.date), p.voucher_no, p.order_no, p.party, p.gstin, "", "", "", "", "", "", "", "", rupees(p.amount_paise),
                     f"against {p.sale_voucher_no}", acc.shop_gstin])
    return rows


def csv_bytes(acc: Accounting) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_HEADERS)
    for row in register_rows(acc):
        writer.writerow([_safe(c) for c in row])
    return b"\xef\xbb\xbf" + buf.getvalue().encode("utf-8")


def xlsx_bytes(acc: Accounting) -> bytes:
    def num(paise: int) -> float:
        return float(rupees(paise))

    register: list[list[Any]] = [CSV_HEADERS]
    for r in register_rows(acc):
        register.append([c if i not in (8, 9, 10, 11, 12, 13, 14) or c == "" else float(c) for i, c in enumerate(r)])
    lines: list[list[Any]] = [SALE_LINE_HEADERS]
    for s in acc.sales:
        for ln in s.lines:
            lines.append([s.voucher_no, dmy(s.date), s.party, ln.name, ln.sku, ln.qty, ln.unit, num(ln.unit_price_paise), num(ln.net_paise), ln.tax_bps / 100, num(ln.tax_paise), num(ln.net_paise + ln.tax_paise)])
    payments: list[list[Any]] = [PAYMENT_HEADERS]
    for p in acc.payments:
        payments.append([p.voucher_no, dmy(p.date), p.party, "Payment received" if p.kind == "payment" else "Refund paid", num(p.amount_paise), p.order_no, p.sale_voucher_no])
    return write_xlsx([("Register", register), ("Sale lines", lines), ("Payments", payments)])
