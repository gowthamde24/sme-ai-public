"""Tally Prime import files (XML). Two files, to be imported in this order: masters (the ledgers the vouchers use) and vouchers (a Sales voucher per accepted order, a Receipt per payment, a Payment
voucher per refund). The shape follows Tally's own published import examples (help.tallysolutions.com/sample-xml and /xml-integration): an ENVELOPE with a HEADER (TALLYREQUEST Import Data) and a BODY
with IMPORTDATA / REQUESTDESC (REPORTNAME All Masters or Vouchers) / REQUESTDATA / TALLYMESSAGE. Dates are YYYYMMDD. In a voucher a DEBIT entry has ISDEEMEDPOSITIVE Yes and a NEGATIVE amount; a
CREDIT entry has ISDEEMEDPOSITIVE No and a POSITIVE amount; the entries of every voucher add up to zero (the builder asserts it).

What is NOT in the files, on purpose: GSTIN and GST registration type (the application holds no GSTIN yet), HSN codes, stock items (the vouchers are accounting vouchers: party, sales, freight, tax),
bank details (receipts go to the ledger named Cash unless you pass another). The tax ledgers are plain ledgers under Duties & Taxes: set their GST type and rate in Tally if you file from Tally."""

from __future__ import annotations

import re
import uuid
from xml.dom import minidom  # noqa: S408 - only our own output is parsed, to indent it
from xml.sax.saxutils import escape

from app.integrations.accounting import (
    CASH_LEDGER,
    FREIGHT_LEDGER,
    ROUND_LEDGER,
    SALES_LEDGER,
    TAX_PARENT,
    Accounting,
    Payment,
    Sale,
)
from app.integrations.indian import rupees, tally_date

_BAD = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]")


def x(text: str) -> str:
    """XML text: control characters dropped, &, < and > escaped."""
    return escape(_BAD.sub("", text))


def _ledger(name: str, parent: str, extra: str = "") -> str:
    return f'<LEDGER Action="Create"><NAME>{x(name)}</NAME><PARENT>{x(parent)}</PARENT>{extra}</LEDGER>'


def masters_xml(acc: Accounting) -> str:
    items: list[str] = []
    for name, city in acc.parties():
        extra = "<COUNTRYNAME>India</COUNTRYNAME>"
        if city:
            extra = f'<ADDRESS.LIST TYPE="String"><ADDRESS>{x(city)}</ADDRESS></ADDRESS.LIST>' + extra
        items.append(_ledger(name, "Sundry Debtors", extra))
    items.append(_ledger(SALES_LEDGER, "Sales Accounts"))
    if acc.uses_freight():
        items.append(_ledger(FREIGHT_LEDGER, "Indirect Incomes"))
    if acc.uses_round_off():
        items.append(_ledger(ROUND_LEDGER, "Indirect Expenses"))
    for name, _kind, _bps in acc.tax_ledgers():
        items.append(_ledger(name, TAX_PARENT))
    body = "".join(f'<TALLYMESSAGE xmlns:UDF="TallyUDF">{i}</TALLYMESSAGE>' for i in items)
    return _envelope("All Masters", body)


def _envelope(report: str, messages: str) -> str:
    """The ENVELOPE, indented so a person can read the file (Tally does not care about the white space). Our own output is parsed back to indent it."""
    compact = (
        "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>"
        f"<REQUESTDESC><REPORTNAME>{report}</REPORTNAME></REQUESTDESC><REQUESTDATA>{messages}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>"
    )
    pretty = minidom.parseString(compact.encode("utf-8")).toprettyxml(indent="  ", encoding="UTF-8").decode("utf-8")  # noqa: S318 - our own output
    return pretty


def _entry(ledger: str, paise: int, *, debit: bool, party: bool = False, bill: str | None = None) -> str:
    signed = -paise if debit else paise
    bits = [f"<LEDGERNAME>{x(ledger)}</LEDGERNAME>", f"<ISDEEMEDPOSITIVE>{'Yes' if debit else 'No'}</ISDEEMEDPOSITIVE>"]
    if party:
        bits.append("<ISPARTYLEDGER>Yes</ISPARTYLEDGER>")
    bits.append(f"<AMOUNT>{rupees(signed)}</AMOUNT>")
    if bill is not None:
        bits.append(f"<BILLALLOCATIONS.LIST><NAME>{x(bill)}</NAME><BILLTYPE>New Ref</BILLTYPE><AMOUNT>{rupees(signed)}</AMOUNT></BILLALLOCATIONS.LIST>")
    return f"<LEDGERENTRIES.LIST>{''.join(bits)}</LEDGERENTRIES.LIST>"


NAMESPACE = uuid.UUID("5e5d4a52-6a0f-4d5c-9c0e-3f7b1d2a9b10")  # fixed: the same order or payment always gets the same GUID


def voucher_guid(kind: str, record_id: str) -> str:
    """A STABLE Tally voucher GUID (job BO): `<uuid>-00000001`, the shape Tally writes itself, derived from the order or payment id, so importing the same range again REPLACES the voucher when
    Tally's import option "Overwrite voucher when a voucher with same GUID exists" is Yes, instead of creating it twice."""
    return f"{uuid.uuid5(NAMESPACE, f'{kind}:{record_id}')}-00000001"


def _voucher(kind: str, date: str, number: str, party: str, narration: str, entries: list[str], guid: str) -> str:
    return (
        f'<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="{kind}" ACTION="Create" OBJVIEW="Accounting Voucher View">'
        f"<DATE>{tally_date(date)}</DATE><GUID>{guid}</GUID><REMOTEID>{guid}</REMOTEID><VOUCHERTYPENAME>{kind}</VOUCHERTYPENAME><VOUCHERNUMBER>{x(number)}</VOUCHERNUMBER>"
        f"<PARTYLEDGERNAME>{x(party)}</PARTYLEDGERNAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><ISINVOICE>No</ISINVOICE>"
        f"<NARRATION>{x(narration)}</NARRATION>{''.join(entries)}</VOUCHER></TALLYMESSAGE>"
    )


def sale_voucher(s: Sale) -> str:
    if not s.check():
        raise ValueError("a sale does not balance")
    entries = [_entry(s.party, s.total_paise, debit=True, party=True, bill=s.voucher_no), _entry(SALES_LEDGER, s.merchandise_net_paise, debit=False)]
    if s.shipping_net_paise:
        entries.append(_entry(FREIGHT_LEDGER, s.shipping_net_paise, debit=False))
    for t in s.tax_lines:
        entries.append(_entry(t.ledger, t.paise, debit=False))
    if s.round_off_paise:
        entries.append(_entry(ROUND_LEDGER, abs(s.round_off_paise), debit=s.round_off_paise < 0))
    return _voucher("Sales", s.date, s.voucher_no, s.party, f"Order {s.order_no} (quote {s.quote_no}), {s.supply.replace('_', '-')} supply to {s.state_code}", entries, voucher_guid("sale", s.order_id))


def payment_voucher(p: Payment, cash_ledger: str = CASH_LEDGER) -> str:
    if p.kind == "payment":  # money in: the cash or bank ledger is debited, the party credited
        entries = [_entry(cash_ledger, p.amount_paise, debit=True), _entry(p.party, p.amount_paise, debit=False, party=True)]
        return _voucher("Receipt", p.date, p.voucher_no, p.party, f"Received against order {p.order_no} ({p.sale_voucher_no})", entries, voucher_guid("payment", p.payment_id))
    entries = [_entry(p.party, p.amount_paise, debit=True, party=True), _entry(cash_ledger, p.amount_paise, debit=False)]
    return _voucher("Payment", p.date, p.voucher_no, p.party, f"Refunded against order {p.order_no} ({p.sale_voucher_no})", entries, voucher_guid("refund", p.payment_id))


def vouchers_xml(acc: Accounting, cash_ledger: str = CASH_LEDGER) -> str:
    messages = [sale_voucher(s) for s in acc.sales] + [payment_voucher(p, cash_ledger) for p in acc.payments]
    return _envelope("Vouchers", "".join(messages))


def readme(acc: Accounting, cash_ledger: str = CASH_LEDGER) -> str:
    return f"""HOW TO IMPORT THESE FILES INTO TALLY PRIME
==========================================
Window: {acc.date_from} to {acc.date_to}   Sales: {len(acc.sales)}   Payments and refunds: {len(acc.payments)}

Before you start
  1. Open the Tally company you keep these books in. Take a BACKUP first (Tally offers one when you import: say Yes).
  2. Use the same company features (F11) the company already has. The GST features need not be on for this import.
  3. These files are plain accounting vouchers. They have no GSTIN, HSN or stock items: add those in Tally if you file GST from Tally.
  4. The ledger "{cash_ledger}" must exist (Tally creates Cash in every company). Receipts and refunds use it; change it in Tally afterwards if the money went to a bank.

Import, in this order (TallyPrime Release 4.0 or later: XML works in every release)
  1. 1-masters.xml     press Alt+O (Import) > Masters, enter the file path, choose "Ignore duplicates" for Import Behaviour, answer Yes to the backup, press Enter.
  2. 2-vouchers.xml    press Alt+O (Import) > Transactions, enter the file path, answer Yes to the backup, press Enter.
  3. Check: Day Book, Sales Register and the party ledgers. Anything Tally could not import is in the Exceptions report; the details are in Tally.imp
     (Alt+O > Configuration > Enable detailed log).

Notes
  * Every voucher carries a STABLE GUID (the same order or payment always has the same one). To import a range again without doubling it, set Alt+O > Configuration > "Overwrite voucher when
    a voucher with same GUID exists" to Yes first: the earlier vouchers are replaced. With the default (No) Tally creates them again. The voucher numbers (SO-00012 ...) never change either.
  * A voucher is Sales (the party is debited the order total; Sales, Freight Charges and the GST ledgers are credited), Receipt (money in) or Payment (a refund). Round Off holds
    any paisa difference between an order total and its parts.
  * Names in Telugu, Hindi or other scripts need TallyPrime (Unicode); Tally ERP 9 may show them wrongly.
  * Amounts are in rupees; dates are the India dates.
"""
