"""Order conversion, commit 2: the adapter in front of lane C's pure order lifecycle (app/orders/lifecycle_port.py, ADR 0021).

The GOLDEN vectors pin the package's behaviour by value (canonical hash of the request and sha256 of the whole canonical output). If lane C changes the package, even without a version bump,
these fail until a person reviews the change and moves the pins; if the version changes, ALLOWED_LIFECYCLE_VERSIONS makes the adapter fail closed first. The state x event table is typed by
hand from docs/plans/order-lifecycle.md (not generated from the package), so a changed matrix cannot pass by moving a pin."""

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

from app.orders import lifecycle_port
from app.orders.lifecycle_port import (
    ALLOWED_LIFECYCLE_VERSIONS,
    STATES,
    LifecycleError,
    LifecycleInputError,
    LifecycleUnavailable,
    canonical_json,
    expected_hash,
    is_rejected,
    lifecycle_version,
    run_transition,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (
        ROOT / "packages" / "pure" / "order_lifecycle" / "tests" / "fixtures" / "synthetic.json"
    ).read_text()
)
P1 = "11111111-1111-4111-8111-111111111111"
P2 = "22222222-2222-4222-8222-222222222222"
R1 = "33333333-3333-4333-8333-333333333333"
UNTIL = "2026-10-06T18:29:59Z"  # the end of 6 October in India, as UTC
NOW = "2026-10-06T06:00:00Z"


def req(
    state: str,
    event: dict[str, Any],
    payments: tuple[tuple[str, int], ...] = (),
    refunds: tuple[tuple[str, int], ...] = (),
    total: int = 100000,
    advance: int = 40000,
    advance_required: bool = True,
    dispatch_requires_advance: bool = True,
    cancel: str = "in_preparation",
    override: bool = False,
    as_of: str = NOW,
    until: str = UNTIL,
) -> dict[str, Any]:
    return {
        "current_state": state,
        "event": event,
        "as_of": as_of,
        "valid_until": until,
        "order_total": total,
        "payments": [{"payment_id": i, "amount": a} for i, a in payments],
        "refunds": [{"refund_id": i, "amount": a} for i, a in refunds],
        "policy": {
            "advance_required": advance_required,
            "advance_amount": advance,
            "dispatch_requires_advance": dispatch_requires_advance,
            "cancel_allowed_until_state": cancel,
        },
        "flags": {"owner_override": override},
    }


def pay(amount: int, ledger_id: str = P2) -> dict[str, Any]:
    return {"type": "record_payment", "amount": amount, "payment_id": ledger_id}


def refund(amount: int, ledger_id: str = R1) -> dict[str, Any]:
    return {"type": "record_refund", "amount": amount, "refund_id": ledger_id}


# (label, request, canonical_hash of the request, sha256 of the canonical output) for lifecycle 1.0.0. Moving a pin is a reviewed act.
GOLDEN: list[tuple[str, dict[str, Any], str, str]] = [
    (
        "lane C fixture",
        FIXTURE,
        "652cb5dff6df0e799c8d2eed251c4708d916566a914449aaccd9574728bfcbcf",
        "636ab9af78283c56d7cc6716b67cdf9abb88c043041bfeb25033d9fb21d509a2",
    ),
    (
        "the advance met moves to advance_paid",
        req("accepted", pay(40000, P1)),
        "74e7445c16e3fecce92b912556293eee748b0b6cd05cc170820c67b77b23e53c",
        "7e7adc6de2fd0b257f3e01d510aab7e6d3a2cca1b745d62d6b51dfd7a19b19b0",
    ),
    (
        "a partial payment stays",
        req("accepted", pay(10000, P1)),
        "7224a9b6bdd466ff0c1f7c8f02c591252d9a965264c3493946565ddf9bf27c42",
        "448ad637e0ba0cd0206cb92677594283f3f9e531153b40394a6522292d1df868",
    ),
    (
        "dispatch without the advance is refused",
        req("in_preparation", {"type": "dispatch"}, payments=((P1, 10000),)),
        "75895e39d4d33c287250a2e2ed57f3e5c406198944066f6d5f88005d473e330c",
        "d2780432ea0558f447335ace0b312d1c8a77f7ad974f59a8592a3a6e55e385d6",
    ),
    (
        "an owner override dispatch is flagged",
        req("in_preparation", {"type": "dispatch"}, payments=((P1, 10000),), override=True),
        "78554532a8b52adb2e55d5e43b1421a2499df8fb74402ecd14c6e821f90cd7d6",
        "98c101d348f5876822450d8867ac7a3dcae468dc992c87874d98f9b86cfa628a",
    ),
    (
        "a refund is flagged for the owner and steps back below the advance",
        req("advance_paid", refund(5000), payments=((P1, 40000),)),
        "6219013cb3680073b1c31facb10d67f43b0bb7e90a75008f1c548a600b5c08cb",
        "ebc058073bdca87b61f3a06f6b0bca9f50a230d1db9487a005438710fcc57343",
    ),
    (
        "a cancellation with funds is flagged",
        req("in_preparation", {"type": "cancel"}, payments=((P1, 40000),)),
        "abc64acaec5698cdb25a9a1be181183bfc32c2a9bb802b5b9910f1e5d9bae26e",
        "9567872fdc5ba05cf11a9972e1a3cf05b34aa9f79a4bd169a44ef172f844df88",
    ),
    (
        "an overpayment is refused",
        req("delivered", pay(70000), payments=((P1, 40000),)),
        "5e6def8c63df691c3649ac6b7bf0fa78bdf36583b27a6b28f03814de1cb07a55",
        "41c273e8e2c452b044985f726a7d5c2d109536630eac5d5939626e968321d8d6",
    ),
    (
        "a late acceptance is refused",
        req("quote_sent", {"type": "customer_accept"}, as_of="2026-10-07T00:00:00Z"),
        "61f98069cefcc4797f6168a61ca43a1b39ec00acfe723ba31c358637eb4fb856",
        "a2b87faa18ff677d91afcdff7568a172a64fa523e3d89a8196a348d1198cda8a",
    ),
    (
        "a delivery with a zero balance closes the order",
        req("dispatched", {"type": "deliver"}, payments=((P1, 100000),)),
        "67895c9ec9f1db7b3cd5585f9780766d42d7a6cfe10e6c246e63f8af8cb35d6b",
        "d2373abba85bf95c47c433de1046dd1615c79d725424a52b141f9c856592d2bb",
    ),
    (
        "an illegal transition",
        req("dispatched", {"type": "cancel"}, payments=((P1, 40000),)),
        "0c73812bd547e1eb92212ae85c5cebea11a43e852d31c26a111a509a939ea03e",
        "320e0f3d5c6707c8c859e3c37efb6a9b4fc36acbff62405fd39494608907b25b",
    ),
    (
        "a duplicate payment id",
        req("accepted", pay(1, P1), payments=((P1, 40000),)),
        "c6b2e1590de742eec7872c32e4ceb3943547aba62fba7040fdcddd61cbe7b6a5",
        "d0277756e7d63f794f2b38b393873c4f9c63a24603c1792185177391ba0ea110",
    ),
]


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts from a not-yet-loaded adapter and leaves none behind."""
    monkeypatch.setattr(lifecycle_port, "_lifecycle", None)


# ---------------------------------------------------------------------------------------------- loading and versions
def test_the_package_loads_from_the_repository_and_its_version_is_reviewed() -> None:
    assert lifecycle_version() == "1.0.0"
    assert lifecycle_version() in ALLOWED_LIFECYCLE_VERSIONS
    assert (
        frozenset({"1.0.0"}) == ALLOWED_LIFECYCLE_VERSIONS
    )  # widening it is a deliberate edit of this test and of the constant


def _module(version: object = "1.0.0", **over: Any) -> ModuleType:
    module = ModuleType("order_lifecycle")
    module.ENGINE_VERSION = version  # type: ignore[attr-defined]
    module.transition = lambda request: {}  # type: ignore[attr-defined]
    module.canonical_json = lambda value: ""  # type: ignore[attr-defined]
    for key, value in over.items():
        setattr(module, key, value)
    return module


@pytest.mark.parametrize(
    "version", ["1.0.1", "1.1.0", "2.0.0", "0.9.0", "", None, 1.0, ("1", "0", "0")]
)
def test_a_version_nobody_reviewed_fails_closed(version: object) -> None:
    with pytest.raises(LifecycleUnavailable):
        lifecycle_port._check(_module(version))


def test_a_module_without_the_documented_surface_fails_closed() -> None:
    for missing in ("transition", "canonical_json", "ENGINE_VERSION"):
        module = _module()
        delattr(module, missing)
        with pytest.raises(LifecycleUnavailable):
            lifecycle_port._check(module)
    with pytest.raises(LifecycleUnavailable):
        lifecycle_port._check(_module(transition="not callable"))


def test_a_missing_package_fails_closed_and_the_adapter_keeps_trying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def refuse(name: str) -> ModuleType:
        raise ImportError(name)

    monkeypatch.setattr(lifecycle_port, "_import_module", refuse)
    with pytest.raises(LifecycleUnavailable):
        lifecycle_port._import(tmp_path / "does-not-exist")
    with pytest.raises(LifecycleUnavailable):
        lifecycle_port._import(None)
    with pytest.raises(LifecycleUnavailable):
        lifecycle_port.lifecycle()
    assert lifecycle_port._lifecycle is None  # nothing was cached
    monkeypatch.undo()
    assert lifecycle_version() == "1.0.0"  # and the next call loads it


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    """In the Docker image the file lives at /srv/app/orders/lifecycle_port.py: no repository root exists, and the module must still import."""
    assert lifecycle_port._package_src(Path("/srv/app/orders/lifecycle_port.py")) is None
    assert lifecycle_port._package_src(Path("/lifecycle_port.py")) is None
    assert lifecycle_port._package_src(Path(lifecycle_port.__file__)) == ROOT / "packages" / "pure"


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

    monkeypatch.setattr(lifecycle_port, "_import_module", import_once_the_path_is_added)
    monkeypatch.setattr(sys, "path", ["first", "second"])
    assert lifecycle_port._import(tmp_path) is sentinel
    assert sys.path == ["first", "second", str(tmp_path)]


def test_an_unreviewed_version_in_the_loaded_package_makes_every_entry_point_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = lifecycle_port._import()
    monkeypatch.setattr(
        lifecycle_port,
        "_import",
        lambda src=None: _module(
            "1.1.0", transition=real.transition, canonical_json=real.canonical_json
        ),
    )
    for call in (
        lifecycle_version,
        lambda: run_transition(FIXTURE),
        lambda: canonical_json({}),
        lambda: expected_hash(FIXTURE),
    ):
        with pytest.raises(LifecycleUnavailable):
            call()


# ---------------------------------------------------------------------------------------------- golden vectors
@pytest.mark.parametrize(
    ("label", "request_", "request_hash", "output_hash"), GOLDEN, ids=[g[0] for g in GOLDEN]
)
def test_golden_vectors_pin_the_package_by_value(
    label: str, request_: dict[str, Any], request_hash: str, output_hash: str
) -> None:
    result = run_transition(request_)
    assert result["canonical_hash"] == request_hash == expected_hash(request_), label
    assert hashlib.sha256(canonical_json(result).encode("utf-8")).hexdigest() == output_hash, label


def _summary(r: dict[str, Any]) -> tuple[Any, ...]:
    return (
        r["status"],
        r["new_state"],
        r.get("codes"),
        r["paid_total"],
        r["balance_due"],
        [f["code"] for f in r["flags"]["reasons"]],
        r["allowed_next_events"],
    )


def test_the_hand_checked_values_behind_the_vectors() -> None:
    by = {g[0]: run_transition(g[1]) for g in GOLDEN}
    assert _summary(by["the advance met moves to advance_paid"]) == (
        "ok",
        "advance_paid",
        None,
        40000,
        60000,
        [],
        ["record_payment", "start_preparation", "cancel", "record_refund"],
    )
    assert _summary(by["a partial payment stays"]) == (
        "ok",
        "accepted",
        None,
        10000,
        90000,
        [],
        ["request_advance", "record_payment", "cancel", "record_refund"],
    )
    assert _summary(by["dispatch without the advance is refused"]) == (
        "rejected",
        None,
        ["ADVANCE_NOT_PAID"],
        10000,
        90000,
        [],
        [],
    )
    assert _summary(by["an owner override dispatch is flagged"])[:6] == (
        "ok",
        "dispatched",
        None,
        10000,
        90000,
        ["ADVANCE_OVERRIDE"],
    )
    assert _summary(by["a refund is flagged for the owner and steps back below the advance"])[
        :6
    ] == ("ok", "advance_requested", None, 35000, 65000, ["REFUND_REQUIRES_OWNER_APPROVAL"])
    assert _summary(by["a cancellation with funds is flagged"]) == (
        "ok",
        "cancelled",
        None,
        40000,
        60000,
        ["CANCELLATION_WITH_FUNDS"],
        [],
    )
    assert _summary(by["an overpayment is refused"])[:3] == ("rejected", None, ["OVERPAYMENT"])
    assert _summary(by["a late acceptance is refused"])[:3] == ("rejected", None, ["QUOTE_EXPIRED"])
    assert _summary(by["a delivery with a zero balance closes the order"]) == (
        "ok",
        "closed_paid",
        None,
        100000,
        0,
        [],
        [],
    )
    assert _summary(by["an illegal transition"])[:3] == ("rejected", None, ["ILLEGAL_TRANSITION"])
    assert _summary(by["a duplicate payment id"])[:3] == (
        "rejected",
        None,
        ["DUPLICATE_PAYMENT_ID"],
    )


# ---------------------------------------------------------------------------------------------- every state x every event, typed by hand
LEGAL = {
    ("quote_approved", "send_quote"): "quote_sent",
    ("quote_sent", "customer_accept"): "accepted",
    ("quote_sent", "customer_decline"): "declined",
    ("accepted", "request_advance"): "advance_requested",
    ("accepted", "record_payment"): "accepted",
    ("advance_requested", "record_payment"): "advance_requested",
    ("advance_paid", "record_payment"): "advance_paid",
    ("in_preparation", "record_payment"): "in_preparation",
    ("dispatched", "record_payment"): "dispatched",
    ("delivered", "record_payment"): "delivered",
    ("accepted", "start_preparation"): "in_preparation",
    ("advance_requested", "start_preparation"): "in_preparation",
    ("advance_paid", "start_preparation"): "in_preparation",
    ("in_preparation", "dispatch"): "dispatched",
    ("dispatched", "deliver"): "delivered",
    ("quote_approved", "cancel"): "cancelled",
    ("quote_sent", "cancel"): "cancelled",
    ("accepted", "cancel"): "cancelled",
    ("advance_requested", "cancel"): "cancelled",
    ("advance_paid", "cancel"): "cancelled",
    ("in_preparation", "cancel"): "cancelled",
}
# pairs the structural matrix allows but a guard refuses with an EMPTY ledger and a not-yet-expired quote
GUARDED = {
    ("quote_approved", "expire"): "QUOTE_NOT_EXPIRED",
    ("quote_sent", "expire"): "QUOTE_NOT_EXPIRED",
    ("accepted", "record_refund"): "REFUND_EXCEEDS_PAID",
    ("advance_requested", "record_refund"): "REFUND_EXCEEDS_PAID",
    ("advance_paid", "record_refund"): "REFUND_EXCEEDS_PAID",
    ("in_preparation", "record_refund"): "REFUND_EXCEEDS_PAID",
    ("dispatched", "record_refund"): "REFUND_EXCEEDS_PAID",
    ("delivered", "record_refund"): "REFUND_EXCEEDS_PAID",
}
EVENTS = (
    "send_quote",
    "customer_accept",
    "customer_decline",
    "expire",
    "request_advance",
    "record_payment",
    "start_preparation",
    "dispatch",
    "deliver",
    "cancel",
    "record_refund",
)


def _event(name: str) -> dict[str, Any]:
    return (
        pay(1000)
        if name == "record_payment"
        else refund(1000)
        if name == "record_refund"
        else {"type": name}
    )


@pytest.mark.parametrize("state", STATES)
@pytest.mark.parametrize("event", EVENTS)
def test_every_state_and_event_pair_is_what_the_table_says(state: str, event: str) -> None:
    # no advance is required here (it is tested apart); a closed order has a fully paid ledger (an unpaid closed order is refused as CLOSED_UNPAID)
    ledger = ((P1, 100000),) if state == "closed_paid" else ()
    result = run_transition(
        req(
            state,
            _event(event),
            payments=ledger,
            advance_required=False,
            dispatch_requires_advance=False,
        )
    )
    if (state, event) in LEGAL:
        assert (result["status"], result["new_state"]) == ("ok", LEGAL[(state, event)])
    else:
        code = GUARDED.get((state, event), "ILLEGAL_TRANSITION")
        assert (result["status"], result["new_state"], result["codes"]) == (
            "rejected",
            None,
            [code],
        )


def test_the_state_list_is_the_documented_twelve() -> None:
    assert STATES == (
        "quote_approved", "quote_sent", "accepted", "advance_requested", "advance_paid", "in_preparation",
        "dispatched", "delivered", "closed_paid", "declined", "expired", "cancelled",
    )  # fmt: skip


def test_an_unpaid_closed_order_is_refused_and_an_expiry_after_the_end_of_the_day_is_allowed() -> (
    None
):
    assert run_transition(req("closed_paid", {"type": "send_quote"}))["codes"] == ["CLOSED_UNPAID"]
    late = "2026-10-06T18:30:00Z"  # one second after the end of the day in India
    for state in ("quote_approved", "quote_sent"):
        assert run_transition(req(state, {"type": "expire"}, as_of=late))["new_state"] == "expired"
        assert run_transition(req(state, {"type": "expire"}, as_of=UNTIL))["codes"] == [
            "QUOTE_NOT_EXPIRED"
        ]  # equality is still valid
    assert (
        run_transition(req("quote_approved", {"type": "send_quote"}, as_of=UNTIL))["status"] == "ok"
    )
    assert run_transition(req("quote_approved", {"type": "send_quote"}, as_of=late))["codes"] == [
        "QUOTE_EXPIRED"
    ]


def test_the_cancel_window_and_the_advance_rules() -> None:
    inside = req("in_preparation", {"type": "cancel"}, cancel="in_preparation")
    assert run_transition(inside)["new_state"] == "cancelled"
    shut = req("in_preparation", {"type": "cancel"}, cancel="accepted")
    assert run_transition(shut)["codes"] == ["CANCEL_WINDOW_CLOSED"]
    assert run_transition(req("accepted", {"type": "start_preparation"}, payments=((P1, 39999),)))[
        "codes"
    ] == ["ADVANCE_NOT_PAID"]
    assert (
        run_transition(req("accepted", {"type": "start_preparation"}, payments=((P1, 40000),)))[
            "new_state"
        ]
        == "in_preparation"
    )
    # only dispatch reads the override
    assert run_transition(req("accepted", {"type": "start_preparation"}, override=True))[
        "codes"
    ] == ["ADVANCE_NOT_PAID"]
    # an advance the order cannot meet
    assert run_transition(req("accepted", pay(1), advance=0))["codes"] == ["INVALID_ADVANCE"]
    assert run_transition(req("accepted", pay(1), advance=100001))["codes"] == ["INVALID_ADVANCE"]


# ---------------------------------------------------------------------------------------------- results and rejections
def test_a_rejection_is_returned_not_raised() -> None:
    rejected = run_transition(req("dispatched", {"type": "cancel"}))
    assert (
        is_rejected(rejected)
        and rejected["codes"] == ["ILLEGAL_TRANSITION"]
        and rejected["new_state"] is None
        and rejected["allowed_next_events"] == []
    )
    assert not is_rejected(run_transition(req("quote_approved", {"type": "send_quote"})))


def test_an_oversized_ledger_is_rejected_before_hashing_and_is_never_ok() -> None:
    ledger = tuple(
        (f"00000000-0000-4000-8000-{i:012d}", 1) for i in range(1001)
    )  # one above the 1,000 maximum
    result = run_transition(req("accepted", pay(1), payments=ledger, total=10**6))
    assert (
        is_rejected(result)
        and result["codes"] == ["OUT_OF_RANGE"]
        and result["canonical_hash"] is None
    )


def test_the_cap_on_an_amount_is_the_lifecycles() -> None:
    assert run_transition(
        req(
            "accepted",
            pay(1_000_000_001),
            total=1_000_000_000,
            advance=0,
            advance_required=False,
            dispatch_requires_advance=False,
        )
    )["codes"] == ["OUT_OF_RANGE"]
    assert run_transition(req("accepted", pay(1), total=1_000_000_001))["codes"] == ["OUT_OF_RANGE"]


def test_the_request_is_not_modified_and_the_output_is_deterministic() -> None:
    request = req("accepted", pay(40000), payments=((P1, 1000),))
    before = copy.deepcopy(request)
    first, second = run_transition(request), run_transition(request)
    assert request == before
    assert canonical_json(first).encode("utf-8") == canonical_json(second).encode("utf-8")
    assert canonical_json({"b": 1, "a": [1, {"d": 2, "c": 3}]}) == '{"a":[1,{"c":3,"d":2}],"b":1}'


def test_the_documented_hash_is_recomputed_here() -> None:
    request = req("accepted", pay(40000))
    payload = json.dumps(
        {"engine_version": "1.0.0", "inputs": request},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    assert expected_hash(request) == hashlib.sha256(payload.encode("utf-8")).hexdigest()
    assert re.fullmatch(r"[0-9a-f]{64}", expected_hash(request))


# ---------------------------------------------------------------------------------------------- a result that is not what the contract says
def _with_package(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    real = lifecycle_port._import()
    monkeypatch.setattr(
        lifecycle_port,
        "_lifecycle",
        lifecycle_port._Lifecycle(
            _module(
                "1.0.0",
                transition=lambda request: transform(real.transition(request)),
                canonical_json=real.canonical_json,
            )
        ),
    )


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: {**r, "canonical_hash": "f" * 64},  # a hash that is not the documented one
        lambda r: {**r, "canonical_hash": None},  # an ok that was never hashed
        lambda r: {**r, "engine_version": "0.9.0"},
        lambda r: {**r, "status": "approved"},
        lambda r: {k: v for k, v in r.items() if k != "status"},
        lambda r: {**r, "new_state": "teleported"},
        lambda r: {**r, "paid_total": 1.5},
        lambda r: {**r, "paid_total": True},
        lambda r: {**r, "balance_due": -1},
        lambda r: {**r, "flags": {"needs_owner_approval": "no", "reasons": []}},
        lambda r: {**r, "flags": {"needs_owner_approval": False}},
        lambda r: {k: v for k, v in r.items() if k != "trace"},
        lambda r: {k: v for k, v in r.items() if k != "allowed_next_events"},
        lambda r: [r],
    ],
    ids=[
        "wrong hash",
        "ok without hash",
        "other version",
        "unknown status",
        "no status",
        "unknown state",
        "float money",
        "bool money",
        "negative balance",
        "flag type",
        "no reasons",
        "no trace",
        "no allowed list",
        "not a dict",
    ],
)
def test_an_inconsistent_answer_is_refused(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    _with_package(monkeypatch, transform)
    with pytest.raises(LifecycleError):
        run_transition(req("accepted", pay(40000)))


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: {**r, "new_state": "accepted"},  # a rejection that names a state
        lambda r: {**r, "codes": ["A", "B"]},
        lambda r: {**r, "codes": [1]},
        lambda r: {k: v for k, v in r.items() if k != "codes"},
    ],
    ids=["rejected with a state", "two codes", "a non-string code", "no code"],
)
def test_an_inconsistent_rejection_is_refused(
    monkeypatch: pytest.MonkeyPatch, transform: Any
) -> None:
    _with_package(monkeypatch, transform)
    with pytest.raises(LifecycleError):
        run_transition(req("dispatched", {"type": "cancel"}))


# ---------------------------------------------------------------------------------------------- wrong types never echo the value
@pytest.mark.parametrize(
    "bad",
    [
        req("accepted", {"type": "record_payment", "amount": 1.5, "payment_id": P1}),
        req("accepted", {"type": "record_payment", "amount": True, "payment_id": P1}),
        req("accepted", pay(1), total=1000.5),  # type: ignore[arg-type]
        req("accepted", pay(1), advance_required="yes"),  # type: ignore[arg-type]
        {**req("accepted", pay(1)), "flags": {"owner_override": 1}},
        {**req("accepted", pay(1)), "payments": [object()]},
    ],
    ids=["float amount", "bool amount", "float total", "string flag", "int flag", "non-JSON"],
)
def test_wrong_types_become_a_fixed_error_without_the_value(bad: dict[str, Any]) -> None:
    with pytest.raises(LifecycleInputError) as caught:
        run_transition(bad)
    assert (
        str(caught.value) == "order_lifecycle_input_type"
        and "1.5" not in repr(caught.value)
        and "yes" not in repr(caught.value)
    )
    with pytest.raises(LifecycleInputError):
        canonical_json({"x": 1.5})


# ---------------------------------------------------------------------------------------------- the door is the only door
def test_only_the_adapter_names_the_lifecycle_package() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        str(p.relative_to(app))
        for p in app.rglob("*.py")
        if p.name != "lifecycle_port.py" and re.search(r"\border_lifecycle\b", p.read_text())
    ]
    assert offenders == []


def test_the_agent_sandbox_and_the_requirement_package_never_import_the_order_path() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    for package in ("agents", "requirements", "enquiries", "agent_runs"):
        offenders = [
            str(p.relative_to(app))
            for p in (app / package).rglob("*.py")
            if re.search(r"(?m)^\s*(from|import)\s+app\.orders\b", p.read_text())
        ]
        assert offenders == [], (
            package
        )  # no agent code path reaches a financial commitment (CLAUDE.md 3)
