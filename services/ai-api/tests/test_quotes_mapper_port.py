"""T009 integration: the adapter in front of lane C's pure requirement mapper (app/quotes/mapper_port.py).

The GOLDEN vectors pin the mapper's behaviour by value (canonical hash of the request and sha256 of the whole canonical output). A change by lane C, even
without a version bump, fails them until a person reviews it; a new version makes the adapter fail closed first. The mapper only PROPOSES: nothing here picks a
product, prices anything or confirms anything; a person does."""

# ruff: noqa: E501, S311

from __future__ import annotations

import copy
import hashlib
import json
import random
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.quotes import mapper_port
from app.quotes.mapper_port import (
    ALLOWED_MAPPER_VERSIONS,
    MapperError,
    MapperInputError,
    MapperUnavailable,
    build_request,
    canonical_json,
    expected_hash,
    is_rejected,
    mapper_version,
    run_mapper,
    suggestions,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (
        ROOT / "packages" / "pure" / "requirement_mapper" / "tests" / "fixtures" / "synthetic.json"
    ).read_text()
)


def row(line: int | None, key: str, **kw: Any) -> dict[str, Any]:
    base = {
        "line_no": line,
        "field_key": key,
        "value_code": None,
        "value_int": None,
        "value_date": None,
        "value_text": None,
        "basis": None,
    }
    return {**base, **kw}


CFG = {
    "saree_type_to_categories": {"kanjivaram": ["kanjivaram"], "banarasi": ["banarasi"]},
    "fabric_to_values": {"silk": ["silk"]},
    "colour_to_values": {"red": ["red"], "blue": ["blue"]},
}


def prod(
    sku: str,
    category: str,
    fabric: str = "silk",
    colour: str = "red",
    unit: str = "piece",
    active: bool = True,
) -> dict[str, Any]:
    return {
        "sku": sku,
        "category": category,
        "attributes": {"fabric": fabric, "colour": colour},
        "active": active,
        "sale_unit": unit,
    }


CAT = [
    prod("SYN-KJ-RED", "kanjivaram"),
    prod("SYN-KJ-BLUE", "kanjivaram", colour="blue"),
    prod("SYN-BN-RED", "banarasi"),
    prod("SYN-BN-RED2", "banarasi"),
    prod("SYN-BN-SET", "banarasi", colour="blue", unit="set"),
]
VECTORS: dict[str, dict[str, Any]] = {
    "matched": {
        "fields": [
            row(1, "saree_type", value_code="kanjivaram"),
            row(1, "quantity", value_int=12, basis="piece"),
            row(1, "colour", value_code="blue"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "ambiguous": {
        "fields": [
            row(1, "saree_type", value_code="banarasi"),
            row(1, "quantity", value_int=5, basis="piece"),
            row(1, "colour", value_code="red"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "unmatched": {
        "fields": [
            row(1, "saree_type", value_code="paithani"),
            row(1, "quantity", value_int=5, basis="piece"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "unit_mismatch": {
        "fields": [
            row(1, "saree_type", value_code="banarasi"),
            row(1, "quantity", value_int=3, basis="piece"),
            row(1, "colour", value_code="blue"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "needs_input": {
        "fields": [
            row(1, "saree_type", value_code="kanjivaram"),
            row(1, "colour", value_code="red"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "needs_human": {
        "fields": [
            row(1, "saree_type", value_code="other"),
            row(1, "quantity", value_int=5, basis="piece"),
        ],
        "catalog": CAT,
        "config": CFG,
    },
    "rejected": {
        "fields": [row(1, "quantity", value_int=5, basis="box")],
        "catalog": CAT,
        "config": CFG,
    },
}
# (label, request, canonical hash of the request (None for a rejection), sha256 of the canonical output, expected line statuses or codes) for mapper 1.0.0
GOLDEN: list[tuple[str, dict[str, Any], str | None, str, list[str]]] = [
    (
        "lane C fixture",
        FIXTURE,
        "48abf392964caaca5a24bd0c51a41ebf510a2138282b95a851003f6e7fe1a452",
        "cc46d26ae68b2e93df8e1bfd27e0e28138a40f97d0a128016c23e47f190c269c",
        ["matched"],
    ),
    (
        "matched",
        VECTORS["matched"],
        "67d18fde538261e49b179957847fdbc1d16b3647564d8cf975116f5ff2caacdd",
        "4ad091562e44b17beb6d0cd43671efc8d1d9bfc655016e698cb381cd5d50c259",
        ["matched"],
    ),
    (
        "ambiguous",
        VECTORS["ambiguous"],
        "57e4968cf75e5b123f7a7b07e546b69e99de70424f2e2906f46970c5ef7585b3",
        "d2a612970d7cd4c4752ddb5e8d16088a22bd455647654a6adeb7f722eb13e659",
        ["ambiguous"],
    ),
    (
        "unmatched",
        VECTORS["unmatched"],
        "e3987b9feb00223d40eef7955e0199f18186951686481779f2b32c587a7b2373",
        "9241ba59bd07300df94c9cc270e3a2a70e08fbd022e63c18bc789de70a7ba238",
        ["unmatched"],
    ),
    (
        "unit mismatch needs a human",
        VECTORS["unit_mismatch"],
        "91be3bd91481cca9e2f6aa31ae5725480a956475420d372ee8edea398ed8a52d",
        "730d411287dec0f95f6a91a7aa240d7523241c41c9cbf269229db2be9c7eae38",
        ["needs_human"],
    ),
    (
        "a missing quantity needs input",
        VECTORS["needs_input"],
        "a409d8a863e382a9bf71f08233fe1818e16c60315c3ac3f946712c0a453acdcd",
        "10f3654703cd465bfad034006ddb3863a69ba386979f0a90d2af15df03a7daeb",
        ["needs_input"],
    ),
    (
        "an 'other' code needs a human",
        VECTORS["needs_human"],
        "2eca9a2a49fef41f9797cb4cfec4625e120c87bb6de4c4152e763b38652cb1dd",
        "bbcd4501dba0893c56ea628473940e7a069c58fa5a9dd1b623e970a4f8be5d31",
        ["needs_human"],
    ),
    (
        "a unit that is neither piece nor set is rejected",
        VECTORS["rejected"],
        None,
        "30586c9890cfd43d6ea5c692642a216a71d23b36bbf7de3907dc29d2f37cb0ac",
        ["INVALID_UNIT"],
    ),
]


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mapper_port, "_mapper", None)


# ---------------------------------------------------------------------------------------------- loading and versions
def test_the_mapper_loads_from_the_repository_and_its_version_is_reviewed() -> None:
    assert mapper_version() == "1.0.0" and mapper_version() in ALLOWED_MAPPER_VERSIONS
    assert ALLOWED_MAPPER_VERSIONS == frozenset(
        {"1.0.0"}
    )  # widening it is a deliberate edit of this test and of the constant


def _module(version: object = "1.0.0", **over: Any) -> ModuleType:
    module = ModuleType("requirement_mapper")
    module.MAPPER_VERSION = version  # type: ignore[attr-defined]
    module.map_requirements = lambda request: {}  # type: ignore[attr-defined]
    module.canonical_json = lambda value: ""  # type: ignore[attr-defined]
    for key, value in over.items():
        setattr(module, key, value)
    return module


@pytest.mark.parametrize(
    "version", ["1.0.1", "1.1.0", "2.0.0", "0.9.0", "", None, 1.0, ("1", "0", "0")]
)
def test_a_version_nobody_reviewed_fails_closed(version: object) -> None:
    with pytest.raises(MapperUnavailable):
        mapper_port._check(_module(version))


def test_a_module_without_the_documented_surface_fails_closed() -> None:
    for missing in ("map_requirements", "canonical_json", "MAPPER_VERSION"):
        module = _module()
        delattr(module, missing)
        with pytest.raises(MapperUnavailable):
            mapper_port._check(module)
    with pytest.raises(MapperUnavailable):
        mapper_port._check(_module(map_requirements="not callable"))


def test_a_missing_package_fails_closed_and_the_adapter_keeps_trying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def refuse(name: str) -> ModuleType:
        raise ImportError(name)

    monkeypatch.setattr(mapper_port, "_import_module", refuse)
    with pytest.raises(MapperUnavailable):
        mapper_port._import(tmp_path / "does-not-exist")
    with pytest.raises(MapperUnavailable):
        mapper_port._import(None)
    with pytest.raises(MapperUnavailable):
        mapper_port.mapper()
    assert mapper_port._mapper is None  # nothing was cached
    monkeypatch.undo()
    assert mapper_version() == "1.0.0"


def test_an_unreviewed_version_in_the_loaded_package_makes_every_entry_point_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = mapper_port._import()
    monkeypatch.setattr(
        mapper_port,
        "_import",
        lambda src=None: _module(
            "1.1.0", map_requirements=real.map_requirements, canonical_json=real.canonical_json
        ),
    )
    for call in (
        mapper_version,
        lambda: run_mapper(VECTORS["matched"]),
        lambda: canonical_json({}),
        lambda: expected_hash(VECTORS["matched"]),
    ):
        with pytest.raises(MapperUnavailable):
            call()


def test_the_package_path_is_appended_never_put_first(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[str] = []
    sentinel = _module()

    def import_once_the_path_is_added(name: str) -> ModuleType:
        calls.append(name)
        if len(calls) == 1:
            raise ImportError(name)
        return sentinel

    monkeypatch.setattr(mapper_port, "_import_module", import_once_the_path_is_added)
    monkeypatch.setattr(sys, "path", ["first", "second"])
    assert mapper_port._import(tmp_path) is sentinel
    assert sys.path == ["first", "second", str(tmp_path)]


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    assert mapper_port._package_src(Path("/srv/app/quotes/mapper_port.py")) is None
    assert mapper_port._package_src(Path("/mapper_port.py")) is None
    assert mapper_port._package_src(Path(mapper_port.__file__)) == ROOT / "packages" / "pure"


# ---------------------------------------------------------------------------------------------- golden vectors
@pytest.mark.parametrize(
    ("label", "request_", "request_hash", "output_hash", "expected"),
    GOLDEN,
    ids=[g[0] for g in GOLDEN],
)
def test_golden_vectors_pin_the_mapper_by_value(
    label: str,
    request_: dict[str, Any],
    request_hash: str | None,
    output_hash: str,
    expected: list[str],
) -> None:
    result = run_mapper(request_)
    assert result.get("canonical_hash") == request_hash, label
    if request_hash is not None:
        assert request_hash == expected_hash(request_), label
        assert [x["status"] for x in result["lines"]] == expected, label
    else:
        assert is_rejected(result) and result["codes"] == expected, label
    assert hashlib.sha256(canonical_json(result).encode("utf-8")).hexdigest() == output_hash, label
    assert result["human_confirmation_required"] is True


def test_what_the_mapper_proposes_and_what_it_leaves_to_a_person() -> None:
    matched = run_mapper(VECTORS["matched"])
    assert matched["order_lines_proposal"] == [
        {"sku": "SYN-KJ-BLUE", "qty": 12, "discount_bps": 0}
    ]  # only a matched line proposes an order line (and never a discount)
    ambiguous = run_mapper(VECTORS["ambiguous"])
    assert ambiguous["order_lines_proposal"] == [] and ambiguous["lines"][0]["candidates"] == [
        "SYN-BN-RED",
        "SYN-BN-RED2",
    ]  # several: no choice is made
    assert run_mapper(VECTORS["unit_mismatch"])["lines"][0]["reason"] == "unit_mismatch"
    for name in ("unmatched", "needs_input", "needs_human"):
        assert run_mapper(VECTORS[name])["order_lines_proposal"] == []


def test_the_documented_hash_is_recomputed_here_and_ignores_the_order_of_lists() -> None:
    base = VECTORS["ambiguous"]
    rng = random.Random(7)
    shuffled = copy.deepcopy(base)
    for key in ("fields", "catalog"):
        rng.shuffle(shuffled[key])
    shuffled["config"]["saree_type_to_categories"]["banarasi"] = ["banarasi"]
    assert expected_hash(shuffled) == expected_hash(base) == run_mapper(shuffled)["canonical_hash"]
    irrelevant = copy.deepcopy(base)
    irrelevant["catalog"].append(prod("SYN-ZZ", "paithani"))
    assert expected_hash(irrelevant) != expected_hash(
        base
    )  # the hash identifies the whole input snapshot
    assert re.fullmatch(r"[0-9a-f]{64}", expected_hash(base))


def test_the_request_is_not_modified_and_the_output_is_deterministic() -> None:
    before = copy.deepcopy(VECTORS["matched"])
    first, second = run_mapper(VECTORS["matched"]), run_mapper(VECTORS["matched"])
    assert VECTORS["matched"] == before and canonical_json(first) == canonical_json(second)


# ---------------------------------------------------------------------------------------------- a result that is not what the contract says
def _with_mapper(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    real = mapper_port._import()
    monkeypatch.setattr(
        mapper_port,
        "_mapper",
        mapper_port._Mapper(
            _module(
                "1.0.0",
                map_requirements=lambda request: transform(real.map_requirements(request)),
                canonical_json=real.canonical_json,
            )
        ),
    )


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: {**r, "canonical_hash": "f" * 64},
        lambda r: {**r, "canonical_hash": None},
        lambda r: {**r, "human_confirmation_required": False},
        lambda r: {k: v for k, v in r.items() if k != "human_confirmation_required"},
        lambda r: {**r, "mapper_version": "0.9.0"},
        lambda r: {**r, "lines": [{**r["lines"][0], "status": "approved"}]},
        lambda r: {**r, "lines": "matched"},
        lambda r: [r],
    ],
    ids=[
        "wrong hash",
        "no hash",
        "no human confirmation",
        "flag missing",
        "other version",
        "unknown line status",
        "lines not a list",
        "not a dict",
    ],
)
def test_an_inconsistent_mapper_answer_is_refused(
    monkeypatch: pytest.MonkeyPatch, transform: Any
) -> None:
    _with_mapper(monkeypatch, transform)
    with pytest.raises(MapperError):
        run_mapper(VECTORS["matched"])


def test_a_rejection_that_carries_a_hash_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    _with_mapper(monkeypatch, lambda r: {**r, "canonical_hash": "a" * 64})
    with pytest.raises(MapperError):
        run_mapper(VECTORS["rejected"])


@pytest.mark.parametrize(
    "bad",
    [
        {**VECTORS["matched"], "fields": [row(1, "quantity", value_int=1.5, basis="piece")]},
        {**VECTORS["matched"], "fields": [row(1, "quantity", value_int=True, basis="piece")]},
        {**VECTORS["matched"], "catalog": [object()]},
    ],
    ids=["float", "bool", "non-JSON"],
)
def test_wrong_types_are_a_structured_rejection_with_no_partial_proposals_and_no_echo(
    bad: dict[str, Any],
) -> None:
    out = run_mapper(bad)
    assert is_rejected(out) and out["codes"] == ["INVALID_TYPE"] and out["canonical_hash"] is None
    assert (
        "lines" not in out
        and "order_lines_proposal" not in out
        and "1.5" not in canonical_json({k: v for k, v in out.items() if k != "message"})
    )
    assert suggestions(out) == []


# ---------------------------------------------------------------------------------------------- build_request: what the mapper is given
REQUIREMENT_ROWS = [
    {
        "requirement_id": "r",
        "tenant_id": "t",
        "enquiry_id": "e",
        "schema_version": 1,
        "confirmed_by": "u",
        "confirmed_at": "2026-10-06T00:00:00Z",
        "field_id": "f1",
        "state": "confirmed",
        **row(1, "saree_type", value_code="kanjivaram"),
    },
    {"field_id": "f2", "state": "corrected", **row(1, "quantity", value_int=12, basis="piece")},
    {"field_id": "f3", "state": "confirmed", **row(1, "colour", value_code="blue", basis="piece")},
    {
        "field_id": "f4",
        "state": "confirmed",
        **row(None, "delivery_city", value_text="CANARY-CITY-5531"),
    },
    {
        "field_id": "f5",
        "state": "confirmed",
        **row(None, "payment_terms", value_code="net_days", value_int=30, basis="days"),
    },
    {
        "field_id": "f6",
        "state": "confirmed",
        **row(None, "budget", value_int=5000000, basis="per_piece"),
    },
    {"field_id": "f7", "state": "confirmed", **row(None, "deadline", value_date="2026-11-15")},
    {
        "field_id": "f8",
        "state": "confirmed",
        **row(1, "delivery_city", value_text="CANARY-LINE-CITY"),
    },  # malformed: an order-level key on a line; it must not be forwarded
]
CATALOG_ROWS = [
    {
        "sku": "SYN-KJ-BLUE",
        "category": "kanjivaram",
        "attributes": {"fabric": "silk", "colour": "blue"},
        "active": True,
        "sale_unit": "piece",
    },
    {
        "sku": "SYN-KJ-RED",
        "category": "kanjivaram",
        "attributes": {"fabric": "silk", "colour": "red"},
        "active": True,
    },  # no unit of its own: the tenant default
]


def test_only_the_line_rows_reach_the_mapper_and_the_city_never_does() -> None:
    request, skipped = build_request(REQUIREMENT_ROWS, CATALOG_ROWS, CFG, "piece")
    assert skipped == []
    assert [(r["line_no"], r["field_key"]) for r in request["fields"]] == [
        (1, "saree_type"),
        (1, "quantity"),
        (1, "colour"),
    ]
    assert all(set(r) == set(mapper_port.ROW_KEYS) for r in request["fields"])
    assert (
        "CANARY-CITY-5531" not in json.dumps(request)
        and "payment_terms" not in json.dumps(request)
        and "budget" not in json.dumps(request)
    )
    assert request["fields"][2]["basis"] is None  # a colour has no basis (the mapper refuses one)
    result = run_mapper(request)
    assert [x["status"] for x in result["lines"]] == ["matched"] and result["lines"][0][
        "candidates"
    ] == ["SYN-KJ-BLUE"]
    assert "CANARY-CITY-5531" not in json.dumps(result)
    assert "CANARY-LINE-CITY" not in json.dumps(request) and all(
        r["field_key"] != "delivery_city" for r in request["fields"]
    )


def test_every_product_carries_an_explicit_sale_unit() -> None:
    request, _ = build_request(REQUIREMENT_ROWS, CATALOG_ROWS, CFG, "set")
    assert {p["sku"]: p["sale_unit"] for p in request["catalog"]} == {
        "SYN-KJ-BLUE": "piece",
        "SYN-KJ-RED": "set",
    }  # its own unit, else the tenant default
    request, _ = build_request(
        REQUIREMENT_ROWS,
        [{**CATALOG_ROWS[1], "sale_unit": "box"}, {**CATALOG_ROWS[0], "sale_unit": None}],
        CFG,
        "piece",
    )
    assert [p["sale_unit"] for p in request["catalog"]] == [
        "piece",
        "piece",
    ]  # an unusable unit is replaced, never passed on
    assert all(p["sale_unit"] in ("piece", "set") for p in request["catalog"])


def test_a_default_sale_unit_that_is_not_piece_or_set_is_refused() -> None:
    for bad in ("box", "", "PIECE"):
        with pytest.raises(MapperInputError):
            build_request(REQUIREMENT_ROWS, CATALOG_ROWS, CFG, bad)


def test_a_product_the_mapper_could_not_read_is_left_out_and_reported() -> None:
    bad: list[dict[str, Any]] = [
        {"sku": "A-NO-CAT", "category": None, "attributes": {}, "active": True},
        {"sku": "B-BLANK-CAT", "category": "  ", "attributes": {}, "active": True},
        {
            "sku": "C-NON-TEXT",
            "category": "kanjivaram",
            "attributes": {"colour": 5},
            "active": True,
        },
        {
            "sku": "D-DUP-KEY",
            "category": "kanjivaram",
            "attributes": {"Colour": "red", "colour ": "blue"},
            "active": True,
        },
        {
            "sku": "E-TOO-MANY",
            "category": "kanjivaram",
            "attributes": {f"k{i}": "v" for i in range(21)},
            "active": True,
        },
        {"sku": "F-NO-ATTRS", "category": "kanjivaram", "attributes": None, "active": True},
        {"sku": "   ", "category": "kanjivaram", "attributes": {}, "active": True},
        {"category": "kanjivaram", "attributes": {}, "active": True},
        {"sku": "G-OK", "category": "kanjivaram", "attributes": {}, "active": False},
    ]
    request, skipped = build_request(REQUIREMENT_ROWS, bad, CFG, "piece")
    assert [p["sku"] for p in request["catalog"]] == ["G-OK"] and request["catalog"][0][
        "active"
    ] is False
    assert {s["sku"]: s["reason"] for s in skipped if s["sku"].strip() and s["sku"] != "None"} == {
        "A-NO-CAT": "no_category", "B-BLANK-CAT": "no_category", "C-NON-TEXT": "bad_attributes", "D-DUP-KEY": "bad_attributes", "E-TOO-MANY": "bad_attributes", "F-NO-ATTRS": "bad_attributes",
    }  # fmt: skip
    assert sorted(s["reason"] for s in skipped if s["reason"] == "no_sku") == ["no_sku", "no_sku"]
    assert run_mapper(request)["canonical_hash"] is not None  # what is left is a valid snapshot


def test_a_missing_config_map_is_empty_not_absent() -> None:
    request, _ = build_request(
        REQUIREMENT_ROWS,
        CATALOG_ROWS,
        {"saree_type_to_categories": {"kanjivaram": ["kanjivaram"]}},
        "piece",
    )
    assert request["config"] == {
        "saree_type_to_categories": {"kanjivaram": ["kanjivaram"]},
        "fabric_to_values": {},
        "colour_to_values": {},
    }
    assert not is_rejected(run_mapper(request))


def test_suggestions_have_the_shape_the_screen_shows() -> None:
    got = suggestions(run_mapper(VECTORS["ambiguous"]))
    assert got == [
        {
            "line_no": 1,
            "status": "ambiguous",
            "reason": None,
            "candidates": ["SYN-BN-RED", "SYN-BN-RED2"],
            "truncated": False,
            "quantity": 5,
            "unit": "piece",
        }
    ]
    assert suggestions(run_mapper(VECTORS["rejected"])) == []
    unmatched = suggestions(run_mapper(VECTORS["unmatched"]))[0]
    assert unmatched["status"] == "unmatched" and unmatched["candidates"] == []


def test_a_failed_fabric_or_colour_filter_shows_its_alternatives_as_candidates() -> None:
    """Fabric and colour failures show the products that passed the filters before them; lane A shows them as candidates a person MAY pick (nothing is proposed)."""
    request = {
        "fields": [
            row(1, "saree_type", value_code="banarasi"),
            row(1, "quantity", value_int=5, basis="piece"),
            row(1, "colour", value_code="green"),
        ],
        "catalog": CAT,
        "config": CFG,
    }
    result = run_mapper(request)
    assert result["lines"][0]["status"] == "unmatched" and result["order_lines_proposal"] == []
    got = suggestions(result)[0]
    assert got["status"] == "unmatched" and got["candidates"] == [
        "SYN-BN-RED",
        "SYN-BN-RED2",
        "SYN-BN-SET",
    ], got
    assert got["candidates"] == result["lines"][0]["alternatives"]


def test_nothing_the_mapper_returns_is_a_price() -> None:
    for name in VECTORS:
        text = canonical_json(run_mapper(VECTORS[name]))
        assert "unit_price" not in text and "paise" not in text and "total" not in text


# ---------------------------------------------------------------------------------------------- the door is the only door
def test_only_the_adapter_names_the_mapper_package() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(p.relative_to(app))
        for p in app.rglob("*.py")
        if p.name != "mapper_port.py" and "requirement_mapper" in p.read_text()
    ]
    assert offenders == []
