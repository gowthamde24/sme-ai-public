"""Job CN: the adapter to the construction calculator (app/materials/engine_port.py): versioned, fail closed, hash recomputed, nothing leaks; and the golden vectors through it. The calculator itself is tested in
packages/quote-engine/tests/test_construction.py (worked examples by hand, invariants on thousands of random requests); the database's twin in supabase/tests/database/98 and tests/integration/test_cn_quotes_api.py."""

from __future__ import annotations

import copy
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from app.materials import engine_port as ep
from tests.cn_fakes import VECTORS, WORKED

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(autouse=True)
def _fresh_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ep, "_engine", None)


def test_the_engine_loads_from_the_checkout_and_its_version_is_reviewed() -> None:
    assert ep.engine_version() == "1.0.0" and "1.0.0" in ep.ALLOWED_VERSIONS
    assert ep.MODULE_NAME == "quote_engine.construction"


@pytest.mark.parametrize("version", ["1.0.1", "2.0.0", "", None, 100])
def test_a_version_nobody_reviewed_fails_closed(version: object) -> None:
    module = ModuleType("quote_engine.construction")
    module.CONSTRUCTION_ENGINE_VERSION = version  # type: ignore[attr-defined]
    module.calculate = lambda r: {}  # type: ignore[attr-defined]
    module.canonical_json = lambda v: ""  # type: ignore[attr-defined]
    with pytest.raises(ep.CalculatorUnavailable):
        ep._check(module)


def test_a_module_without_the_documented_surface_fails_closed() -> None:
    module = ModuleType("quote_engine.construction")
    module.CONSTRUCTION_ENGINE_VERSION = "1.0.0"  # type: ignore[attr-defined]
    with pytest.raises(ep.CalculatorUnavailable):
        ep._check(module)


def test_a_missing_package_fails_closed_and_the_adapter_keeps_trying(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import sys

    monkeypatch.setattr(ep, "_PACKAGE_SRC", tmp_path / "nowhere")
    monkeypatch.setattr(ep, "_import_module", lambda name: (_ for _ in ()).throw(ImportError(name)))
    monkeypatch.setattr(sys, "path", list(sys.path))
    with pytest.raises(ep.CalculatorUnavailable):
        ep.engine()
    monkeypatch.undo()
    assert ep.engine_version() == "1.0.0", "once the package is back the next call works"


def test_a_shallow_install_path_does_not_crash_the_import() -> None:
    assert ep._package_src(Path("/app.py")) is None or isinstance(ep._package_src(Path("/app.py")), Path)


def test_the_package_path_is_appended_never_put_first() -> None:
    import sys

    before = list(sys.path)
    ep._import()
    assert sys.path[: len(before)] == before or sys.path == before


@pytest.mark.parametrize("vector", [v for v in VECTORS if v["expected"]["status"] == "draft"], ids=lambda v: v["name"])
def test_every_draft_vector_is_reproduced_through_the_adapter(vector: dict[str, Any]) -> None:
    assert ep.calculate(copy.deepcopy(vector["request"])) == vector["expected"]


@pytest.mark.parametrize("vector", [v for v in VECTORS if v["expected"]["status"] == "rejected"], ids=lambda v: v["name"])
def test_every_rejection_is_returned_not_raised(vector: dict[str, Any]) -> None:
    out = ep.calculate(copy.deepcopy(vector["request"]))
    assert ep.is_rejected(out) and out["codes"] == vector["expected"]["codes"]


def test_the_documented_hash_is_recomputed_here_independently() -> None:
    import hashlib
    import json

    out = ep.calculate(copy.deepcopy(WORKED))
    want = hashlib.sha256(json.dumps({"engine_version": "1.0.0", "inputs": WORKED}, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    assert out["canonical_hash"] == ep.expected_hash(WORKED) == want


def test_a_result_with_another_hash_or_version_or_shape_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = ep.engine()
    good = engine.calculate(copy.deepcopy(WORKED))
    for broken in ({**good, "canonical_hash": "0" * 64}, {**good, "engine_version": "9.9.9"}, {**good, "status": "approved"}, "not a dict", {**good, "canonical_hash": None}):
        monkeypatch.setattr(engine, "calculate", lambda r, b=broken: b)
        with pytest.raises(ep.CalculatorInconsistent):
            ep.calculate(copy.deepcopy(WORKED))


@pytest.mark.parametrize("path", [("lines", 0, "unit_price_paise", 65.5), ("lines", 0, "area_x100", True), ("policy", None, "advance_bps", 50.0)])
def test_wrong_types_become_a_fixed_error_without_the_value(path: tuple[str, Any, str, Any]) -> None:
    request = copy.deepcopy(WORKED)
    target = request[path[0]][path[1]] if path[1] is not None else request[path[0]]
    target[path[2]] = path[3]
    with pytest.raises(ep.CalculatorInputError) as caught:
        ep.calculate(request)
    assert str(caught.value) == "calculator_input_type" and "65.5" not in repr(caught.value)
    with pytest.raises(ep.CalculatorInputError):
        ep.canonical_json({"x": 1.5})


def test_the_request_is_not_modified() -> None:
    request = copy.deepcopy(WORKED)
    ep.calculate(request)
    assert request == WORKED


def test_only_the_adapter_names_the_calculator_package() -> None:
    app = Path(__file__).resolve().parents[1] / "app"
    offenders = [str(p.relative_to(app)) for p in app.rglob("*.py") if p.name != "engine_port.py" and "quote_engine" in p.read_text()]
    assert offenders == []


def test_the_calculator_is_in_the_image_and_on_the_path() -> None:
    docker = (ROOT / "deploy" / "Dockerfile.api").read_text()
    assert "COPY packages/quote-engine/src ./packages/quote-engine/src" in docker, "construction.py lives next to the saree engine"
    assert (ROOT / "packages" / "quote-engine" / "src" / "quote_engine" / "construction.py").is_file()


def test_the_ts_twin_and_the_python_reference_share_one_version_and_one_vector_file() -> None:
    ts = (ROOT / "packages" / "quote-engine" / "ts" / "construction.ts").read_text()
    assert 'export const CONSTRUCTION_ENGINE_VERSION = "1.0.0";' in ts
    assert ep.engine_version() == "1.0.0"
    assert len(VECTORS) >= 40
