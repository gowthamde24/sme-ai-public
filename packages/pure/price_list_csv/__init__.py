"""Pure all-or-nothing CSV price-list parsing; integers only, no external I/O."""
import csv
import hashlib
from io import StringIO
import json
import re

PARSER_VERSION = "1.0.0"
# Mirror quote_engine 1.1.0 bounds without a runtime cross-package dependency.
MAX_UNIT_PRICE = 100_000_000
MAX_QUANTITY_PER_LINE = 10_000
MAX_TAX_BPS = 10_000
MAX_IDENTIFIER_LENGTH = 128
MAX_ROWS = 5_000
MAX_BYTES = 2 * 1024 * 1024
MAX_COLUMNS = 40
MAX_CELL_LENGTH = 200
MAX_SKU_LENGTH = 40
MAX_BREAKS = 5
REQUIRED = ("sku", "name", "unit_price", "moq", "tax_bps")
BREAK_COLUMNS = tuple(column for i in range(1, MAX_BREAKS + 1)
                      for column in ("min_qty_" + str(i), "price_" + str(i)))
ALLOWED = REQUIRED + BREAK_COLUMNS
SKU = re.compile(r"[A-Za-z0-9._][A-Za-z0-9._-]{0,39}\Z", re.ASCII)
INTEGER = re.compile(r"[0-9]+\Z", re.ASCII)
MONEY = re.compile(r"(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]{1,2})?\Z", re.ASCII)
PREFIX = re.compile(r"(?:₹|Rs\.?|INR)\s*", re.IGNORECASE | re.ASCII)


class _Invalid(Exception):
    pass


def canonical_json(value):
    """Sorted compact ASCII JSON of parser results (integer money only)."""
    def check(item):
        if type(item) in (str, int, bool, type(None)):
            return
        if type(item) is list:
            for child in item:
                check(child)
        elif type(item) is dict:
            for key, child in item.items():
                if type(key) is not str:
                    raise TypeError("JSON keys must be strings")
                check(child)
        else:
            raise TypeError("Only integer JSON values are supported")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _preflight(text):
    """Bound UTF-8 bytes and decoded cell sizes before csv.reader allocation.

    The small lexical scan counts quoted/escaped characters, not physical lines.
    csv.reader subsequently validates syntax. No process-global CSV limit changes.
    """
    if len(text) > MAX_BYTES:
        raise _Invalid("FILE_LIMIT")
    try:
        if len(text.encode("utf-8")) > MAX_BYTES:
            raise _Invalid("FILE_LIMIT")
    except UnicodeEncodeError:
        raise _Invalid("INVALID_UTF8") from None
    if text.startswith("\ufeff"):
        text = text[1:]
    quoted, start, length, columns, records = False, True, 0, 1, 0
    i = 0
    while i < len(text):
        char = text[i]
        if quoted:
            if char == '"':
                if i + 1 < len(text) and text[i + 1] == '"':
                    length += 1
                    i += 1
                else:
                    quoted = False
            else:
                length += 1
        elif char == '"' and start:
            quoted, start = True, False
        elif char == ',':
            columns += 1
            length, start = 0, True
        elif char in ("\r", "\n"):
            records += 1
            if records > MAX_ROWS + 1:
                raise _Invalid("FILE_LIMIT")
            if char == "\r" and i + 1 < len(text) and text[i + 1] == "\n":
                i += 1
            length, columns, start = 0, 1, True
        else:
            length += 1
            start = False
        if length > MAX_CELL_LENGTH or columns > MAX_COLUMNS:
            raise _Invalid("FILE_LIMIT")
        i += 1


def _money(value):
    value = PREFIX.sub("", value.strip(), count=1)
    if not MONEY.fullmatch(value):
        raise _Invalid("INVALID_MONEY")
    parts = value.replace(",", "").split(".")
    paise = int(parts[0]) * 100 + (int(parts[1].ljust(2, "0")) if len(parts) == 2 else 0)
    if paise <= 0 or paise > MAX_UNIT_PRICE:
        raise _Invalid("MONEY_OUT_OF_RANGE")
    return paise


def _integer(value, minimum, maximum):
    value = value.strip()
    if not INTEGER.fullmatch(value):
        raise _Invalid("INVALID_INTEGER")
    number = int(value)
    if number < minimum or number > maximum:
        raise _Invalid("INTEGER_OUT_OF_RANGE")
    return number


def parse(text):
    """Parse CSV text into quote-engine item dictionaries, or fixed errors."""
    if type(text) is not str:
        raise TypeError("Expected str")
    errors, items, row_count = [], [], 0

    def error(row, column, code):
        errors.append({"row": row, "column": column, "code": code})

    def output():
        result_items = sorted(items, key=lambda item: item["sku"]) if not errors else []
        digest = (hashlib.sha256(canonical_json({"parser_version": PARSER_VERSION,
                                               "items": result_items}).encode("utf-8")).hexdigest()
                  if not errors else None)
        return {"ok": not errors, "items": result_items, "errors": errors,
                "row_count": row_count, "canonical_hash": digest}

    try:
        _preflight(text)
    except _Invalid as exc:
        error(0, None, str(exc))
        return output()
    if text.startswith("\ufeff"):
        text = text[1:]
    # StringIO is an in-memory adapter; no file, network or global state changes.
    reader = csv.reader(StringIO(text, newline=""), delimiter=",", strict=True)
    header = None
    try:
        header = next(reader, None)
        if not header:
            error(0, None, "HEADER_REQUIRED")
            return output()
        header = [column.strip().lower() for column in header]
        if len(set(header)) != len(header):
            error(0, None, "DUPLICATE_COLUMN")
        if any(column not in ALLOWED for column in header):
            error(0, None, "UNKNOWN_COLUMN")
        for column in REQUIRED:
            if column not in header:
                error(0, column, "MISSING_COLUMN")
        for i in range(1, MAX_BREAKS + 1):
            qty, price = "min_qty_" + str(i), "price_" + str(i)
            if (qty in header) != (price in header):
                error(0, qty if qty not in header else price, "UNPAIRED_BREAK_COLUMN")
        if errors:
            return output()
        seen = set()
        for cells in reader:
            row_count += 1
            if row_count > MAX_ROWS or len(cells) > MAX_COLUMNS or any(len(c) > MAX_CELL_LENGTH for c in cells):
                errors[:] = [{"row": 0, "column": None, "code": "FILE_LIMIT"}]
                row_count = 0
                return output()
            if len(cells) != len(header):
                error(row_count, None, "ROW_WIDTH")
                continue
            values = dict(zip(header, cells))
            initial_errors = len(errors)
            sku = values["sku"]
            if not SKU.fullmatch(sku):
                error(row_count, "sku", "INVALID_SKU")
            elif sku.casefold() in seen:
                error(row_count, "sku", "DUPLICATE_SKU")
            else:
                seen.add(sku.casefold())
            name = values["name"].strip()
            if not name or len(name) > MAX_IDENTIFIER_LENGTH:
                error(row_count, "name", "INVALID_NAME")
            parsed = {}
            for column, parser, bounds in (("unit_price", _money, ()),
                                            ("moq", _integer, (1, MAX_QUANTITY_PER_LINE)),
                                            ("tax_bps", _integer, (0, MAX_TAX_BPS))):
                try:
                    parsed[column] = parser(values[column], *bounds)
                except _Invalid as exc:
                    error(row_count, column, str(exc))
            breaks, previous_qty, previous_price, gap = [], 0, parsed.get("unit_price"), False
            for i in range(1, MAX_BREAKS + 1):
                qty, price = "min_qty_" + str(i), "price_" + str(i)
                qvalue, pvalue = values.get(qty, "").strip(), values.get(price, "").strip()
                if not qvalue and not pvalue:
                    gap = True
                    continue
                if not qvalue or not pvalue:
                    error(row_count, qty if not qvalue else price, "INCOMPLETE_BREAK")
                    continue
                if gap:
                    error(row_count, qty, "BREAK_GAP")
                try:
                    q = _integer(qvalue, 1, MAX_QUANTITY_PER_LINE)
                except _Invalid as exc:
                    error(row_count, qty, str(exc))
                    continue
                try:
                    p = _money(pvalue)
                except _Invalid as exc:
                    error(row_count, price, str(exc))
                    continue
                if q < parsed.get("moq", 1) or q <= previous_qty or (previous_price is not None and p > previous_price):
                    error(row_count, qty if q < parsed.get("moq", 1) or q <= previous_qty else price, "INVALID_PRICE_BREAKS")
                breaks.append({"min_qty": q, "unit_price": p})
                previous_qty, previous_price = q, p
            if len(errors) == initial_errors:
                items.append({"sku": sku, "name": name, "unit_price": parsed["unit_price"],
                              "minimum_order_quantity": parsed["moq"], "price_breaks": breaks,
                              "tax_bps": parsed["tax_bps"]})
    except csv.Error:
        error(row_count + 1 if header else 0, None, "CSV_FORMAT")
    return output()
