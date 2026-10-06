"""The ONE door to lane C's pure follow-up cadence engine (`packages/pure/followup_cadence`, docs/plans/t010-followup-cadence.md, ADR 0022).

The engine PROPOSES: stop, wait or draft a follow-up. It persists, sends, authorises and approves nothing, and its hash binds the request, not the person. Nothing else in the API may import
`followup_cadence`: a boundary test fails if another module does. The adapter gives lane A the guarantees the package cannot give itself (the pattern of app/orders/lifecycle_port.py):

  * **Versioned.** Only versions in ALLOWED_CADENCE_VERSIONS run. An upgrade by lane C changes ENGINE_VERSION; until a person reviews its changelog and adds the version here AND to the
    database allow-list `followup_engine_versions` (a migration that also re-reads `app.followup_blocker`) the follow-up endpoints fail closed (CadenceUnavailable). The golden vectors
    (tests/test_followups_cadence_port.py) additionally pin the canonical hash and the whole output of fixed requests, so a behaviour change WITHOUT a version bump is caught too.
  * **Fail closed.** A missing package, an unknown version or a missing function raises CadenceUnavailable (the API answers 503); the API still boots.
  * **Nothing from the package leaks.** Errors carry a fixed code only: a TypeError (it names the offending value) becomes CadenceInputError.
  * **Verified hash.** The package hashes `{"engine_version", "inputs": request}` (sorted compact ASCII JSON); the adapter recomputes it on every run and refuses a result whose
    `canonical_hash` differs, and refuses a result of a shape it does not know (CadenceError).

The adapter DECIDES NOTHING about a lead: it runs the engine on the request the builder made (app/followups/builder.py, equal to the database's `app.followup_build`). The database recomputes the
rules that matter and refuses any difference (SM225, SM226). No dependency is added: the package is stdlib-only and is put on the import path from the repository checkout when it is not
already importable (the Docker image needs `COPY packages/pure ./packages/pure`: docs/pre-pilot-checklist.md, T012)."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# The versions lane A has reviewed. Adding one is a deliberate act: read the changelog, re-run the golden vectors and the equivalence gate (tests/integration/test_followup_equivalence.py),
# move the pinned hashes, and add the version to the database allow-list in a migration that re-reads app.followup_blocker.
ALLOWED_CADENCE_VERSIONS: frozenset[str] = frozenset({"1.0.0"})

MODULE_NAME = "followup_cadence"
ACTIONS = ("wait", "draft_followup", "stop")
RESULT_KEYS = frozenset(
    {
        "action",
        "reason_code",
        "terminal",
        "touch_number",
        "next_eligible_at",
        "engine_version",
        "canonical_hash",
        "trace",
    }
)


def _package_src(here: Path) -> Path | None:
    """app/followups/cadence_port.py is four levels below the repository root; packages/pure holds the package. In a deployed image the file sits elsewhere (a shallow or an installed
    path): there is no checkout, the answer is None, and the package must already be importable (PYTHONPATH)."""
    try:
        return here.resolve().parents[4] / "packages" / "pure"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class CadenceUnavailable(Exception):
    """The engine cannot be used: not importable, a version nobody reviewed, or a surface we do not know. Fail closed."""

    code = "followup_cadence_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class CadenceError(Exception):
    """The package answered something the adapter does not accept (a hash that is not the documented one, a result of an unknown shape)."""

    code = "followup_cadence_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


class CadenceInputError(Exception):
    """The request had a value of the wrong type (a float, a boolean in an integer field). The package's own message names the value and is dropped."""

    code = "followup_cadence_input_type"

    def __init__(self) -> None:
        super().__init__(self.code)


class _Cadence:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.ENGINE_VERSION
        self.decide: Callable[[dict[str, Any]], dict[str, Any]] = module.decide
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Cadence:
    """Accept a module only when it has the documented surface and a reviewed version."""
    version = getattr(module, "ENGINE_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_CADENCE_VERSIONS:
        raise CadenceUnavailable
    if not callable(getattr(module, "decide", None)) or not callable(
        getattr(module, "canonical_json", None)
    ):
        raise CadenceUnavailable
    return _Cadence(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise CadenceUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise CadenceUnavailable from None


_cadence: _Cadence | None = None


def cadence() -> _Cadence:
    """The checked package (loaded once). Raises CadenceUnavailable and keeps trying on the next call."""
    global _cadence
    if _cadence is None:
        _cadence = _check(_import())
    return _cadence


def cadence_version() -> str:
    return cadence().version


def canonical_json(value: Any) -> str:
    """The package's canonical JSON text (sorted keys, compact, ASCII). What a stored request or result is made of."""
    try:
        return cadence().canonical_json(value)
    except TypeError:
        raise CadenceInputError from None


def expected_hash(request: dict[str, Any]) -> str:
    """sha256 of the canonical JSON of {"engine_version", "inputs": request}: the documented hash, computed here independently of the package."""
    payload = canonical_json({"engine_version": cadence().version, "inputs": request})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_rejected(result: dict[str, Any]) -> bool:
    return result.get("status") == "rejected"


def _shape_ok(result: dict[str, Any]) -> bool:
    """The parts of the contract the callers rely on. A result outside it is refused, never repaired."""
    if not isinstance(result.get("trace"), list):
        return False
    if is_rejected(result):
        codes = result.get("codes")
        return (
            isinstance(codes, list)
            and len(codes) == 1
            and isinstance(codes[0], str)
            and "action" not in result
        )
    if set(result) != RESULT_KEYS:
        return False
    nxt = result["next_eligible_at"]
    return (
        result["action"] in ACTIONS
        and isinstance(result["reason_code"], str)
        and type(result["terminal"]) is bool
        and type(result["touch_number"]) is int
        and (nxt is None or isinstance(nxt, str))
        and (nxt is None) == (result["action"] == "stop")
    )


def run_decide(request: dict[str, Any]) -> dict[str, Any]:
    """Run the engine. Returns its dict: an answer (`action`: wait, draft_followup or stop, never send) or a rejection (`status: rejected`, `codes`).

    Raises CadenceUnavailable (fail closed), CadenceInputError (wrong types) or CadenceError (the result is not what the contract says). The request is not modified."""
    e = cadence()
    try:
        result = e.decide(request)
    except TypeError:
        raise CadenceInputError from None
    if (
        not isinstance(result, dict)
        or result.get("engine_version") != e.version
        or not _shape_ok(result)
    ):
        raise CadenceError
    digest = result.get("canonical_hash")
    if digest is None:
        # only an oversized request is rejected before hashing (it is never serialised): never an answer
        if not is_rejected(result):
            raise CadenceError
    elif digest != expected_hash(request):
        raise CadenceError
    return result
