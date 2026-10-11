"""Job BI: the accounting files, written from a fixed synthetic window and compared with GOLDEN files (tests/golden_bi). The goldens were read and checked by hand; to regenerate them after a deliberate
change run `UPDATE_GOLDEN=1 pytest tests/test_integrations_accounting.py` and READ the diff. All names are invented."""

from __future__ import annotations

import io
import json
import os
import zipfile
from decimal import Decimal
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import pytest

from app.integrations import accounting, plain, tally, vyapar
from app.integrations.export_service import FORMATS, build_export
from app.integrations.indian import dmy, percent, rupees, rupees_indian, tally_date
from app.integrations.xlsx import read_xlsx

GOLDEN = Path(__file__).parent / "golden_bi"
PAYLOAD: dict[str, Any] = json.loads((GOLDEN / "payload.json").read_text(encoding="utf-8"))
UPDATE = os.environ.get("UPDATE_GOLDEN") == "1"


def golden(name: str, actual: str) -> None:
    path = GOLDEN / name
    if UPDATE:
        path.write_bytes(actual.encode("utf-8"))
    assert actual == path.read_bytes().decode("utf-8"), f"{name} differs from its golden file"


def acc() -> accounting.Accounting:
    return accounting.build(PAYLOAD)


# ------------------------------------------------------------------------------------------------------------------------ formats
def test_rupees_come_from_integer_paise() -> None:
    assert [rupees(x) for x in (0, 5, 100, 118000, -50, 7192500)] == ["0.00", "0.05", "1.00", "1180.00", "-0.50", "71925.00"]
    assert rupees_indian(1234567890) == "₹1,23,45,678.90" and rupees_indian(99) == "₹0.99" and rupees_indian(-100000) == "-₹1,000.00"
    assert dmy("2026-10-05") == "05/10/2026" and tally_date("2026-10-05") == "20261005"
    assert [percent(x) for x in (0, 250, 500, 1200, 1800, 125)] == ["0", "2.5", "5", "12", "18", "1.25"]


def test_every_sale_balances_to_the_paisa() -> None:
    for s in acc().sales:
        assert s.check(), s.voucher_no
        assert s.merchandise_net_paise + s.shipping_net_paise + s.tax_paise + s.round_off_paise == s.total_paise


def test_the_gst_split() -> None:
    sales = {s.order_no: s for s in acc().sales}
    intra = {t.ledger: t.paise for t in sales[12].tax_lines}
    assert intra == {"Output CGST @ 2.5%": 171250, "Output SGST @ 2.5%": 171250}, "5% of 340000 + 2500 (the freight tax) = 342500, half each"
    inter = {t.ledger: t.paise for t in sales[13].tax_lines}
    assert inter == {"Output IGST @ 5%": 50000, "Output IGST @ 12%": 60000}
    assert sales[13].round_off_paise == 50 and sales[14].round_off_paise == -100 and sales[12].round_off_paise == 0
    assert sales[14].tax_lines == [], "a 0% line has no tax ledger"


def test_an_odd_paisa_of_tax_goes_to_sgst() -> None:
    order = dict(PAYLOAD["orders"][2], item_tax_paise=5, total_paise=100005, lines=[dict(PAYLOAD["orders"][2]["lines"][0], tax_paise=5, tax_bps=500)])
    sale = accounting.build_sale(order)
    assert [(t.kind, t.paise) for t in sale.tax_lines] == [("cgst", 2), ("sgst", 3)] and sale.check()


def test_a_header_that_disagrees_with_its_lines_still_balances() -> None:
    order = dict(PAYLOAD["orders"][0], item_tax_paise=341000, total_paise=7_193_500)
    sale = accounting.build_sale(order)
    assert sale.tax_paise == 343_500 and sale.check(), "the header's total tax is authoritative; the difference sits on the highest rate"


# ------------------------------------------------------------------------------------------------------------------------ Tally
def test_tally_masters_golden() -> None:
    golden("tally_masters.xml", tally.masters_xml(acc()))


def test_tally_vouchers_golden() -> None:
    golden("tally_vouchers.xml", tally.vouchers_xml(acc()))


def test_tally_readme_golden() -> None:
    golden("tally_readme.txt", tally.readme(acc()))


@pytest.mark.parametrize("text", [tally.masters_xml(acc()), tally.vouchers_xml(acc())])
def test_tally_files_are_well_formed_and_the_shape_tally_documents(text: str) -> None:
    root = ET.fromstring(text.split("\n", 1)[1])  # noqa: S314 - our own output
    assert root.tag == "ENVELOPE" and root.findtext("HEADER/TALLYREQUEST") == "Import Data"
    assert root.findtext("BODY/IMPORTDATA/REQUESTDESC/REPORTNAME") in ("All Masters", "Vouchers")
    assert root.findall("BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE")
    assert "<!DOCTYPE" not in text and "<!ENTITY" not in text


def test_every_voucher_adds_up_to_zero_and_signs_follow_the_debit_rule() -> None:
    root = ET.fromstring(tally.vouchers_xml(acc()).split("\n", 1)[1])  # noqa: S314
    vouchers = root.findall(".//VOUCHER")
    assert len(vouchers) == 5  # three sales, a receipt, a payment
    for v in vouchers:
        total = Decimal(0)
        for e in v.findall("LEDGERENTRIES.LIST"):
            amount = Decimal(e.findtext("AMOUNT") or "0")
            debit = e.findtext("ISDEEMEDPOSITIVE") == "Yes"
            assert (amount < 0) == debit or amount == 0, "a debit has a negative amount, a credit a positive one"
            total += amount
        assert total == 0, v.findtext("VOUCHERNUMBER")


def test_tally_names_are_escaped_and_dates_are_yyyymmdd() -> None:
    text = tally.vouchers_xml(acc())
    assert "Ravi &amp; Sons Silks" in text and "&quot;" not in text.split("<LEDGERNAME>")[0]
    assert "<DATE>20261005</DATE>" in text and "<DATE>20261009</DATE>" in text
    assert "శ్రీ లక్ష్మి చీరలు" in text, "UTF-8 names stay as they are"


def test_a_sale_that_does_not_balance_is_refused() -> None:
    sale = acc().sales[0]
    sale.round_off_paise += 1
    with pytest.raises(ValueError):
        tally.sale_voucher(sale)


# ------------------------------------------------------------------------------------------------------------------------ plain CSV / XLSX / Vyapar
def test_csv_golden_and_formula_neutralised() -> None:
    raw = plain.csv_bytes(acc())
    assert raw.startswith(b"\xef\xbb\xbf"), "a byte-order mark, so Excel reads the Telugu name"
    text = raw.decode("utf-8-sig")
    golden("accounts.csv", text)
    assert "'=HYPERLINK" in text and "\r\n=HYPERLINK" not in text and ",=HYPERLINK" not in text
    assert ",-1.00," in text, "a computed negative amount (the round off) is a number, not neutralised"


def sheets(data: bytes, count: int) -> dict[str, list[list[str]]]:
    out = {}
    for i in range(count):
        sheet = read_xlsx(data, i)
        out[sheet.name] = sheet.rows
    return out


def test_xlsx_golden() -> None:
    golden("accounts_xlsx.json", json.dumps(sheets(plain.xlsx_bytes(acc()), 3), ensure_ascii=False, indent=1) + "\n")


def test_vyapar_workbook_golden_and_header_rules() -> None:
    data = vyapar.workbook(acc())
    book = sheets(data, 4)
    golden("vyapar_workbook.json", json.dumps(book, ensure_ascii=False, indent=1) + "\n")
    assert list(book) == ["Parties", "Items", "Sales", "Payments"]
    for name, rows in book.items():
        assert rows[0] == vyapar.HEADERS[name]
        assert not any("." in h or "$" in h for h in rows[0]), "Vyapar's rule: no dots or dollar signs in headers"
    assert all(len(r[1].split("/")) == 3 and len(r[1]) == 10 for r in book["Sales"][1:]), "dates are DD/MM/YYYY"
    assert not any(str(c).startswith("=") for rows in book.values() for r in rows for c in r), "a party that starts with = is written as text, never as something a spreadsheet would run"


def test_every_format_builds_and_is_the_right_kind_of_file() -> None:
    for fmt in FORMATS:
        f = build_export(fmt, PAYLOAD)
        assert f.sales == 3 and f.payments == 2 and f.filename.endswith(("xml", "zip", "xlsx", "csv")) and "2026-10-01_to_2026-10-31" in f.filename
        assert len(f.sha256) == 64
    z = zipfile.ZipFile(io.BytesIO(build_export("tally_zip", PAYLOAD).content))
    assert z.namelist() == ["1-masters.xml", "2-vouchers.xml", "README.txt"], "masters first, then vouchers, then the how-to"
    with pytest.raises(ValueError):
        build_export("pdf", PAYLOAD)


def test_the_same_input_gives_the_same_bytes() -> None:
    for fmt in FORMATS:
        assert build_export(fmt, PAYLOAD).content == build_export(fmt, PAYLOAD).content, fmt


def test_an_empty_window_still_gives_valid_files() -> None:
    empty = {"from": "2026-10-01", "to": "2026-10-02", "orders": [], "payments": []}
    for fmt in FORMATS:
        assert build_export(fmt, empty).content
    ET.fromstring(tally.vouchers_xml(accounting.build(empty)).split("\n", 1)[1])  # noqa: S314


def test_no_phone_email_or_gstin_value_is_in_any_file() -> None:
    for fmt in FORMATS:
        blob = build_export(fmt, PAYLOAD).content
        if fmt == "tally_zip":
            blob = b"".join(zipfile.ZipFile(io.BytesIO(blob)).read(n) for n in zipfile.ZipFile(io.BytesIO(blob)).namelist())
        assert b"@example" not in blob.replace(b"x.example", b"") and b"+91" not in blob
