"""T009 step 3: the adapter in front of lane C's pure quote text renderer (app/quotes/text_port.py).

The GOLDEN vector pins the renderer by value (the hash of its inputs and sha256 of the whole text). The request is built by OUR builder and priced by the REAL engine, so a change
in either shows here too. The numbers behind it were checked by hand: 20 x 3,800.00 + 5 x 3,100.00 = 91,500.00 net; GST 3,800.00 + 1,860.00 = 5,660.00; freight 50.00 + 9.00 GST;
grand total 97,219.00."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import hashlib
import json
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
POLICY = Policy(0, 5000, None, 1800, 15, 5000, 2500, 30, 30, "half_up", 0, "TG")
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
    "payment_terms_text": "An advance is payable before dispatch; the balance by the due date.",
    "notes": [
        "Prices are in Indian rupees (INR).",
        "GST is shown separately as a line.",
        "This is a quote, not an invoice.",
    ],
}


def independent_render_hash(version: str, request: dict[str, Any]) -> str:
    """The renderer's documented hash, written out here WITHOUT importing the renderer (docs/plans/quote-text.md, packages/pure/quote_text/VERSIONS.md): sha256 of the sorted, compact, ASCII JSON of
    {"renderer_version": V, "inputs": request}. It is itself pinned by GOLDEN_RENDER_HASH_1_0_0 below, a value written down when only 1.0.0 existed."""
    blob = json.dumps(
        {"renderer_version": version, "inputs": request},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# The hash of the renderer's inputs INCLUDES its version, so the same request has a different hash under each version:
#  - 1_0_0: the value this file pinned when 1.0.0 was the only renderer. It is kept so that `independent_render_hash` is proven right against a value that predates it.
#  - GOLDEN_RENDER_HASH: CHANGED for 1.2.0 (it was the value above). Derived with `independent_render_hash("1.2.0", ...)`, not copied from the renderer's answer; the renderer's answer is asserted equal to it.
GOLDEN_RENDER_HASH_1_0_0 = "713c15d77a0b95b5725b7f7112e63b5f70d73f75aa02068ffee42c7466bc850d"
GOLDEN_RENDER_HASH = "65a1e2bdbd10de6f13ce258b67e035947a5fa453322507e82c99401fb9636564"
# UNCHANGED on purpose. The golden quote has a NON-ZERO shipping fee (50.00 + 9.00 GST) and no joiner, so 1.2.0 (which only leaves out shipping lines that are zero) and 1.1.0 (which only
# allows joiners) print byte for byte what 1.0.0 printed. test_the_golden_text_is_what_every_renderer_version_prints proves it against the frozen modules.
GOLDEN_TEXT_SHA = "97e1da16db5718d5e14fd736708fcff46e129f9b6643929281ee9bbde18c7624"
GOLDEN_REQUEST: dict[str, Any] = {
    "quote": RESULT,
    "approved": True,
    "expected_engine_hash": HASH,
    "display": DISPLAY,
}


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(text_port, "_renderer", None)


def test_the_renderer_loads_and_its_version_is_reviewed() -> None:
    assert renderer_version() in ALLOWED_RENDERER_VERSIONS == frozenset({"1.2.0"})
    assert renderer_version() == "1.2.0"


def test_golden_vector_pins_the_renderer_by_value() -> None:
    assert HASH == "30bc79cfbad24bf70d035bdafb9e89167bbc2a97b62253e93051b9c6f0dc7b2c"
    out = render_approved(RESULT, HASH, DISPLAY)
    assert (
        out["canonical_hash"] == GOLDEN_RENDER_HASH
        and hashlib.sha256(out["text"].encode()).hexdigest() == GOLDEN_TEXT_SHA
    )
    assert out["line_count"] == 38 and out["renderer_version"] == "1.2.0"
    assert out["canonical_hash"] == independent_render_hash("1.2.0", GOLDEN_REQUEST)
    lines = out["text"].split("\n")
    assert (
        lines[0] == "Approved quote"
        and "Grand total: ₹97,219.00" in lines
        and "Advance: ₹48,609.50" in lines
        and "GST (12%): ₹1,860.00" in lines
    )
    assert all(len(x) <= 60 for x in lines) and not out["text"].endswith("\n")
    assert render_approved(RESULT, HASH, DISPLAY) == out  # deterministic


def test_the_independent_hash_is_right_because_it_reproduces_the_value_pinned_for_1_0_0() -> None:
    assert independent_render_hash("1.0.0", GOLDEN_REQUEST) == GOLDEN_RENDER_HASH_1_0_0
    assert GOLDEN_RENDER_HASH == independent_render_hash("1.2.0", GOLDEN_REQUEST)
    assert GOLDEN_RENDER_HASH != GOLDEN_RENDER_HASH_1_0_0  # the version is part of what is hashed


def test_the_golden_text_is_what_every_renderer_version_prints() -> None:
    """1.1.0 and 1.2.0 change nothing for a request that has no joiner and no zero shipping line, and the frozen modules still say so."""
    package = text_port._import()
    texts = {
        v: package.renderer_for(v).render(GOLDEN_REQUEST)["text"]
        for v in ("1.0.0", "1.1.0", "1.2.0")
    }
    assert len(set(texts.values())) == 1
    assert hashlib.sha256(texts["1.0.0"].encode()).hexdigest() == GOLDEN_TEXT_SHA
    assert (
        package.renderer_for("1.0.0").render(GOLDEN_REQUEST)["canonical_hash"]
        == GOLDEN_RENDER_HASH_1_0_0
    )


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


@pytest.mark.parametrize(
    "version", ["1.0.0", "1.1.0", "1.0.1", "1.2.1", "1.3.0", "2.0.0", "", None, 1]
)
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


def test_a_line_wider_than_the_contract_is_refused_even_with_a_correct_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def answer(width: int) -> Any:
        def render(request: dict[str, Any]) -> dict[str, Any]:
            digest = hashlib.sha256(
                _REAL.canonical_json(
                    {"renderer_version": _REAL.RENDERER_VERSION, "inputs": request}
                ).encode("utf-8")
            ).hexdigest()
            return {"text": "x" * width, "line_count": 1, "canonical_hash": digest}

        return render

    _module_with(monkeypatch, render=answer(60))
    assert render_approved(RESULT, HASH, DISPLAY)["text"] == "x" * 60  # the limit itself is allowed
    _module_with(monkeypatch, render=answer(61))
    with pytest.raises(TextRefused):
        render_approved(RESULT, HASH, DISPLAY)


def test_the_golden_display_is_the_wording_the_service_chooses_for_these_amounts() -> None:
    from app.quotes import service

    terms = RESULT["payment_terms"]
    assert DISPLAY["payment_terms_text"] == service.payment_terms_text(
        terms["advance_amount"], terms["balance"]
    )
    assert DISPLAY["notes"] == list(service.NOTES)
    text = render_approved(RESULT, HASH, DISPLAY)["text"]
    assert (
        "Payment terms: An advance is payable before dispatch; the\nbalance by the due date."
        in text
    )
    assert (
        "- GST is shown separately as a line." in text and "GST (5%): ₹3,800.00" in text
    )  # said once in the notes and shown as a line per item


def test_the_payment_wording_follows_the_amounts() -> None:
    from app.quotes import service

    assert (
        service.payment_terms_text(4860950, 4860950)
        == "An advance is payable before dispatch; the balance by the due date."
    )
    assert (
        service.payment_terms_text(97219, 0)
        == "The whole amount is payable in advance, before dispatch."
    )
    assert service.payment_terms_text(0, 97219) == "The whole amount is payable by the due date."
    assert service.payment_terms_text(0, 0) == "No payment is due."
    assert service.payment_terms_text(1, 1) == service.payment_terms_text(
        50, 99999
    )  # only the shape matters, never the size
    for bad in ((-1, 5), (5, -1)):
        with pytest.raises(ValueError):
            service.payment_terms_text(*bad)
    for amounts in (
        (4860950, 4860950),
        (97219, 0),
        (0, 97219),
        (0, 0),
    ):  # every wording is accepted by the renderer
        render_approved(
            RESULT, HASH, {**DISPLAY, "payment_terms_text": service.payment_terms_text(*amounts)}
        )


# ----------------------------------------------------------------------------- 1.1.0: joiners (U+200C / U+200D) after an Indic letter or mark
TELUGU = "\u0c15\u0c4d\u200d\u0c37"  # KA, virama, ZWJ, SSA
KANNADA = "\u0c95\u0ccd\u200d\u0cb7"  # KA, virama, ZWJ, SSA
MALAYALAM_CHILLU = "\u0d28\u0d4d\u200d"  # NA, virama, ZWJ: a chillu at the end of a word
MALAYALAM_ZWNJ = "\u0d15\u0d4d\u200c\u0d37"  # KA, virama, ZWNJ, SSA
DEVANAGARI = "\u0915\u094d\u200d\u0937"  # KA, virama, ZWJ, SSA


def labelled(label: str) -> dict[str, Any]:
    return {**DISPLAY, "line_labels": {**DISPLAY["line_labels"], "SYN-K": label}}


@pytest.mark.parametrize(
    "name",
    [
        f"{TELUGU} pattu",
        f"{KANNADA} silk",
        f"{MALAYALAM_CHILLU} set",
        f"{MALAYALAM_ZWNJ} cotton",
        f"{DEVANAGARI} banarasi",
        f"Synthetic {TELUGU}",
        MALAYALAM_CHILLU,  # a name that ends with the joiner
    ],
)
def test_a_product_name_with_a_joiner_after_an_indic_letter_or_mark_renders(name: str) -> None:
    out = render_approved(RESULT, HASH, labelled(name))
    assert name in out["text"].split("\n")  # on a line of its own, joiners intact
    assert any(ch in out["text"] for ch in "\u200c\u200d")
    assert out["renderer_version"] == "1.2.0" and out["canonical_hash"] == independent_render_hash(
        "1.2.0",
        {
            "quote": RESULT,
            "approved": True,
            "expected_engine_hash": HASH,
            "display": labelled(name),
        },
    )


@pytest.mark.parametrize(
    ("name", "why"),
    [
        ("Syn\u200dthetic", "between Latin letters"),
        ("Syn\u200cthetic", "between Latin letters (non-joiner)"),
        ("\u200dSynthetic", "at the start"),
        ("Synthetic \u200dkanjivaram", "after a space"),
        ("Synthetic 5\u200d", "after a digit"),
        ("\u0c67\u200d pattu", "after an Indic digit"),
        ("\u0c15\u0c4d\u200d\u200d\u0c37", "twice in a row"),
        ("\u0c15\u0c4d\u200b\u0c37", "a zero-width space right after an Indic mark"),
        ("\u0c15\u0c4d\u2060\u0c37", "a word joiner right after an Indic mark"),
        ("\u0c15\u0964\u200d", "after a danda"),
    ],
)
def test_a_joiner_anywhere_else_is_still_refused_with_the_renderers_fixed_code(
    name: str, why: str
) -> None:
    with pytest.raises(TextRefused) as e:
        render_approved(RESULT, HASH, labelled(name))
    assert e.value.reason == "UNSAFE_STRING", why
    assert e.value.code == "quote_text_refused" and name not in str(e.value)


def test_the_joiner_rule_is_the_same_for_every_string_the_renderer_validates() -> None:
    assert render_approved(RESULT, HASH, {**DISPLAY, "customer_name": f"{TELUGU} traders"})
    assert render_approved(RESULT, HASH, {**DISPLAY, "seller_name": f"{MALAYALAM_CHILLU} silks"})
    for field in ("customer_name", "seller_name"):
        with pytest.raises(TextRefused):
            render_approved(RESULT, HASH, {**DISPLAY, field: "Syn\u200dthetic"})


# ----------------------------------------------------------------------------- 1.2.0: a shipping line whose amount is zero is not printed
def _result_with(
    fee: int, free_above: int | None = None, shipping_tax_bps: int = 1800
) -> dict[str, Any]:
    policy = Policy(
        0, fee, free_above, shipping_tax_bps, 15, 5000, 2500, 30, 30, "half_up", 0, "TG"
    )
    return engine_port.run_quote(
        build_request(
            date(2026, 10, 6),
            "new",
            FACTS,
            [Pick(1, "p1", 20, "piece"), Pick(2, "p2", 5, "piece")],
            ITEMS,
            policy,
        )
    )


def _lines(result: dict[str, Any]) -> list[str]:
    text: str = render_approved(result, result["canonical_hash"], DISPLAY)["text"]
    return text.split("\n")


SHIPPING_PREFIXES = ("Shipping net", "GST on shipping", "Shipping total")


def test_a_quote_with_non_zero_shipping_prints_the_three_lines_exactly_as_before() -> None:
    lines = _lines(RESULT)
    # freight 50.00 + 9.00 GST (18%) = 59.00, worked out by hand in the module docstring
    assert lines[
        lines.index("GST on merchandise: ₹5,660.00") + 1 : lines.index("GST total: ₹5,669.00")
    ] == [
        "Shipping net: ₹50.00",
        "GST on shipping (18%): ₹9.00",
        "Shipping total: ₹59.00",
    ]
    assert len(lines) == 38 and "Grand total: ₹97,219.00" in lines


def test_a_quote_with_zero_shipping_prints_no_shipping_line() -> None:
    result = _result_with(fee=0)
    assert result["totals"]["shipping"] == 0 and result["totals"]["shipping_tax"] == 0
    lines = _lines(result)
    assert not [x for x in lines if x.startswith(SHIPPING_PREFIXES)]
    # merchandise 91,500.00 + GST 5,660.00 = 97,160.00 (no freight), three lines fewer than the 38 above
    assert "Grand total: ₹97,160.00" in lines and len(lines) == 35
    assert lines[lines.index("GST on merchandise: ₹5,660.00") + 1] == "GST total: ₹5,660.00"


def test_free_shipping_above_the_threshold_is_zero_shipping_and_prints_no_line() -> None:
    result = _result_with(
        fee=5000, free_above=1_000_000
    )  # the order's net is 9,150,000 paise: shipping is free
    assert result["totals"]["shipping"] == 0
    lines = _lines(result)
    assert not [x for x in lines if x.startswith(SHIPPING_PREFIXES)]
    assert "Grand total: ₹97,160.00" in lines


def test_only_the_zero_line_is_left_out_a_fee_with_no_tax_keeps_net_and_total() -> None:
    lines = _lines(_result_with(fee=5000, shipping_tax_bps=0))
    assert "Shipping net: ₹50.00" in lines and "Shipping total: ₹50.00" in lines
    assert not [x for x in lines if x.startswith("GST on shipping")]
    assert "Grand total: ₹97,210.00" in lines and len(lines) == 37  # 91,500.00 + 5,660.00 + 50.00


def test_zero_shipping_changes_only_the_text_never_the_hash_rule() -> None:
    result = _result_with(fee=0)
    out = render_approved(result, result["canonical_hash"], DISPLAY)
    request = {
        "quote": result,
        "approved": True,
        "expected_engine_hash": result["canonical_hash"],
        "display": DISPLAY,
    }
    assert out["canonical_hash"] == independent_render_hash("1.2.0", request)
    assert out["line_count"] == 35 and out["renderer_version"] == "1.2.0"
