"""The adapter in front of lane C's pure price-list CSV parser (app/pricelists/csv_port.py): the GOLDEN vector pins the package by value, an unreviewed version fails closed, a result that
is not the contract is refused, and no module but the adapter imports the package."""

# ruff: noqa: E501

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.pricelists import csv_port
from app.pricelists.csv_port import (
    PARSER_CODES,
    PriceCsvError,
    PriceCsvUnavailable,
    parse,
    parser_version,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (
        ROOT / "packages" / "pure" / "price_list_csv" / "tests" / "fixtures" / "synthetic.json"
    ).read_text()
)
GOLDEN_CSV = "sku,name,unit_price,moq,tax_bps,min_qty_1,price_1\nSYN-B,Weave B,1200,2,500,10,1000\nSYN-A,Weave A,0.01,1,0,,\n"
# the canonical hash of the validated items of GOLDEN_CSV under parser 1.0.0 (pinned by value: a behaviour change without a version bump fails here)
GOLDEN_HASH = "d77bb3c8a62e7f7d33d429f7b416cb3754c6748b9a3638e7fbaf1d6e0f1d95ab"


def test_the_package_version_is_the_reviewed_one() -> None:
    assert parser_version() == "1.0.0" and csv_port.ALLOWED_PARSER_VERSIONS == {"1.0.0"}


def test_the_golden_vector_pins_the_parser_by_value() -> None:
    result = parse(GOLDEN_CSV)
    assert result["ok"] is True and result["row_count"] == 2
    assert [i["sku"] for i in result["items"]] == ["SYN-A", "SYN-B"], "sorted by sku"
    assert result["items"][0] == {
        "sku": "SYN-A",
        "name": "Weave A",
        "unit_price": 1,
        "minimum_order_quantity": 1,
        "price_breaks": [],
        "tax_bps": 0,
    }
    assert result["items"][1]["price_breaks"] == [{"min_qty": 10, "unit_price": 100000}]
    assert result["canonical_hash"] == GOLDEN_HASH


def test_the_packages_own_fixture_still_parses_to_its_expected_items() -> None:
    result = parse(FIXTURE["csv"])
    assert result["ok"] and result["items"] == FIXTURE["expected_items"]


@pytest.mark.parametrize(
    ("text", "row", "column", "code"),
    [
        ("sku,name,unit_price,moq\nA,x,1,1\n", 0, "tax_bps", "MISSING_COLUMN"),
        ("sku,name,unit_price,moq,tax_bps,extra\nA,x,1,1,0,1\n", 0, None, "UNKNOWN_COLUMN"),
        ("sku,name,unit_price,moq,tax_bps\n=CMD,x,1,1,0\n", 1, "sku", "INVALID_SKU"),
        ("sku,name,unit_price,moq,tax_bps\nA,x,1,1,0\na,y,1,1,0\n", 2, "sku", "DUPLICATE_SKU"),
        ("sku,name,unit_price,moq,tax_bps\nA,x,abc,1,0\n", 1, "unit_price", "INVALID_MONEY"),
        ("sku,name,unit_price,moq,tax_bps\nA,x,0,1,0\n", 1, "unit_price", "MONEY_OUT_OF_RANGE"),
        ("sku,name,unit_price,moq,tax_bps\nA,x,1,0,0\n", 1, "moq", "INTEGER_OUT_OF_RANGE"),
        ("sku,name,unit_price,moq,tax_bps\nA,x,1,1\n", 1, None, "ROW_WIDTH"),
        ("sku,name,unit_price,moq,tax_bps\nA,,1,1,0\n", 1, "name", "INVALID_NAME"),
    ],
)
def test_each_refusal_names_a_row_a_known_column_and_a_closed_code(
    text: str, row: int, column: str | None, code: str
) -> None:
    result = parse(text)
    assert result["ok"] is False and result["items"] == [] and result["canonical_hash"] is None
    assert (row, column, code) in [(e["row"], e["column"], e["code"]) for e in result["errors"]]
    assert code in PARSER_CODES


def test_an_error_never_echoes_a_cell() -> None:
    result = parse("sku,name,unit_price,moq,tax_bps\n=SECRET-CELL,Zeta Plant,not-a-number,1,0\n")
    assert (
        "SECRET" not in repr(result)
        and "Zeta" not in repr(result)
        and "not-a-number" not in repr(result)
    )


class _Fake(ModuleType):
    def __init__(self, version: str = "1.0.0", result: Any = None, drop: str | None = None) -> None:
        super().__init__("price_list_csv")
        self.PARSER_VERSION = version
        self._result = result
        if drop != "parse":
            self.parse = lambda text: self._result
        if drop != "canonical_json":
            self.canonical_json = lambda value: json.dumps(
                value, sort_keys=True, separators=(",", ":")
            )


@pytest.fixture
def fresh(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(csv_port, "_module", None)
    return monkeypatch


def _ok(items: list[dict[str, Any]], digest: str | None = None) -> dict[str, Any]:
    payload = json.dumps(
        {"items": items, "parser_version": "1.0.0"}, sort_keys=True, separators=(",", ":")
    )
    return {
        "ok": True,
        "items": items,
        "errors": [],
        "row_count": len(items),
        "canonical_hash": digest or hashlib.sha256(payload.encode()).hexdigest(),
    }


ITEM = {
    "sku": "A",
    "name": "x",
    "unit_price": 1,
    "minimum_order_quantity": 1,
    "price_breaks": [],
    "tax_bps": 0,
}


def test_an_unreviewed_version_fails_closed(fresh: pytest.MonkeyPatch) -> None:
    fresh.setattr(csv_port, "_import", lambda: _Fake(version="1.0.1", result=_ok([ITEM])))
    with pytest.raises(PriceCsvUnavailable):
        parse("x")


@pytest.mark.parametrize("drop", ["parse", "canonical_json"])
def test_a_missing_function_fails_closed(fresh: pytest.MonkeyPatch, drop: str) -> None:
    fresh.setattr(csv_port, "_import", lambda: _Fake(result=_ok([ITEM]), drop=drop))
    with pytest.raises(PriceCsvUnavailable):
        parse("x")


def test_a_package_that_is_not_importable_fails_closed(
    fresh: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fresh.delitem(__import__("sys").modules, "price_list_csv", raising=False)
    fresh.setattr(csv_port, "_PACKAGE_SRC", tmp_path / "nowhere")
    fresh.setattr(
        __import__("sys"), "path", [p for p in __import__("sys").path if "packages/pure" not in p]
    )
    with pytest.raises(PriceCsvUnavailable):
        csv_port._import(tmp_path / "nowhere")


@pytest.mark.parametrize(
    "result",
    [
        None,
        {"ok": "yes", "items": [], "errors": [], "row_count": 0, "canonical_hash": None},
        {
            "ok": True,
            "items": [],
            "errors": [{"row": 1, "column": None, "code": "FILE_LIMIT"}],
            "row_count": 0,
            "canonical_hash": "0" * 64,
        },
        {"ok": False, "items": [], "errors": [], "row_count": 0, "canonical_hash": None},
        {
            "ok": False,
            "items": [ITEM],
            "errors": [{"row": 1, "column": None, "code": "ROW_WIDTH"}],
            "row_count": 1,
            "canonical_hash": None,
        },
        {
            "ok": False,
            "items": [],
            "errors": [{"row": 1, "column": None, "code": "SOMETHING_NEW"}],
            "row_count": 1,
            "canonical_hash": None,
        },
        {
            "ok": False,
            "items": [],
            "errors": [{"row": 1, "column": "secret_column", "code": "ROW_WIDTH"}],
            "row_count": 1,
            "canonical_hash": None,
        },
        {
            "ok": False,
            "items": [],
            "errors": [{"row": "1", "column": None, "code": "ROW_WIDTH"}],
            "row_count": 1,
            "canonical_hash": None,
        },
    ],
)
def test_a_result_that_is_not_the_contract_is_refused(
    fresh: pytest.MonkeyPatch, result: Any
) -> None:
    fresh.setattr(csv_port, "_import", lambda: _Fake(result=result))
    with pytest.raises(PriceCsvError):
        parse("x")


def test_a_hash_that_is_not_the_documented_one_is_refused(fresh: pytest.MonkeyPatch) -> None:
    fresh.setattr(csv_port, "_import", lambda: _Fake(result=_ok([ITEM], digest="f" * 64)))
    with pytest.raises(PriceCsvError):
        parse("x")
    fresh.setattr(csv_port, "_module", None)
    fresh.setattr(csv_port, "_import", lambda: _Fake(result=_ok([ITEM])))
    assert parse("x")["ok"] is True


def test_an_item_of_another_shape_is_refused(fresh: pytest.MonkeyPatch) -> None:
    fresh.setattr(csv_port, "_import", lambda: _Fake(result=_ok([{**ITEM, "extra": 1}])))
    with pytest.raises(PriceCsvError):
        parse("x")


def test_no_module_but_the_adapter_imports_the_parser() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    for path in app.rglob("*.py"):
        if path.name == "csv_port.py":
            continue
        for node in ast.walk(ast.parse(path.read_text())):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else []
            )
            assert not any(
                n == "price_list_csv" or n.startswith("price_list_csv.") for n in names
            ), f"{path} imports the parser"
            if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "import_module":
                assert "price_list_csv" not in ast.dump(node), f"{path} imports the parser"
