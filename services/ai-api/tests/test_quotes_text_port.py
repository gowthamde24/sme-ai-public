"""T009 step 3: the adapter in front of lane C's pure quote text renderer (app/quotes/text_port.py).

The GOLDEN vector pins the renderer by value (the hash of its inputs and sha256 of the whole text). The request is built by OUR builder and priced by the REAL engine, so a change
in either shows here too. The numbers behind it were checked by hand: 20 x 3,800.00 + 5 x 3,100.00 = 91,500.00 net; GST 3,800.00 + 1,860.00 = 5,660.00; freight 50.00 + 9.00 GST;
grand total 97,219.00."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import hashlib
import sys
from datetime import date
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.quotes import engine_port, text_port
from app.quotes.builder import Line, Pick, Policy, PriceItem, RequirementFacts, build_request
from app.quotes.text_port import (
    ALLOWED_RENDERER_VERSIONS,
    TextRefused,
    TextUnavailable,
    render_approved,
    renderer_version,
)

ITEMS = {
    "p1": PriceItem(
        "p1", "SYN-K", "Synthetic kanjivaram", "piece", 400000, 4, 500, ((10, 380000),)
    ),
    "p2": PriceItem("p2", "SYN-B", "Synthetic banarasi", "piece", 310000, 4, 1200),
}
POLICY = Policy(0, 5000, None, 1800, 15, 5000, 2500, 30, "half_up", 0, "TG")
FACTS = RequirementFacts(
    lines=[Line(1, "kanjivaram", 20, "piece"), Line(2, "banarasi", 5, "piece")]
)
REQUEST = build_request(
    date(2026, 10, 6),
    "new",
    FACTS,
    [Pick(1, "p1", 20, "piece"), Pick(2, "p2", 5, "piece")],
    ITEMS,
    POLICY,
)
RESULT = engine_port.run_quote(REQUEST)
HASH = RESULT["canonical_hash"]
DISPLAY: dict[str, Any] = {
    "seller_name": "Synthetic Silks",
    "customer_name": "Synthetic Buyer",
    "quote_ref": "Q-00001",
    "issued_on": "2026-10-06",
    "valid_until": "2026-10-21",
    "line_labels": {"SYN-K": "Synthetic kanjivaram", "SYN-B": "Synthetic banarasi"},
    "payment_terms_text": "Advance first.",
    "notes": ["Prices in INR."],
}
GOLDEN_RENDER_HASH = "1c1696e493901eff6cc4199c7a399d67f2b6b56ac3edeca31c742a28d3a3ffff"
GOLDEN_TEXT_SHA = "55d4542c2fad9837e36b7fde85aaa6dddba8bcd4524d59f2d94ff752ec0b7e50"


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(text_port, "_renderer", None)


def test_the_renderer_loads_and_its_version_is_reviewed() -> None:
    assert renderer_version() in ALLOWED_RENDERER_VERSIONS == frozenset({"1.0.0"})


def test_golden_vector_pins_the_renderer_by_value() -> None:
    assert HASH == "30bc79cfbad24bf70d035bdafb9e89167bbc2a97b62253e93051b9c6f0dc7b2c"
    out = render_approved(RESULT, HASH, DISPLAY)
    assert (
        out["canonical_hash"] == GOLDEN_RENDER_HASH
        and hashlib.sha256(out["text"].encode()).hexdigest() == GOLDEN_TEXT_SHA
    )
    assert out["line_count"] == 35 and out["renderer_version"] == "1.0.0"
    lines = out["text"].split("\n")
    assert (
        lines[0] == "Approved quote"
        and "Grand total: ₹97,219.00" in lines
        and "Advance: ₹48,609.50" in lines
        and "GST (12%): ₹1,860.00" in lines
    )
    assert all(len(x) <= 60 for x in lines) and not out["text"].endswith("\n")
    assert render_approved(RESULT, HASH, DISPLAY) == out  # deterministic


def test_a_hash_that_is_not_the_results_is_refused_with_a_fixed_reason() -> None:
    with pytest.raises(TextRefused) as e:
        render_approved(RESULT, "0" * 64, DISPLAY)
    assert (
        e.value.reason == "HASH_MISMATCH"
        and e.value.code == "quote_text_refused"
        and "0" * 8 not in str(e.value)
    )


def test_a_result_that_was_changed_after_the_fact_is_refused() -> None:
    tampered = copy.deepcopy(RESULT)
    tampered["totals"]["total"] -= 100
    with pytest.raises(TextRefused):
        render_approved(tampered, HASH, DISPLAY)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("customer_name", "Buyer\nFake line: Grand total: ₹1.00"),
        ("seller_name", ""),
        ("quote_ref", "Q-1‮"),
        ("issued_on", "06/10/2026"),
        ("valid_until", "2026-10-22"),  # not the engine's validity
        ("line_labels", {"SYN-K": "Synthetic kanjivaram"}),  # a label missing for a line
        ("notes", ["x"] * 11),
        ("payment_terms_text", "*" * 5),
    ],
)
def test_bad_display_values_are_refused(field: str, value: Any) -> None:
    with pytest.raises(TextRefused):
        render_approved(RESULT, HASH, {**DISPLAY, field: value})


def test_the_inputs_are_not_modified() -> None:
    before = copy.deepcopy((RESULT, DISPLAY))
    render_approved(RESULT, HASH, DISPLAY)
    assert (RESULT, DISPLAY) == before


_REAL = text_port._import()


def _module_with(monkeypatch: pytest.MonkeyPatch, **attrs: Any) -> None:
    real = _REAL
    monkeypatch.setattr(
        text_port, "_renderer", None
    )  # the adapter caches its renderer: start from nothing each time
    fake = ModuleType("quote_text")
    for name in ("RENDERER_VERSION", "render", "canonical_json"):
        setattr(fake, name, getattr(real, name))
    for name, value in attrs.items():
        setattr(fake, name, value)
    monkeypatch.setattr(text_port, "_import", lambda *a, **k: fake)


@pytest.mark.parametrize("version", ["1.0.1", "2.0.0", "", None, 1])
def test_a_version_nobody_reviewed_fails_closed(
    monkeypatch: pytest.MonkeyPatch, version: object
) -> None:
    _module_with(monkeypatch, RENDERER_VERSION=version)
    with pytest.raises(TextUnavailable):
        render_approved(RESULT, HASH, DISPLAY)


def test_a_module_without_the_documented_surface_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _module_with(monkeypatch, render=None)
    with pytest.raises(TextUnavailable):
        render_approved(RESULT, HASH, DISPLAY)


def test_a_missing_package_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(name: str) -> ModuleType:
        raise ImportError(name)

    monkeypatch.setattr(text_port, "_import_module", refuse)
    monkeypatch.setattr(text_port, "_PACKAGE_SRC", None)
    with pytest.raises(TextUnavailable):
        render_approved(RESULT, HASH, DISPLAY)


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    assert text_port._package_src(Path("/app/quotes/text_port.py")) is None


def test_the_package_path_is_appended_never_put_first(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls: list[int] = []

    def import_once_the_path_is_added(name: str) -> ModuleType:
        calls.append(1)
        if len(calls) == 1:
            raise ImportError(name)
        return ModuleType(name)

    monkeypatch.setattr(text_port, "_import_module", import_once_the_path_is_added)
    monkeypatch.setattr(sys, "path", ["first", "second"])
    text_port._import(tmp_path)
    assert sys.path == ["first", "second", str(tmp_path)]


@pytest.mark.parametrize(
    "answer",
    [
        None,
        "text",
        {"text": 5, "line_count": 1, "canonical_hash": "x"},
        {
            "text": "a\nb",
            "line_count": 3,
            "canonical_hash": "x",
        },  # a line count that is not the text's
        {"text": "x" * 61, "line_count": 1, "canonical_hash": "x"},  # wider than the contract
        {
            "text": "ok",
            "line_count": 1,
            "canonical_hash": "0" * 64,
        },  # a hash that is not the documented one
        {"status": "rejected", "code": "NOT_APPROVED", "message": "Quote is not approved."},
    ],
)
def test_an_inconsistent_renderer_answer_is_refused(
    monkeypatch: pytest.MonkeyPatch, answer: Any
) -> None:
    _module_with(monkeypatch, render=lambda request: answer)
    with pytest.raises(TextRefused):
        render_approved(RESULT, HASH, DISPLAY)


def test_a_rejection_keeps_only_the_renderers_fixed_code(monkeypatch: pytest.MonkeyPatch) -> None:
    _module_with(
        monkeypatch,
        render=lambda request: {
            "status": "rejected",
            "code": "UNSAFE_STRING",
            "message": "Invalid quote text request.",
        },
    )
    with pytest.raises(TextRefused) as e:
        render_approved(RESULT, HASH, DISPLAY)
    assert e.value.reason == "UNSAFE_STRING"
    _module_with(
        monkeypatch,
        render=lambda request: {
            "status": "rejected",
            "code": "contains a canary value",
            "message": "x",
        },
    )
    with pytest.raises(TextRefused) as e2:
        render_approved(RESULT, HASH, DISPLAY)
    assert e2.value.reason == "INCONSISTENT"  # a free-text code is never passed on


def test_approval_is_always_asserted_by_the_adapters_caller_not_the_renderer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[dict[str, Any]] = []
    real = _REAL

    def spy(request: dict[str, Any]) -> dict[str, Any]:
        seen.append(request)
        return real.render(request)  # type: ignore[no-any-return]

    _module_with(monkeypatch, render=spy)
    render_approved(RESULT, HASH, DISPLAY)
    assert (
        seen[0]["approved"] is True
        and seen[0]["expected_engine_hash"] == HASH
        and seen[0]["quote"] == RESULT
    )


def test_only_the_adapter_names_the_renderer_package() -> None:
    root = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(p.relative_to(root))
        for p in root.rglob("*.py")
        if p.name != "text_port.py"
        and "quote_text" in p.read_text()
        and "quote_text" in "".join(ln for ln in p.read_text().splitlines() if "import" in ln)
    ]
    assert offenders == []
