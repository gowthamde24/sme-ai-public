"""T009 integration, commit 1: the adapter in front of lane C's pure quote engine (app/quotes/engine_port.py).

The GOLDEN vectors pin the engine's behaviour by value (canonical hash of the request and sha256 of the whole canonical output). If lane C changes the
engine, even without a version bump, these fail until a person reviews the change and moves the pins; if the version changes, ALLOWED_ENGINE_VERSIONS
makes the adapter fail closed first. Hand-checked expectations accompany the pins so they are not blind."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.quotes import engine_port
from app.quotes.engine_port import (
    ALLOWED_ENGINE_VERSIONS,
    QuoteEngineError,
    QuoteEngineUnavailable,
    QuoteInputError,
    canonical_json,
    engine_version,
    expected_hash,
    is_rejected,
    run_quote,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (ROOT / "packages" / "quote-engine" / "tests" / "fixtures" / "synthetic.json").read_text()
)

# a second synthetic request: two lines, a below-MOQ line, repeat customer over its credit limit, taxed shipping, half-paise rounding
V2: dict[str, Any] = {
    "as_of": "2026-02-28",
    "price_list": [
        {
            "sku": "SYN-X",
            "name": "Synthetic X",
            "unit_price": 12345,
            "minimum_order_quantity": 4,
            "price_breaks": [{"min_qty": 10, "unit_price": 11999}],
            "tax_bps": 500,
        },
        {
            "sku": "SYN-Y",
            "name": "Synthetic Y",
            "unit_price": 99999,
            "minimum_order_quantity": 1,
            "price_breaks": [],
            "tax_bps": 1200,
        },
    ],
    "customer": {"kind": "repeat", "credit_limit": 100000},
    "order_lines": [{"sku": "SYN-X", "qty": 3}, {"sku": "SYN-Y", "qty": 2}],
    "policy": {
        "discount_ceiling_bps": 0,
        "shipping": {"flat_fee": 5000, "free_above": 300000, "tax_bps": 1800},
        "validity_days": 30,
        "payment_terms": {"new_advance_bps": 5000, "repeat_advance_bps": 1000, "net_days": 45},
        "tax_mode": "exclusive",
    },
}

# (label, request, canonical_hash of the request, sha256 of the canonical output) for engine 1.1.0. Moving a pin is a reviewed act.
GOLDEN: list[tuple[str, dict[str, Any], str, str]] = [
    (
        "lane C fixture",
        FIXTURE,
        "03cf0189ba0aab67d49fdebaa800b0985499d1781b3482d953a3f4a740e2dbc9",
        "1c8e6dfc33e82d069039bf2e61e4408d1cd458a389bd7579b06e52891282e404",
    ),
    (
        "two lines, flags, taxed shipping",
        V2,
        "bd0832857d6b9a7c052355e8668ba32f8a8db206ad15fbf17f8271414c95b240",
        "012d355ecbc74ccdd2ad0c51399e83471a36eccee948acd1fc261bfb0e333087",
    ),
    (
        "empty order is rejected",
        {**V2, "order_lines": []},
        "db4830e8e880e12855474903f16f3893b59d90bdc84f9f6e1b987f0621e3cfd2",
        "9ac83bc7d64eb08420d31adacf1c00f7e37655bf43d110267f597196e13ea5dd",
    ),
    (
        "unknown sku is rejected",
        {**V2, "order_lines": [{"sku": "NOPE", "qty": 1}]},
        "d463640ade1f4d1238d4f3efdb82ccaccffff81684b503276cad1f8a695c7587",
        "5976dddf3ad1df6a8de25baef9bddf6c731d420990c3df14f9364cac68d6a25c",
    ),
]


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts from a not-yet-loaded adapter and leaves none behind."""
    monkeypatch.setattr(engine_port, "_engine", None)


# ---------------------------------------------------------------------------------------------- loading and versions
def test_the_engine_loads_from_the_repository_and_its_version_is_reviewed() -> None:
    assert engine_version() == "1.1.0"
    assert engine_version() in ALLOWED_ENGINE_VERSIONS
    assert ALLOWED_ENGINE_VERSIONS == frozenset(
        {"1.1.0"}
    )  # widening it is a deliberate edit of this test and of the constant


def _module(version: object = "1.1.0", **over: Any) -> ModuleType:
    module = ModuleType("quote_engine")
    module.ENGINE_VERSION = version  # type: ignore[attr-defined]
    module.quote = lambda request: {}  # type: ignore[attr-defined]
    module.canonical_json = lambda value: ""  # type: ignore[attr-defined]
    for key, value in over.items():
        setattr(module, key, value)
    return module


@pytest.mark.parametrize(
    "version", ["1.1.1", "1.2.0", "2.0.0", "1.0.0", "9.9.9", "", None, 1.1, ("1", "1", "0")]
)
def test_a_version_nobody_reviewed_fails_closed(version: object) -> None:
    with pytest.raises(QuoteEngineUnavailable):
        engine_port._check(_module(version))


def test_a_module_without_the_documented_surface_fails_closed() -> None:
    for missing in ("quote", "canonical_json", "ENGINE_VERSION"):
        module = _module()
        delattr(module, missing)
        with pytest.raises(QuoteEngineUnavailable):
            engine_port._check(module)
    with pytest.raises(QuoteEngineUnavailable):
        engine_port._check(_module(quote="not callable"))


def test_a_missing_package_fails_closed_and_the_adapter_keeps_trying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def refuse(name: str) -> ModuleType:
        raise ImportError(name)

    monkeypatch.setattr(engine_port, "_import_module", refuse)
    with pytest.raises(QuoteEngineUnavailable):
        engine_port._import(tmp_path / "does-not-exist")
    with pytest.raises(QuoteEngineUnavailable):
        engine_port._import(None)
    with pytest.raises(QuoteEngineUnavailable):
        engine_port.engine()
    assert engine_port._engine is None  # nothing was cached
    monkeypatch.undo()
    assert engine_version() == "1.1.0"  # and the next call loads it


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    """In the Docker image the file lives at /srv/app/quotes/engine_port.py: no repository root exists, and the module must still import."""
    assert engine_port._package_src(Path("/srv/app/quotes/engine_port.py")) is None
    assert engine_port._package_src(Path("/engine_port.py")) is None
    here = Path(engine_port.__file__)
    assert engine_port._package_src(here) == ROOT / "packages" / "quote-engine" / "src"


def test_the_package_path_is_appended_never_put_first(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Whatever is already importable must not be shadowed by the repository copy."""
    calls: list[str] = []
    sentinel = _module()

    def import_once_the_path_is_added(name: str) -> ModuleType:
        calls.append(name)
        if len(calls) == 1:
            raise ImportError(name)
        return sentinel

    monkeypatch.setattr(engine_port, "_import_module", import_once_the_path_is_added)
    monkeypatch.setattr(sys, "path", ["first", "second"])
    assert engine_port._import(tmp_path) is sentinel
    assert sys.path == ["first", "second", str(tmp_path)]


def test_an_unreviewed_version_in_the_loaded_package_makes_every_entry_point_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = engine_port._import()
    monkeypatch.setattr(
        engine_port,
        "_import",
        lambda src=None: _module("1.2.0", quote=real.quote, canonical_json=real.canonical_json),
    )
    for call in (
        engine_version,
        lambda: run_quote(FIXTURE),
        lambda: canonical_json({}),
        lambda: expected_hash(FIXTURE),
    ):
        with pytest.raises(QuoteEngineUnavailable):
            call()


# ---------------------------------------------------------------------------------------------- golden vectors
@pytest.mark.parametrize(
    ("label", "request_", "request_hash", "output_hash"), GOLDEN, ids=[g[0] for g in GOLDEN]
)
def test_golden_vectors_pin_the_engine_by_value(
    label: str, request_: dict[str, Any], request_hash: str, output_hash: str
) -> None:
    result = run_quote(request_)
    assert result["canonical_hash"] == request_hash == expected_hash(request_), label
    assert hashlib.sha256(canonical_json(result).encode("utf-8")).hexdigest() == output_hash, label


def test_the_hand_checked_numbers_behind_the_second_vector() -> None:
    r = run_quote(V2)
    assert r["status"] == "draft"
    # X: 3 x 123.45 = 370.35 (below MOQ 4, no break); tax 5 % = 18.5175 -> 18.52 (the half-paise rule). Y: 2 x 999.99 = 1999.98; tax 12 % = 239.9976 -> 240.00
    t = r["totals"]
    assert (t["net"], t["item_tax"], t["shipping"], t["shipping_tax"], t["total"]) == (
        237033,
        25852,
        5000,
        900,
        268785,
    )
    # advance: 10 % of 268,785 = 26,878.5 -> 26,879 (half up); balance = the rest; due 45 days after 2026-02-28; valid 30 days
    assert r["payment_terms"] == {
        "advance_amount": 26879,
        "balance": 241906,
        "due_date": "2026-04-14",
    }
    assert r["valid_until"] == "2026-03-30"
    assert [f["code"] for f in r["flags"]["reasons"]] == [
        "BELOW_MINIMUM_ORDER_QUANTITY",
        "CREDIT_LIMIT_EXCEEDED",
    ]
    assert r["flags"]["needs_owner_approval"] is True


def test_the_fixture_is_a_draft_that_needs_no_owner_approval() -> None:
    r = run_quote(FIXTURE)
    assert r["status"] == "draft" and r["flags"] == {"needs_owner_approval": False, "reasons": []}
    assert r["totals"]["total"] == 33950


# ---------------------------------------------------------------------------------------------- results and rejections
def test_a_rejection_is_returned_not_raised() -> None:
    rejected = run_quote({**V2, "order_lines": []})
    assert (
        is_rejected(rejected) and rejected["codes"] == ["EMPTY_ORDER"] and "totals" not in rejected
    )
    unknown = run_quote({**V2, "order_lines": [{"sku": "NOPE", "qty": 1}]})
    assert (
        is_rejected(unknown)
        and unknown["codes"] == ["UNKNOWN_SKU"]
        and unknown["flags"]["needs_owner_approval"] is True
    )
    assert not is_rejected(run_quote(V2))


def test_an_oversized_request_is_rejected_before_hashing_and_is_never_a_draft() -> None:
    big = {
        **V2,
        "order_lines": [{"sku": "SYN-Y", "qty": 1}] * 101,
    }  # one line above the engine's 100-line maximum
    result = run_quote(big)
    assert (
        is_rejected(result)
        and result["codes"] == ["OUT_OF_RANGE"]
        and result["canonical_hash"] is None
    )


def test_the_request_is_not_modified_and_the_output_is_deterministic() -> None:
    before = copy.deepcopy(V2)
    first, second = run_quote(V2), run_quote(V2)
    assert V2 == before
    assert canonical_json(first).encode("utf-8") == canonical_json(second).encode("utf-8")
    assert canonical_json({"b": 1, "a": [1, {"d": 2, "c": 3}]}) == '{"a":[1,{"c":3,"d":2}],"b":1}'


def test_the_documented_hash_is_recomputed_here() -> None:
    payload = json.dumps(
        {"engine_version": "1.1.0", "inputs": V2},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    assert expected_hash(V2) == hashlib.sha256(payload.encode("utf-8")).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", expected_hash(V2))


# ---------------------------------------------------------------------------------------------- a result that is not what the contract says
def _with_engine(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    real = engine_port._import()
    monkeypatch.setattr(
        engine_port,
        "_engine",
        engine_port._Engine(
            _module(
                "1.1.0",
                quote=lambda request: transform(real.quote(request)),
                canonical_json=real.canonical_json,
            )
        ),
    )


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: {**r, "canonical_hash": "f" * 64},  # a hash that is not the documented one
        lambda r: {**r, "canonical_hash": None},  # a draft that was never hashed
        lambda r: {**r, "engine_version": "1.0.0"},
        lambda r: {**r, "status": "approved"},
        lambda r: {k: v for k, v in r.items() if k != "status"},
        lambda r: [r],
    ],
    ids=[
        "wrong hash",
        "draft without hash",
        "other version",
        "unknown status",
        "no status",
        "not a dict",
    ],
)
def test_an_inconsistent_engine_answer_is_refused(
    monkeypatch: pytest.MonkeyPatch, transform: Any
) -> None:
    _with_engine(monkeypatch, transform)
    with pytest.raises(QuoteEngineError):
        run_quote(V2)


# ---------------------------------------------------------------------------------------------- wrong types never echo the value
@pytest.mark.parametrize(
    "bad",
    [
        {**V2, "order_lines": [{"sku": "SYN-X", "qty": 3.5}]},
        {**V2, "order_lines": [{"sku": "SYN-X", "qty": True}]},
        {**V2, "customer": {"kind": "new", "credit_limit": 1.5}},
        {**V2, "price_list": [object()]},
    ],
    ids=["float", "bool", "float credit", "non-JSON"],
)
def test_wrong_types_become_a_fixed_error_without_the_value(bad: dict[str, Any]) -> None:
    with pytest.raises(QuoteInputError) as caught:
        run_quote(bad)
    assert str(caught.value) == "quote_input_type" and "3.5" not in repr(caught.value)
    with pytest.raises(QuoteInputError):
        canonical_json({"x": 1.5})


# ---------------------------------------------------------------------------------------------- the door is the only door
def test_only_the_adapter_names_the_engine_package() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(p.relative_to(app))
        for p in app.rglob("*.py")
        if p.name != "engine_port.py" and "quote_engine" in p.read_text()
    ]
    assert offenders == []


def test_the_agent_sandbox_and_the_requirement_package_never_import_the_quote_path() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    for package in ("agents", "requirements", "enquiries"):
        offenders = [
            str(p.relative_to(app))
            for p in (app / package).rglob("*.py")
            if re.search(r"(?m)^\s*(from|import)\s+app\.quotes\b", p.read_text())
        ]
        assert offenders == [], package
