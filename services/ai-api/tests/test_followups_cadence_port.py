"""T010 part 2, commit 2: the adapter in front of lane C's pure follow-up cadence engine (app/followups/cadence_port.py, ADR 0022).

The GOLDEN vectors pin the package's behaviour by value (canonical hash of the request and sha256 of the whole canonical output). If lane C changes the package, even without a version bump,
these fail until a person reviews the change and moves the pins; if the version changes, ALLOWED_CADENCE_VERSIONS makes the adapter fail closed first. The decisions checked by hand below are
typed from docs/plans/t010-followup-cadence.md (not generated from the package), so a changed rule cannot pass by moving a pin. The database's own copy of the due rules is pinned equal to the
real engine by the equivalence gate (tests/integration/test_followup_equivalence.py)."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.followups import cadence_port
from app.followups.cadence_port import (
    ALLOWED_CADENCE_VERSIONS,
    CadenceError,
    CadenceInputError,
    CadenceUnavailable,
    cadence_version,
    canonical_json,
    expected_hash,
    is_rejected,
    run_decide,
)

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = json.loads(
    (
        ROOT / "packages" / "pure" / "followup_cadence" / "tests" / "fixtures" / "synthetic.json"
    ).read_text()
)
OUT = {"channel": "email", "direction": "out", "outcome": "recorded_sent"}
IN = {"channel": "email", "direction": "in", "outcome": "recorded_reply"}
POLICY = {
    "gap_days": [1, 2],
    "max_touches": 3,
    "quiet_hours": {"start": "21:00", "end": "09:00"},
    "allowed_weekdays": [0, 1, 2, 3, 4],
    "holidays": [],
    "min_gap_hours": 0,
}


def req(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "as_of": "2026-10-07T06:30:00Z",  # Wednesday 12:00 in India
        "recipient_utc_offset_minutes": 330,
        "lead": {
            "do_not_contact": False,
            "opted_out": False,
            "replied": False,
            "bounced": False,
            "won": False,
            "lost": False,
        },
        "history": [{"timestamp": "2026-10-02T06:30:00Z", **OUT}],
        "policy": copy.deepcopy(POLICY),
    }
    base.update(over)
    return base


@pytest.fixture(autouse=True)
def fresh_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test starts with an unloaded adapter and gets the real package back afterwards."""
    monkeypatch.setattr(cadence_port, "_cadence", None)


def _module(version: object = "1.0.0", **over: Any) -> ModuleType:
    module = ModuleType("followup_cadence")
    module.ENGINE_VERSION = version  # type: ignore[attr-defined]
    module.decide = lambda request: {}  # type: ignore[attr-defined]
    module.canonical_json = lambda value: "{}"  # type: ignore[attr-defined]
    for key, value in over.items():
        if value is None:
            delattr(module, key)
        else:
            setattr(module, key, value)
    return module


def test_the_package_loads_from_the_repository_and_its_version_is_reviewed() -> None:
    assert cadence_version() == "1.0.0"
    assert ALLOWED_CADENCE_VERSIONS == frozenset({"1.0.0"})


@pytest.mark.parametrize("version", ["1.0.1", "2.0.0", "", None, 1, ["1.0.0"]])
def test_a_version_nobody_reviewed_fails_closed(version: object) -> None:
    with pytest.raises(CadenceUnavailable):
        cadence_port._check(_module(version))


@pytest.mark.parametrize("missing", ["decide", "canonical_json"])
def test_a_module_without_the_documented_surface_fails_closed(missing: str) -> None:
    with pytest.raises(CadenceUnavailable):
        cadence_port._check(_module(**{missing: None}))
    with pytest.raises(CadenceUnavailable):
        cadence_port._check(_module(decide="not callable"))


def test_a_missing_package_fails_closed_and_the_adapter_keeps_trying(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def refuse(name: str) -> ModuleType:
        raise ImportError(name)

    monkeypatch.setattr(cadence_port, "_import_module", refuse)
    with pytest.raises(CadenceUnavailable):
        cadence_port._import(tmp_path / "does-not-exist")
    with pytest.raises(CadenceUnavailable):
        cadence_port._import(None)
    with pytest.raises(CadenceUnavailable):
        cadence_port.cadence()
    assert cadence_port._cadence is None  # nothing was cached
    monkeypatch.undo()
    assert cadence_version() == "1.0.0"  # and the next call loads it


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    assert cadence_port._package_src(Path("/srv/app/followups/cadence_port.py")) is None
    assert cadence_port._package_src(Path("/cadence_port.py")) is None
    assert cadence_port._package_src(Path(cadence_port.__file__)) == ROOT / "packages" / "pure"


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

    monkeypatch.setattr(cadence_port, "_import_module", import_once_the_path_is_added)
    monkeypatch.setattr(sys, "path", ["first", "second"])
    assert cadence_port._import(tmp_path) is sentinel
    assert sys.path == ["first", "second", str(tmp_path)]


def test_an_unreviewed_version_in_the_loaded_package_makes_every_entry_point_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(cadence_port, "_import_module", lambda name: _module("9.9.9"))
    for call in (
        cadence_version,
        lambda: run_decide(req()),
        lambda: canonical_json({}),
        lambda: expected_hash(req()),
    ):
        with pytest.raises(CadenceUnavailable):
            call()


# ----------------------------------------------------------------------------- golden vectors (by value)
GOLDEN = [
    (
        FIXTURE,
        "d2bfc72e83f01648f623fe9dfbede9c36908cc6265515583f8fbcec45e97350f",
        "635108beddc1665b8941beb72dafb0d2a064f079c9e861bd58058b3cf42bad25",
    ),
    (
        req(),
        "40fa04e6c1029ae8947182f472cd8a6a2bdff8e24e5f0b51ec8e8c3a4d7642f7",
        "66bd353fd772a7bc2b59c88ff4ac6fc053e4dfa26b7360df2adb2bb05d9a7b1a",
    ),
    (
        req(
            history=[
                {"timestamp": "2026-10-03T06:00:00Z", **OUT},
                {"timestamp": "2026-10-04T06:00:00Z", **IN},
            ]
        ),
        "6017896bd68692cf6076cb8d24215ad12f296041619af857ecbec3b2ca104088",
        "a46f34eeaaa981e46db246a16a7f2598f7a96fc5615b32b1ce03d3a0d203b348",
    ),
]


@pytest.mark.parametrize(("request_", "request_hash", "output_sha"), GOLDEN)
def test_golden_vectors_pin_the_package_by_value(
    request_: dict[str, Any], request_hash: str, output_sha: str
) -> None:
    result = run_decide(request_)
    assert result["canonical_hash"] == request_hash == expected_hash(request_)
    assert hashlib.sha256(canonical_json(result).encode()).hexdigest() == output_sha


def test_the_hand_checked_decisions_behind_the_vectors() -> None:
    due = run_decide(req())
    assert (due["action"], due["reason_code"], due["touch_number"], due["terminal"]) == (
        "draft_followup",
        "eligible_now",
        2,
        False,
    )
    assert due["next_eligible_at"] == "2026-10-07T06:30:00Z"  # a due draft is due at as_of itself
    assert (
        run_decide(req(history=[{"timestamp": "2026-10-07T06:30:00Z", **OUT}]))["reason_code"]
        == "not_yet_eligible"
    )
    reply = run_decide(
        req(
            history=[
                {"timestamp": "2026-10-03T06:00:00Z", **OUT},
                {"timestamp": "2026-10-04T06:00:00Z", **IN},
            ]
        )
    )
    assert (
        reply["action"],
        reply["reason_code"],
        reply["terminal"],
        reply["next_eligible_at"],
    ) == ("stop", "human_takeover", True, None)
    assert run_decide(req(history=[]))["reason_code"] == "initial_outreach_required"
    future = run_decide(req(history=[{"timestamp": "2026-10-08T06:30:00Z", **OUT}]))
    assert is_rejected(future) and future["codes"] == ["FUTURE_HISTORY"]


def test_the_request_is_not_modified_and_the_output_is_deterministic() -> None:
    request = req()
    before = copy.deepcopy(request)
    first = run_decide(request)
    assert request == before
    assert canonical_json(run_decide(request)) == canonical_json(first)


def test_the_documented_hash_is_recomputed_here() -> None:
    request = req()
    payload = json.dumps(
        {"engine_version": "1.0.0", "inputs": request},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    assert expected_hash(request) == hashlib.sha256(payload.encode()).hexdigest()


# ----------------------------------------------------------------------------- the adapter refuses what it does not know
def _with_package(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    real = cadence_port.cadence()

    def decide(request: dict[str, Any]) -> Any:
        return transform(real.decide(request))

    module = _module("1.0.0", decide=decide, canonical_json=real.canonical_json)
    monkeypatch.setattr(cadence_port, "_cadence", None)
    monkeypatch.setattr(cadence_port, "_import_module", lambda name: module)


def _drop(key: str) -> Any:
    return lambda r: {k: v for k, v in r.items() if k != key}


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: "not a dict",
        lambda r: {**r, "engine_version": "2.0.0"},
        lambda r: {**r, "canonical_hash": "0" * 64},
        lambda r: {**r, "canonical_hash": None},
        _drop("trace"),
        _drop("terminal"),
        _drop("next_eligible_at"),
        lambda r: {**r, "extra": 1},
        lambda r: {**r, "action": "send"},
        lambda r: {**r, "terminal": "yes"},
        lambda r: {**r, "touch_number": 2.0},
        lambda r: {**r, "touch_number": True},
        lambda r: {**r, "trace": {}},
        lambda r: {**r, "action": "stop", "next_eligible_at": "2026-10-07T06:30:00Z"},
    ],
)
def test_an_inconsistent_answer_is_refused(monkeypatch: pytest.MonkeyPatch, transform: Any) -> None:
    _with_package(monkeypatch, transform)
    with pytest.raises(CadenceError):
        run_decide(req())


@pytest.mark.parametrize(
    "transform",
    [
        lambda r: {**r, "codes": []},
        lambda r: {**r, "codes": ["A", "B"]},
        lambda r: {**r, "codes": [1]},
        lambda r: {**r, "action": "draft_followup"},
        lambda r: {**r, "canonical_hash": "0" * 64},
    ],
)
def test_an_inconsistent_rejection_is_refused(
    monkeypatch: pytest.MonkeyPatch, transform: Any
) -> None:
    _with_package(monkeypatch, transform)
    with pytest.raises(CadenceError):
        run_decide(req(history=[{"timestamp": "2026-10-08T06:30:00Z", **OUT}]))


def test_an_oversized_request_is_rejected_before_hashing_and_is_never_an_answer() -> None:
    result = run_decide(req(history=[{"timestamp": "2026-10-02T06:30:00Z", **OUT}] * 1001))
    assert is_rejected(result) and result["canonical_hash"] is None


@pytest.mark.parametrize(
    "bad",
    [
        req(recipient_utc_offset_minutes=330.0),
        req(recipient_utc_offset_minutes=True),
        req(
            lead={
                "do_not_contact": 0,
                "opted_out": False,
                "replied": False,
                "bounced": False,
                "won": False,
                "lost": False,
            }
        ),
        req(policy={**POLICY, "max_touches": 3.0}),
        req(history=[{"timestamp": 5, **OUT}]),
    ],
)
def test_wrong_types_become_a_fixed_error_without_the_value(bad: dict[str, Any]) -> None:
    with pytest.raises(CadenceInputError) as caught:
        run_decide(bad)
    assert str(caught.value) == "followup_cadence_input_type"


def test_canonical_json_refuses_a_float_with_a_fixed_error() -> None:
    with pytest.raises(CadenceInputError):
        canonical_json({"x": 1.5})


def test_only_the_adapter_names_the_cadence_package() -> None:
    import re

    app = Path(cadence_port.__file__).resolve().parents[1]
    importing = re.compile(r"^\s*(import|from)\s+followup_cadence\b", re.M)
    offenders = [
        str(p.relative_to(app))
        for p in app.rglob("*.py")
        if p.name != "cadence_port.py" and importing.search(p.read_text())
    ]
    assert offenders == []
