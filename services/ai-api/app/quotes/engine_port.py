"""The ONE door to lane C's pure quote engine (`packages/quote-engine`, docs/plans/t009-quote-engine.md).

Nothing else in the API may import `quote_engine`: a boundary test fails if another module does. The adapter exists to give lane A three guarantees the
package cannot give itself:

  * **Versioned.** Only engine versions listed in ALLOWED_ENGINE_VERSIONS run. A package upgrade by lane C changes ENGINE_VERSION; until a person
    reviews its changelog and adds the version here (and, later, to the database allow-list `quote_engine_versions`), the quote endpoints fail closed
    (QuoteEngineUnavailable). A golden test (tests/test_quotes_engine_port.py) additionally pins the canonical hash and the full output of fixed requests,
    so a behaviour change WITHOUT a version bump is caught too.
  * **Fail closed.** A missing package, an unknown version or a missing function raises QuoteEngineUnavailable (the API answers 503); the API still boots.
  * **Nothing from the engine leaks.** Errors carry a fixed code only: an engine TypeError (it names the offending value) becomes QuoteInputError.

The engine hashes `{"engine_version", "inputs": request}` (sorted compact ASCII JSON). The adapter recomputes that hash on every run and refuses a
result whose `canonical_hash` differs (QuoteEngineError), so a change of the hash formula cannot slip through either.

Money is integer paise and rates integer basis points end to end; the engine rejects floats and booleans (TypeError). `as_of` is supplied by the caller;
the engine reads no clock. No dependency is added: the package is stdlib-only and is put on the import path from the repository checkout when it is
not already importable (the Docker image needs two COPY lines: docs/pre-pilot-checklist.md, T012)."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# The versions lane A has reviewed. Adding one is a deliberate act: read the engine's changelog, re-run the golden vectors, move the pinned hashes.
ALLOWED_ENGINE_VERSIONS: frozenset[str] = frozenset({"1.1.0"})

MODULE_NAME = "quote_engine"


def _package_src(here: Path) -> Path | None:
    """Where the checkout keeps the package: app/quotes/engine_port.py is four levels below the repository root. In a deployed image the file sits
    elsewhere (a shallow or an installed path): there is no checkout, the answer is None, and the package must already be importable (PYTHONPATH)."""
    try:
        return here.resolve().parents[4] / "packages" / "quote-engine" / "src"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class QuoteEngineUnavailable(Exception):
    """The engine cannot be used: not importable, a version nobody reviewed, or a shape we do not know. Fail closed."""

    code = "quote_engine_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class QuoteEngineError(Exception):
    """The engine answered something the adapter does not accept (a hash that is not the documented one, a result of an unknown shape)."""

    code = "quote_engine_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


class QuoteInputError(Exception):
    """The request had a value of the wrong type (a float, a boolean, a non-JSON object). The engine's own message names the value and is dropped."""

    code = "quote_input_type"

    def __init__(self) -> None:
        super().__init__(self.code)


class _Engine:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.ENGINE_VERSION
        self.quote: Callable[[dict[str, Any]], dict[str, Any]] = module.quote
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Engine:
    """Accept a module only when it has the documented surface and a reviewed version."""
    version = getattr(module, "ENGINE_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_ENGINE_VERSIONS:
        raise QuoteEngineUnavailable
    if not callable(getattr(module, "quote", None)) or not callable(
        getattr(module, "canonical_json", None)
    ):
        raise QuoteEngineUnavailable
    return _Engine(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise QuoteEngineUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise QuoteEngineUnavailable from None


_engine: _Engine | None = None


def engine() -> _Engine:
    """The checked engine (loaded once). Raises QuoteEngineUnavailable and keeps trying on the next call."""
    global _engine
    if _engine is None:
        _engine = _check(_import())
    return _engine


def engine_version() -> str:
    return engine().version


def canonical_json(value: Any) -> str:
    """The engine's canonical JSON text (sorted keys, compact, ASCII). What a stored request is made of."""
    try:
        return engine().canonical_json(value)
    except TypeError:
        raise QuoteInputError from None


def expected_hash(request: dict[str, Any]) -> str:
    """sha256 of the canonical JSON of {"engine_version", "inputs": request}: the documented hash, computed here independently of the engine."""
    e = engine()
    payload = canonical_json({"engine_version": e.version, "inputs": request})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_rejected(result: dict[str, Any]) -> bool:
    return result.get("status") == "rejected"


def run_quote(request: dict[str, Any]) -> dict[str, Any]:
    """Run the engine. Returns its dict: a draft quote (`status: draft`) or a structured rejection (`status: rejected`, `codes`).

    Raises QuoteEngineUnavailable (fail closed), QuoteInputError (wrong types) or QuoteEngineError (the result is not what the contract says).
    The request is not modified."""
    e = engine()
    try:
        result = e.quote(request)
    except TypeError:
        raise QuoteInputError from None
    if (
        not isinstance(result, dict)
        or result.get("engine_version") != e.version
        or result.get("status") not in ("draft", "rejected")
    ):
        raise QuoteEngineError
    digest = result.get("canonical_hash")
    if digest is None:
        # only an oversized request is rejected before hashing (it is never serialised): never a draft
        if not is_rejected(result):
            raise QuoteEngineError
    elif digest != expected_hash(request):
        raise QuoteEngineError
    return result
