"""The ONE door to lane C's pure requirement mapper (`packages/pure/requirement_mapper`, docs/plans/requirement-mapper.md).

The mapper PROPOSES: for each requirement line it says matched / ambiguous / unmatched / needs_human / needs_input and, for a matched line, an
order line. It never prices, never chooses between candidates and never writes. A PERSON confirms every proposal (a pick, `pick_requirement_line_product`);
the mapper's output is a suggestion with a hash, nothing more. Nothing else in the API may import `requirement_mapper`: a boundary test fails if another
module does. Like engine_port.py, the adapter gives lane A guarantees the package cannot give itself:

  * **Versioned and fail closed.** Only versions in ALLOWED_MAPPER_VERSIONS run; a missing package, an unknown version or a missing function raises
    MapperUnavailable (the API answers 503 and the manual pick path carries on). A golden test pins the canonical hash and the whole output of fixed
    requests, so a behaviour change without a version bump is caught.
  * **The documented hash is recomputed** on every run (sha256 of {"mapper_version", "inputs"} with the mapper's own normalisation: rows sorted by their
    canonical JSON, the catalog by sku, every mapping's value list sorted) and a different `canonical_hash` is refused.
  * **A result that is not what the contract says is refused:** an unknown line status, a result that does not say a human confirms it, another version.
  * **Nothing from the mapper leaks:** a wrong type becomes a fixed MapperInputError.

build_request assembles the mapper's input from what lane A holds, and it MINIMISES: only the LINE-level rows (saree type, quantity, fabric, colour) are sent.
The order-level rows (the delivery city, which can identify a person; payment terms; budget; deadline) never reach the mapper: it does not use them to match,
and their value slots differ from the requirement's. Every catalog product carries an EXPLICIT sale unit: the unit its price is quoted in (the price list
item's), or the tenant's `default_sale_unit` where it has none (the products table has no constrained sale unit: its `unit` is free text), so the mapper
never meets an unknown unit and never needs a human to supply one. A product the mapper could not read (no category, a non-text attribute) is left out and
REPORTED, never silently kept. No dependency is added: the package is stdlib-only and is put on the import path from the checkout when it is not already importable."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# The versions lane A has reviewed. Adding one is a deliberate act: read the mapper's changelog, re-run the golden vectors, move the pinned hashes.
ALLOWED_MAPPER_VERSIONS: frozenset[str] = frozenset({"1.0.0"})

MODULE_NAME = "requirement_mapper"
LINE_STATUSES = frozenset({"matched", "ambiguous", "unmatched", "needs_human", "needs_input"})
ROW_KEYS = ("line_no", "field_key", "value_code", "value_int", "value_date", "value_text", "basis")
CONFIG_KEYS = ("saree_type_to_categories", "fabric_to_values", "colour_to_values")
LINE_FIELD_KEYS = frozenset({"saree_type", "quantity", "fabric", "colour"})
SALE_UNITS = frozenset({"piece", "set"})
MAX_ATTRIBUTES = 20
MAX_STRING = 200


def _package_src(here: Path) -> Path | None:
    """app/quotes/mapper_port.py is four levels below the repository root; packages/pure holds the mapper. In a deployed image there is no checkout: None."""
    try:
        return here.resolve().parents[4] / "packages" / "pure"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class MapperUnavailable(Exception):
    """The mapper cannot be used (not importable, a version nobody reviewed, or a shape we do not know). Fail closed: the manual pick path still works."""

    code = "mapper_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class MapperError(Exception):
    """The mapper answered something the adapter does not accept (a hash that is not the documented one, an unknown status, no human confirmation)."""

    code = "mapper_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


class MapperInputError(Exception):
    """The request had a value of the wrong type. The mapper's own message is dropped."""

    code = "mapper_input_type"

    def __init__(self) -> None:
        super().__init__(self.code)


class _Mapper:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.MAPPER_VERSION
        self.map: Callable[[dict[str, Any]], dict[str, Any]] = module.map_requirements
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Mapper:
    version = getattr(module, "MAPPER_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_MAPPER_VERSIONS:
        raise MapperUnavailable
    if not callable(getattr(module, "map_requirements", None)) or not callable(
        getattr(module, "canonical_json", None)
    ):
        raise MapperUnavailable
    return _Mapper(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise MapperUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise MapperUnavailable from None


_mapper: _Mapper | None = None


def mapper() -> _Mapper:
    """The checked mapper (loaded once). Raises MapperUnavailable and keeps trying on the next call."""
    global _mapper
    if _mapper is None:
        _mapper = _check(_import())
    return _mapper


def mapper_version() -> str:
    return mapper().version


def canonical_json(value: Any) -> str:
    try:
        return mapper().canonical_json(value)
    except TypeError:
        raise MapperInputError from None
    except Exception as exc:  # the mapper's own _Invalid for a non-JSON value: its text names the value and is dropped
        if isinstance(exc, MapperUnavailable):
            raise
        raise MapperInputError from None


def expected_hash(request: dict[str, Any]) -> str:
    """The documented hash, computed here independently of the mapper: sha256 of canonical JSON of {"mapper_version", "inputs"}, where the rows are
    sorted by their canonical JSON, the catalog by sku, and every mapping's value list lexically (raw leaf values kept)."""
    m = mapper()
    try:
        inputs = {
            "fields": sorted(request["fields"], key=canonical_json),
            "catalog": sorted(request["catalog"], key=lambda p: p["sku"]),
            "config": {
                key: {code: sorted(values) for code, values in mapping.items()}
                for key, mapping in request["config"].items()
            },
        }
    except (KeyError, TypeError, AttributeError):
        raise MapperInputError from None
    return hashlib.sha256(
        canonical_json({"mapper_version": m.version, "inputs": inputs}).encode("utf-8")
    ).hexdigest()


def is_rejected(result: dict[str, Any]) -> bool:
    return result.get("status") == "rejected"


def run_mapper(request: dict[str, Any]) -> dict[str, Any]:
    """Run the mapper. Returns its dict: proposals (`lines`, `order_lines_proposal`, `flags`) or a structured rejection (`status: rejected`, `codes`).

    Raises MapperUnavailable (fail closed), MapperInputError (wrong types) or MapperError (the result is not what the contract says). The request is not modified."""
    m = mapper()
    try:
        result = m.map(request)
    except TypeError:
        raise MapperInputError from None
    if (
        not isinstance(result, dict)
        or result.get("mapper_version") != m.version
        or result.get("human_confirmation_required") is not True
    ):
        raise MapperError
    if is_rejected(result):
        if result.get("canonical_hash") is not None or not isinstance(result.get("codes"), list):
            raise MapperError
        return result
    lines = result.get("lines")
    if not isinstance(lines, list) or any(
        not isinstance(x, dict) or x.get("status") not in LINE_STATUSES for x in lines
    ):
        raise MapperError
    if result.get("canonical_hash") != expected_hash(request):
        raise MapperError
    return result


def _is_text(value: Any) -> bool:
    return isinstance(value, str) and bool(" ".join(value.split())) and len(value) <= MAX_STRING


def build_request(
    requirement_rows: list[dict[str, Any]],
    catalog: list[dict[str, Any]],
    config: dict[str, Any],
    default_sale_unit: str,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Assemble the mapper's input. Returns (request, skipped): `skipped` names every product left out and why (`no_category`, `bad_attributes`, `no_sku`).

    requirement_rows: requirement_v1 rows (line_no, field_key, value_code, value_int, value_date, value_text, basis, ...); only the LINE-level rows of the four
    keys the mapper reads are kept, reduced to exactly the mapper's row keys.
    catalog: {sku, category, attributes, active, sale_unit?}: sale_unit is the unit the product's price is quoted in; where it is missing (or not piece / set)
    the tenant's default_sale_unit is used, so every product carries an explicit unit.
    config: the mapper config's three maps (a missing map is empty)."""
    if default_sale_unit not in SALE_UNITS:
        raise MapperInputError
    rows = [
        {key: row.get(key) for key in ROW_KEYS}
        for row in requirement_rows
        if row.get("line_no") is not None and row.get("field_key") in LINE_FIELD_KEYS
    ]
    for row in rows:
        if row["field_key"] == "quantity":
            row["basis"] = row["basis"] if row["basis"] in SALE_UNITS else None
        else:
            row["basis"] = None
    products: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for item in catalog:
        sku = item.get("sku")
        if not _is_text(sku):
            skipped.append({"sku": str(sku)[:60], "reason": "no_sku"})
            continue
        attributes = item.get("attributes")
        if not _is_text(item.get("category")):
            skipped.append({"sku": str(sku), "reason": "no_category"})
            continue
        if (
            not isinstance(attributes, dict)
            or len(attributes) > MAX_ATTRIBUTES
            or any(not _is_text(k) or not _is_text(v) for k, v in attributes.items())
            or len({" ".join(k.casefold().split()) for k in attributes}) != len(attributes)
        ):
            skipped.append({"sku": str(sku), "reason": "bad_attributes"})
            continue
        unit = item.get("sale_unit")
        products.append(
            {
                "sku": sku,
                "category": item["category"],
                "attributes": dict(attributes),
                "active": bool(item.get("active", True)),
                "sale_unit": unit if unit in SALE_UNITS else default_sale_unit,
            }
        )
    request = {
        "fields": rows,
        "catalog": products,
        "config": {key: dict(config.get(key) or {}) for key in CONFIG_KEYS},
    }
    return request, skipped


def suggestions(result: dict[str, Any]) -> list[dict[str, Any]]:
    """The mapper's per-line proposals in the shape the screen shows: line, status, reason, candidates (raw skus, at most 20) and whether more were cut.
    A `matched` line has one candidate; an `ambiguous` one several; none is chosen. A person picks."""
    if is_rejected(result):
        return []
    return [
        {
            "line_no": line["line_no"],
            "status": line["status"],
            "reason": line.get("reason"),
            "candidates": list(line.get("candidates") or line.get("alternatives") or []),
            "truncated": bool(line.get("truncated")),
            "quantity": line.get("quantity"),
            "unit": line.get("unit"),
        }
        for line in result["lines"]
    ]
