"""The ONE door to the construction-materials calculator (`packages/quote-engine`, quote_engine.construction; job CN, ADR 0085). Nothing else in the API may name that package (a test fails if another file does).

The same three guarantees as the saree engine's port (app/quotes/engine_port.py):
  * Versioned. Only the versions listed in ALLOWED_VERSIONS run; a new version needs a person to read its changelog, re-run the golden vectors and add it here AND to the database's allow-list
    (public.material_engine_versions). Until then the material-quote endpoints fail closed (503).
  * Fail closed. A missing package, an unknown version or a missing function raises CalculatorUnavailable.
  * Nothing from the engine leaks: a wrong type is a fixed error and the engine's own text (it names the value) is dropped.
The adapter recomputes the documented hash (sha256 of {"engine_version", "inputs"}) on every run and refuses a result whose hash differs.

Money is integer paise, rates integer basis points, the area integer hundredths and pieces per area integer thousandths; the calculator reads no clock and no network. The database computes every stored quote again
(app.cq_compute) and refuses a quote whose figures differ, so a bug here can never store a wrong figure."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

ALLOWED_VERSIONS: frozenset[str] = frozenset({"1.0.0"})
MODULE_NAME = "quote_engine.construction"


def _package_src(here: Path) -> Path | None:
    try:
        return here.resolve().parents[4] / "packages" / "quote-engine" / "src"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class CalculatorUnavailable(Exception):
    code = "calculator_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class CalculatorInconsistent(Exception):
    code = "calculator_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


class CalculatorInputError(Exception):
    code = "calculator_input_type"

    def __init__(self) -> None:
        super().__init__(self.code)


class _Engine:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.CONSTRUCTION_ENGINE_VERSION
        self.calculate: Callable[[dict[str, Any]], dict[str, Any]] = module.calculate
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Engine:
    version = getattr(module, "CONSTRUCTION_ENGINE_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_VERSIONS:
        raise CalculatorUnavailable
    if not callable(getattr(module, "calculate", None)) or not callable(getattr(module, "canonical_json", None)):
        raise CalculatorUnavailable
    return _Engine(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise CalculatorUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise CalculatorUnavailable from None


_engine: _Engine | None = None


def engine() -> _Engine:
    global _engine
    if _engine is None:
        _engine = _check(_import())
    return _engine


def engine_version() -> str:
    return engine().version


def canonical_json(value: Any) -> str:
    try:
        return engine().canonical_json(value)
    except TypeError:
        raise CalculatorInputError from None


def expected_hash(request: dict[str, Any]) -> str:
    e = engine()
    payload = canonical_json({"engine_version": e.version, "inputs": request})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_rejected(result: dict[str, Any]) -> bool:
    return result.get("status") == "rejected"


def calculate(request: dict[str, Any]) -> dict[str, Any]:
    """Run the calculator. Returns its dict: a draft (`status: draft`) or a structured rejection (`status: rejected`, closed `codes`).

    Raises CalculatorUnavailable (fail closed), CalculatorInputError (a wrong type) or CalculatorInconsistent (the result is not what the contract says). The request is not modified."""
    e = engine()
    try:
        result = e.calculate(request)
    except TypeError:
        raise CalculatorInputError from None
    if not isinstance(result, dict) or result.get("engine_version") != e.version or result.get("status") not in ("draft", "rejected"):
        raise CalculatorInconsistent
    digest = result.get("canonical_hash")
    if digest is None:
        if not is_rejected(result):  # only an oversized request is rejected before hashing; it is never a draft
            raise CalculatorInconsistent
    elif digest != expected_hash(request):
        raise CalculatorInconsistent
    return result
