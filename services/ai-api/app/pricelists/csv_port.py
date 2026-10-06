"""The ONE door to lane C's pure price-list CSV parser (`packages/pure/price_list_csv`, docs/plans/price-list-csv.md).

The parser turns CSV text into engine-shaped items or fixed error codes; it reads no file, no network and no clock, and it echoes no cell. The adapter gives lane A the guarantees the package
cannot give itself, the same way `app/orders/lifecycle_port.py` does for the lifecycle:

  * **Versioned.** Only versions in ALLOWED_PARSER_VERSIONS run; a new one fails closed (PriceCsvUnavailable) until a person has read its changelog, re-run the golden vectors and added it here.
  * **Fail closed.** A missing package, an unknown version or a missing function raises PriceCsvUnavailable (the API answers 503); the API still boots.
  * **Consistency check, not authentication.** The package hashes `{"parser_version", "items"}` with ITS OWN `canonical_json`, and the adapter recomputes the digest with that same function. That detects a
    result that is inconsistent with itself (a hash that does not belong to its items, a result altered on the way); it does NOT prove the package is the reviewed one, because a wrong package would compute
    a matching hash for its own output. The protection against a wrong or changed package is the version allow-list above and the golden vectors in `tests/test_pricelists_csv_port.py`, which pin the output
    by value. The adapter also refuses a result of a shape it does not know (PriceCsvError) and an error code that is not on the closed list below: no unreviewed word reaches a client.
  * **Nothing from the package leaks.** Errors carry a fixed code only.

No dependency is added: the package is stdlib-only and is put on the import path from the repository checkout when it is not already importable."""

from __future__ import annotations

import hashlib
import sys
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# The versions lane A has reviewed (the golden vectors in tests/test_pricelists_csv_port.py pin the behaviour by value).
ALLOWED_PARSER_VERSIONS: frozenset[str] = frozenset({"1.0.0"})
MODULE_NAME = "price_list_csv"

# The parser's closed error codes (docs/plans/price-list-csv.md). Anything else is refused.
PARSER_CODES: tuple[str, ...] = (
    "FILE_LIMIT", "INVALID_UTF8", "HEADER_REQUIRED", "DUPLICATE_COLUMN", "UNKNOWN_COLUMN", "MISSING_COLUMN", "UNPAIRED_BREAK_COLUMN", "CSV_FORMAT", "ROW_WIDTH", "INVALID_SKU",
    "DUPLICATE_SKU", "INVALID_NAME", "INVALID_MONEY", "MONEY_OUT_OF_RANGE", "INVALID_INTEGER", "INTEGER_OUT_OF_RANGE", "INCOMPLETE_BREAK", "BREAK_GAP", "INVALID_PRICE_BREAKS",
)  # fmt: skip
COLUMNS: tuple[str, ...] = (
    "sku", "name", "unit_price", "moq", "tax_bps", "min_qty_1", "price_1", "min_qty_2", "price_2", "min_qty_3", "price_3", "min_qty_4", "price_4", "min_qty_5", "price_5",
)  # fmt: skip


class PriceCsvUnavailable(Exception):
    """The parser cannot be used: not importable, a version nobody reviewed, or a surface we do not know. Fail closed."""

    code = "price_csv_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class PriceCsvError(Exception):
    """The package answered something the adapter does not accept (a hash that is not the documented one, a result of an unknown shape, a code that is not on the closed list)."""

    code = "price_csv_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


def _package_src(here: Path) -> Path | None:
    try:
        return here.resolve().parents[4] / "packages" / "pure"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))
_module: ModuleType | None = None


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise PriceCsvUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise PriceCsvUnavailable from None


def _checked(module: ModuleType) -> ModuleType:
    version = getattr(module, "PARSER_VERSION", None)
    if (
        not isinstance(version, str)
        or version not in ALLOWED_PARSER_VERSIONS
        or not callable(getattr(module, "parse", None))
        or not callable(getattr(module, "canonical_json", None))
    ):
        raise PriceCsvUnavailable
    return module


def _parser() -> ModuleType:
    global _module
    if _module is None:
        _module = _checked(_import())
    return _module


def parser_version() -> str:
    return str(_parser().PARSER_VERSION)


def _shape_ok(result: Any) -> bool:
    if (
        not isinstance(result, dict)
        or type(result.get("ok")) is not bool
        or type(result.get("row_count")) is not int
    ):
        return False
    errors, items = result.get("errors"), result.get("items")
    if not isinstance(errors, list) or not isinstance(items, list):
        return False
    for e in errors:
        if (
            not isinstance(e, dict)
            or type(e.get("row")) is not int
            or e.get("code") not in PARSER_CODES
        ):
            return False
        if e.get("column") is not None and e.get("column") not in COLUMNS:
            return False
    if result["ok"]:
        return (
            not errors
            and isinstance(result.get("canonical_hash"), str)
            and len(result["canonical_hash"]) == 64
        )
    return bool(errors) and not items and result.get("canonical_hash") is None


def _is_int(value: Any) -> bool:
    return type(value) is int  # not a bool, not a float, not a string


def _item_ok(item: Any) -> bool:
    """An engine-shaped item: exactly these keys, text for sku and name, whole numbers for the money, the minimum and the rate, and breaks of exactly two whole numbers."""
    if not isinstance(item, dict) or set(item) != {
        "sku",
        "name",
        "unit_price",
        "minimum_order_quantity",
        "price_breaks",
        "tax_bps",
    }:
        return False
    if not isinstance(item["sku"], str) or not isinstance(item["name"], str):
        return False
    if not all(_is_int(item[k]) for k in ("unit_price", "minimum_order_quantity", "tax_bps")):
        return False
    breaks = item["price_breaks"]
    return isinstance(breaks, list) and all(
        isinstance(b, dict)
        and set(b) == {"min_qty", "unit_price"}
        and _is_int(b["min_qty"])
        and _is_int(b["unit_price"])
        for b in breaks
    )


def parse(text: str) -> dict[str, Any]:
    """Parse the CSV text. Returns the package's dict (`ok`, `items`, `errors`, `row_count`, `canonical_hash`) after the adapter's checks.

    Raises PriceCsvUnavailable (fail closed) or PriceCsvError (the result is not what the contract says). The text is not modified and is never logged."""
    module = _parser()
    result = module.parse(text)
    if not _shape_ok(result):
        raise PriceCsvError
    if result["ok"]:
        payload = module.canonical_json(
            {"parser_version": module.PARSER_VERSION, "items": result["items"]}
        )
        if hashlib.sha256(payload.encode("utf-8")).hexdigest() != result["canonical_hash"]:
            raise PriceCsvError
        for item in result["items"]:
            if not _item_ok(item):
                raise PriceCsvError
    parsed: dict[str, Any] = result
    return parsed
