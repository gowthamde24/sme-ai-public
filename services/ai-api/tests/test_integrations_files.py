"""Job BI: reading untrusted spreadsheets. The XLSX reader (zip and XML attacks), the grid loader (CSV, tab, UTF-16, limits), the column-mapping suggestion (English, Telugu, Hindi) and the row
preparation for customers and stock (formula injection, hidden characters, duplicates, the closed issue codes). All data is invented."""

from __future__ import annotations

import io
import zipfile

import pytest

from app.integrations import importer, mapping
from app.integrations.sheet import MAX_DATA_ROWS, SheetRefused, load_grid
from app.integrations.xlsx import XlsxRefused, read_xlsx, write_xlsx


def csv(text: str) -> bytes:
    return text.encode("utf-8")


def refused(data: bytes) -> str:
    with pytest.raises(SheetRefused) as e:
        load_grid(data)
    return e.value.code


# ------------------------------------------------------------------------------------------------------------------------ xlsx
def test_xlsx_round_trip_keeps_text_numbers_and_unicode() -> None:
    data = write_xlsx([("Customers", [["Name", "Phone", "City"], ["Ravi & Co", 9876543210, "Hyderabad"], ["శ్రీ లక్ష్మి", "007", ""]])])
    sheet = read_xlsx(data)
    assert sheet.name == "Customers" and sheet.rows == [["Name", "Phone", "City"], ["Ravi & Co", "9876543210", "Hyderabad"], ["శ్రీ లక్ష్మి", "007"]], "an empty cell is simply absent"
    assert sheet.formulas == set()


def test_xlsx_text_that_looks_like_a_formula_is_stored_as_text_with_an_apostrophe() -> None:
    sheet = read_xlsx(write_xlsx([("S", [["a"], ["=1+1"], ["@SUM(A1)"], ["-5 text"]])]))
    assert [r[0] for r in sheet.rows[1:]] == ["'=1+1", "'@SUM(A1)", "'-5 text"]


def _with(data: bytes, name: str, new: bytes) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            zout.writestr(item, new if item.filename == name else zin.read(item.filename))
    return out.getvalue()


def test_a_formula_cell_is_reported_not_trusted() -> None:
    base = write_xlsx([("S", [["Name"], ["x"]])])
    sheet_xml = zipfile.ZipFile(io.BytesIO(base)).read("xl/worksheets/sheet1.xml").decode()
    evil = sheet_xml.replace('<c r="A2" s="0" t="inlineStr"><is><t xml:space="preserve">x</t></is></c>', '<c r="A2"><f>HYPERLINK("http://evil","x")</f><v>cached</v></c>')
    assert evil != sheet_xml
    sheet = read_xlsx(_with(base, "xl/worksheets/sheet1.xml", evil.encode()))
    assert sheet.formulas == {(1, 0)} and sheet.rows[1][0] == "", "the cached value of a formula is never used"


@pytest.mark.parametrize("doctype", [b'<!DOCTYPE x [<!ENTITY a "aaaa">]>', b"<!ENTITY zzz 'y'>"])
def test_xml_with_a_doctype_or_entity_is_refused(doctype: bytes) -> None:
    base = write_xlsx([("S", [["Name"], ["x"]])])
    sheet_xml = zipfile.ZipFile(io.BytesIO(base)).read("xl/worksheets/sheet1.xml")
    bad = sheet_xml.replace(b"<worksheet", doctype + b"<worksheet", 1)
    with pytest.raises(XlsxRefused) as e:
        read_xlsx(_with(base, "xl/worksheets/sheet1.xml", bad))
    assert e.value.code == "unsafe_xml"


def test_a_zip_bomb_is_refused_before_it_is_read() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/worksheets/sheet1.xml", b"0" * 30_000_000)
    assert len(buf.getvalue()) < 100_000
    with pytest.raises(XlsxRefused) as e:
        read_xlsx(buf.getvalue())
    assert e.value.code == "too_large"


def test_not_a_zip_and_too_many_parts_and_no_sheet() -> None:
    with pytest.raises(XlsxRefused) as e:
        read_xlsx(b"PK\x03\x04 not really")
    assert e.value.code == "not_xlsx"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for i in range(101):
            z.writestr(f"p{i}.xml", "x")
    with pytest.raises(XlsxRefused) as e2:
        read_xlsx(buf.getvalue())
    assert e2.value.code == "too_many_parts"
    with pytest.raises(XlsxRefused) as e3:
        read_xlsx(write_xlsx([("S", [["a"]])]), sheet_index=3)
    assert e3.value.code == "no_sheet"


def test_too_many_rows_and_columns_in_a_sheet() -> None:
    with pytest.raises(XlsxRefused) as e:
        read_xlsx(write_xlsx([("S", [["a"]] + [["x"]] * 2100)]))
    assert e.value.code == "too_many_rows"
    with pytest.raises(XlsxRefused) as e2:
        read_xlsx(write_xlsx([("S", [[f"c{i}" for i in range(70)]])]))
    assert e2.value.code == "too_many_columns"


# ------------------------------------------------------------------------------------------------------------------------ the grid
def test_csv_with_a_byte_order_mark_blank_lines_and_line_numbers() -> None:
    g = load_grid("﻿Name,City\n\nRavi,Hyd\n,\nLakshmi,Gnt\n".encode())
    assert g.header == ["Name", "City"] and g.rows == [["Ravi", "Hyd"], ["Lakshmi", "Gnt"]] and g.lines == [3, 5], "blank lines are skipped but the file's own line numbers are kept"


def test_tab_separated_and_utf16() -> None:
    assert load_grid(csv("Name\tCity\nRavi\tHyd\n")).rows == [["Ravi", "Hyd"]]
    assert load_grid("Name,City\nరవి,హైదరాబాద్\n".encode("utf-16")).rows == [["రవి", "హైదరాబాద్"]]


def test_xlsx_goes_through_the_same_grid() -> None:
    g = load_grid(write_xlsx([("S", [["Name", "Qty"], ["Saree", 4], ["", ""], ["Silk", 0]])]))
    assert g.kind == "xlsx" and g.rows == [["Saree", "4"], ["Silk", "0"]] and g.lines == [2, 4]


@pytest.mark.parametrize(
    ("data", "code"),
    [
        (b"", "empty"), (b"   \n\n", "empty"), (b"a,b\n\x80\x81,2\n", "not_utf8"), (b'a,b\n"unterminated,2\n', "malformed_csv"),
        (b"x" * 1_000_001, "too_large"), (b"PK" + b"0" * 2_000_001, "too_large"), (b",,\n", "empty"),
    ],
)  # fmt: skip
def test_refusals_are_closed_codes(data: bytes, code: str) -> None:
    assert refused(data) == code


def test_row_and_column_limits() -> None:
    assert refused(csv("n\n" + "x\n" * (MAX_DATA_ROWS + 1))) == "too_many_rows"
    assert len(load_grid(csv("n\n" + "x\n" * MAX_DATA_ROWS)).rows) == MAX_DATA_ROWS
    assert refused(csv(",".join(f"c{i}" for i in range(61)) + "\n")) == "too_many_columns"


def test_a_long_cell_is_cut_and_counted() -> None:
    g = load_grid(csv("Name\n" + "a" * 900 + "\n"))
    assert len(g.rows[0][0]) == 500 and g.cut_cells == 1


# ------------------------------------------------------------------------------------------------------------------------ mapping
def suggest(headers: list[str], kind: str = "customers") -> dict[str, int]:
    return mapping.mapping_from(mapping.suggest(headers, kind))


def test_english_headers_of_a_billing_app() -> None:
    assert suggest(["Party Name", "Mobile No.", "Email ID", "City", "GSTIN", "Opening Balance"]) == {"company_name": 0, "contact_phone": 1, "contact_email": 2, "city": 3}


def test_telugu_headers() -> None:
    assert suggest(["పార్టీ పేరు", "మొబైల్ నంబర్", "ఈమెయిల్", "ఊరు", "సంప్రదింపు వ్యక్తి"]) == {"company_name": 0, "contact_phone": 1, "contact_email": 2, "city": 3, "contact_name": 4}


def test_hindi_headers_including_the_nukta_forms() -> None:
    assert suggest(["ग्राहक का नाम", "फ़ोन", "ईमेल", "शहर", "संपर्क व्यक्ति"]) == {"company_name": 0, "contact_phone": 1, "contact_email": 2, "city": 3, "contact_name": 4}
    assert suggest(["दुकान का नाम", "फोन नंबर"]) == {"company_name": 0, "contact_phone": 1}


def test_a_lone_name_column_is_the_main_name_and_two_name_columns_are_told_apart() -> None:
    assert suggest(["Name", "Phone"]) == {"company_name": 0, "contact_phone": 1}
    assert suggest(["Shop name", "Name", "Phone"]) == {"company_name": 0, "contact_name": 1, "contact_phone": 2}


def test_headers_with_punctuation_case_and_joiners() -> None:
    assert suggest(["  PARTY_NAME  ", "e-mail", "Phone‍ No"]) == {"company_name": 0, "contact_email": 1, "contact_phone": 2}


def test_stock_headers_and_each_column_is_used_once() -> None:
    assert suggest(["Design No", "Qty", "Status"], "stock") == {"item_name": 0, "quantity": 1, "stock_status": 2}
    assert suggest(["Saree name", "స్టాక్", "మొత్తం సంఖ్య"], "stock")["item_name"] == 0
    got = mapping.suggest(["Name", "Name"], "customers")
    assert sum(1 for s in got if s.field) == 1, "a field is given to one column only"


def test_the_suggestion_is_deterministic() -> None:
    headers = ["Party", "Mobile", "Mail", "Town", "Notes"]
    assert [mapping.suggest(headers, "customers") for _ in range(5)] == [mapping.suggest(headers, "customers")] * 5


def test_a_client_mapping_is_validated() -> None:
    assert mapping.validate_mapping({"company_name": 0, "city": 2}, "customers", 3) == {"company_name": 0, "city": 2}
    bad: object
    for bad in ({}, None, [], {"company_name": 5}, {"company_name": -1}, {"company_name": True}, {"nope": 0}, {"city": 1}, {"company_name": 0, "city": 0}, {"company_name": "0"}):
        with pytest.raises(ValueError):
            mapping.validate_mapping(bad, "customers", 3)


# ------------------------------------------------------------------------------------------------------------------------ customers
def prep_customers(text: str, maps: dict[str, int] | None = None) -> importer.Prepared:
    g = load_grid(csv(text))
    return importer.prepare_customers(g, maps or suggest(g.header))


def test_customer_rows_become_import_rows() -> None:
    p = prep_customers("Party Name,Email,Contact,City\nRavi Silks,ravi@example.test,Ravi,Hyderabad\nLakshmi,,,Guntur\n")
    assert p.rows == [
        {"company_name": "Ravi Silks", "contact_email": "ravi@example.test", "contact_name": "Ravi", "city": "Hyderabad", "source": "Spreadsheet import"},
        {"company_name": "Lakshmi", "city": "Guntur", "source": "Spreadsheet import"},
    ]
    assert p.lines == [2, 3] and p.issues == [] and p.notes == [None, None]


def test_contact_details_without_an_email_keep_the_company_and_say_so() -> None:
    p = prep_customers("Party,Mobile,Name\nRavi Silks,9876543210,Ravi\n")
    assert p.rows == [{"company_name": "Ravi Silks", "source": "Spreadsheet import"}] and p.notes == ["contact_needs_email"]


@pytest.mark.parametrize(
    ("cell", "code"),
    [("=1+1", "formula_like"), ("@SUM(A1)", "formula_like"), ("+cmd|' /C calc'!A0", "formula_like"), ("-2+3", "formula_like"), ("a​b", "hidden_characters"), ("a‮b", "hidden_characters")],
)  # fmt: skip
def test_dangerous_cells_refuse_their_row_with_a_code_and_no_echo(cell: str, code: str) -> None:
    p = prep_customers(f'Party,City\n"{cell}",Hyd\nSafe Silks,Gnt\n')
    assert [(i.line, i.code, i.field) for i in p.issues] == [(2, code, "company_name")]
    assert [r["company_name"] for r in p.rows] == ["Safe Silks"]
    assert cell not in repr(p.issues), "an issue never echoes a cell"


def test_a_phone_with_a_plus_is_not_a_formula_and_a_missing_name_is_an_issue() -> None:
    p = prep_customers("Party,Phone,Email,Name\nA Silks,+91 98765 43210,a@example.test,A\n,+91 1,,\n")
    assert len(p.rows) == 1 and p.rows[0]["contact_phone"] == "+91 98765 43210"
    assert [(i.line, i.code) for i in p.issues] == [(3, "company_name_missing")]


def test_xlsx_formula_cells_are_refused_and_blank_rows_are_not_rows() -> None:
    base = write_xlsx([("S", [["Party", "City"], ["Ravi", "x"], ["", ""], ["Lakshmi", "y"]])])
    g = load_grid(base)
    g.formulas.add((0, 1))
    p = importer.prepare_customers(g, {"company_name": 0, "city": 1})
    assert [(i.line, i.code, i.field) for i in p.issues] == [(2, "formula_cell", "city")] and [r["company_name"] for r in p.rows] == ["Lakshmi"]


def test_a_cell_at_the_limit_is_refused() -> None:
    g = load_grid(csv("Party\n" + "a" * 600 + "\n"))
    p = importer.prepare_customers(g, {"company_name": 0})
    assert [i.code for i in p.issues] == ["cell_too_long"]


# ------------------------------------------------------------------------------------------------------------------------ stock
def prep_stock(text: str) -> importer.Prepared:
    g = load_grid(csv(text))
    return importer.prepare_stock(g, suggest(g.header, "stock"))


def test_stock_from_status_words_in_three_languages() -> None:
    p = prep_stock("Design,Status\nA,In stock\nB,few left\nC,Made to order\nD,స్టాక్ ఉంది\nE,थोड़े बचे\nF,खत्म\nG,out of stock\n")
    assert [r["stock_status"] for r in p.rows] == ["in_stock", "few_left", "made_to_order", "in_stock", "few_left", "made_to_order", "made_to_order"]
    assert p.notes[5] == "out_of_stock_is_made_to_order" and p.notes[6] == "out_of_stock_is_made_to_order" and p.notes[2] is None


def test_stock_from_a_quantity() -> None:
    p = prep_stock("Item,Qty\nA,12\nB,2\nC,1\nD,0\nE,3.0\nF,\n")
    assert [r["stock_status"] for r in p.rows] == ["in_stock", "few_left", "few_left", "made_to_order", "in_stock"]
    assert [(i.line, i.code) for i in p.issues] == [(7, "quantity_invalid")], "a named item with no quantity (and no status) is a problem, said with a code"


def test_stock_problems_are_closed_codes() -> None:
    p = prep_stock("Item,Qty,Status\nA,x,\nB,-3,\n,5,\nC,,maybe\nD,,\nE,4,\ne,4,\n")
    codes = {(i.line, i.code) for i in p.issues}
    assert (2, "quantity_invalid") in codes and (3, "quantity_invalid") in codes and (4, "item_name_missing") in codes and (5, "status_unknown") in codes and (6, "quantity_invalid") in codes
    assert (8, "duplicate_in_file") in codes, "the same name twice (case ignored) is refused for the second row"
    assert [r["name"] for r in p.rows] == ["E"]


def test_a_stock_file_with_neither_status_nor_quantity_is_one_issue() -> None:
    g = load_grid(csv("Item\nA\n"))
    p = importer.prepare_stock(g, {"item_name": 0})
    assert [i.code for i in p.issues] == ["no_status_or_quantity"] and p.rows == []


def test_matching_the_catalogue_by_name() -> None:
    p = prep_stock("Item,Status\nMaroon  Kanchi pattu,few left\nGreen Dharmavaram,in stock\nUnknown saree,in stock\nTwin,in stock\n")
    catalogue = [
        {"id": "i1", "name": "maroon kanchi PATTU", "stock_status": "in_stock", "active": True},
        {"id": "i2", "name": "Green Dharmavaram", "stock_status": "in_stock", "active": False},
        {"id": "i3", "name": "Twin", "stock_status": "few_left", "active": True},
        {"id": "i4", "name": "twin", "stock_status": "few_left", "active": True},
    ]
    got = importer.match_catalogue(p, catalogue)
    assert [(g["action"], g["item_id"], g["old_status"], g["new_status"]) for g in got] == [
        ("will_change", "i1", "in_stock", "few_left"), ("unchanged", "i2", "in_stock", "in_stock"), ("not_found", None, None, "in_stock"), ("ambiguous", None, None, "in_stock"),
    ]  # fmt: skip


# ------------------------------------------------------------------------------------------------------------------------ the sample files shipped with the documentation
def test_the_sample_files_read_as_documented() -> None:
    from pathlib import Path

    golden = Path(__file__).parent / "golden_bi"
    te = load_grid((golden / "sample_customers_telugu.csv").read_bytes())
    assert suggest(te.header) == {"company_name": 0, "contact_name": 1, "contact_phone": 2, "contact_email": 3, "city": 4}
    prepared = importer.prepare_customers(te, suggest(te.header))
    assert len(prepared.rows) == 2 and prepared.issues == [] and prepared.notes == [None, "contact_needs_email"]
    hi = load_grid((golden / "sample_customers_hindi.csv").read_bytes())
    assert suggest(hi.header) == {"company_name": 0, "contact_phone": 1, "city": 2}
    st = load_grid((golden / "sample_stock.csv").read_bytes())
    p = importer.prepare_stock(st, suggest(st.header, "stock"))
    assert [r["stock_status"] for r in p.rows] == ["few_left", "made_to_order", "in_stock", "few_left"] and p.issues == []
