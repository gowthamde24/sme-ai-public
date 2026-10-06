"""The ONE door to lane C's pure order lifecycle (`packages/pure/order_lifecycle`, docs/plans/order-lifecycle.md, ADR 0021).

The lifecycle PROPOSES a transition for one event on one order (state, ledger, policy, flags) and returns the new state, the money and the flags. It persists nothing, authorises nothing and
approves nothing: `owner_override` is not proof (the database derives it from the caller's role) and its hash binds the request, not the person. Nothing else in the API may import
`order_lifecycle`: a boundary test fails if another module does. The adapter gives lane A the guarantees the package cannot give itself:

  * **Versioned.** Only versions in ALLOWED_LIFECYCLE_VERSIONS run. An upgrade by lane C changes ENGINE_VERSION; until a person reviews its changelog and adds the version here (and to the
    database allow-list `order_engine_versions`) the order endpoints fail closed (LifecycleUnavailable). The golden vectors (tests/test_orders_lifecycle_port.py) additionally pin the
    canonical hash and the whole output of fixed requests, so a behaviour change WITHOUT a version bump is caught too.
  * **Fail closed.** A missing package, an unknown version or a missing function raises LifecycleUnavailable (the API answers 503); the API still boots.
  * **Nothing from the package leaks.** Errors carry a fixed code only: a TypeError (it names the offending value) becomes LifecycleInputError.
  * **Verified hash.** The package hashes `{"engine_version", "inputs": request}` (sorted compact ASCII JSON); the adapter recomputes it on every run and refuses a result whose `canonical_hash`
    differs, and refuses a result of a shape it does not know (LifecycleError).

Money is integer paise; timestamps are canonical `YYYY-MM-DDTHH:MM:SSZ`; the package reads no clock. No dependency is added: it is stdlib-only and is put on the import path from the repository
checkout when it is not already importable (the Docker image needs `COPY packages/pure ./packages/pure`: docs/pre-pilot-checklist.md, T012)."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# The versions lane A has reviewed. Adding one is a deliberate act: read the changelog, re-run the golden vectors and the equivalence property test, move the pinned hashes.
ALLOWED_LIFECYCLE_VERSIONS: frozenset[str] = frozenset({"1.0.0"})

MODULE_NAME = "order_lifecycle"

STATES = (
    "quote_approved",
    "quote_sent",
    "accepted",
    "advance_requested",
    "advance_paid",
    "in_preparation",
    "dispatched",
    "delivered",
    "closed_paid",
    "declined",
    "expired",
    "cancelled",
)


def _package_src(here: Path) -> Path | None:
    """app/orders/lifecycle_port.py is four levels below the repository root; packages/pure holds the package. In a deployed image the file sits elsewhere (a shallow or an installed path):
    there is no checkout, the answer is None, and the package must already be importable (PYTHONPATH)."""
    try:
        return here.resolve().parents[4] / "packages" / "pure"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class LifecycleUnavailable(Exception):
    """The lifecycle cannot be used: not importable, a version nobody reviewed, or a shape we do not know. Fail closed."""

    code = "order_lifecycle_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class LifecycleError(Exception):
    """The package answered something the adapter does not accept (a hash that is not the documented one, a result of an unknown shape)."""

    code = "order_lifecycle_inconsistent"

    def __init__(self) -> None:
        super().__init__(self.code)


class LifecycleInputError(Exception):
    """The request had a value of the wrong type (a float, a boolean in an integer field, a non-JSON object). The package's own message names the value and is dropped."""

    code = "order_lifecycle_input_type"

    def __init__(self) -> None:
        super().__init__(self.code)


class _Lifecycle:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.ENGINE_VERSION
        self.transition: Callable[[dict[str, Any]], dict[str, Any]] = module.transition
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Lifecycle:
    """Accept a module only when it has the documented surface and a reviewed version."""
    version = getattr(module, "ENGINE_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_LIFECYCLE_VERSIONS:
        raise LifecycleUnavailable
    if not callable(getattr(module, "transition", None)) or not callable(
        getattr(module, "canonical_json", None)
    ):
        raise LifecycleUnavailable
    return _Lifecycle(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise LifecycleUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise LifecycleUnavailable from None


_lifecycle: _Lifecycle | None = None


def lifecycle() -> _Lifecycle:
    """The checked package (loaded once). Raises LifecycleUnavailable and keeps trying on the next call."""
    global _lifecycle
    if _lifecycle is None:
        _lifecycle = _check(_import())
    return _lifecycle


def lifecycle_version() -> str:
    return lifecycle().version


def canonical_json(value: Any) -> str:
    """The package's canonical JSON text (sorted keys, compact, ASCII). What a stored request or result is made of."""
    try:
        return lifecycle().canonical_json(value)
    except TypeError:
        raise LifecycleInputError from None


def expected_hash(request: dict[str, Any]) -> str:
    """sha256 of the canonical JSON of {"engine_version", "inputs": request}: the documented hash, computed here independently of the package."""
    payload = canonical_json({"engine_version": lifecycle().version, "inputs": request})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def is_rejected(result: dict[str, Any]) -> bool:
    return result.get("status") == "rejected"


def _shape_ok(result: dict[str, Any]) -> bool:
    """The parts of the contract the callers rely on. A result outside it is refused, never repaired."""
    flags = result.get("flags")
    if not isinstance(flags, dict) or not isinstance(flags.get("reasons"), list):
        return False
    if not isinstance(flags.get("needs_owner_approval"), bool):
        return False
    if not isinstance(result.get("trace"), list) or not isinstance(
        result.get("allowed_next_events"), list
    ):
        return False
    if result["status"] == "rejected":
        codes = result.get("codes")
        return (
            result.get("new_state") is None
            and isinstance(codes, list)
            and len(codes) == 1
            and isinstance(codes[0], str)
        )
    for key in ("paid_total", "balance_due"):
        value = result.get(key)
        if type(value) is not int or value < 0:
            return False
    return result.get("new_state") in STATES


def run_transition(request: dict[str, Any]) -> dict[str, Any]:
    """Run the lifecycle. Returns its dict: `status: ok` (a proposed transition) or `status: rejected` (`codes`).

    Raises LifecycleUnavailable (fail closed), LifecycleInputError (wrong types) or LifecycleError (the result is not what the contract says).
    The request is not modified."""
    e = lifecycle()
    try:
        result = e.transition(request)
    except TypeError:
        raise LifecycleInputError from None
    if (
        not isinstance(result, dict)
        or result.get("engine_version") != e.version
        or result.get("status") not in ("ok", "rejected")
        or not _shape_ok(result)
    ):
        raise LifecycleError
    digest = result.get("canonical_hash")
    if digest is None:
        # only an oversized request is rejected before hashing (it is never serialised): never an ok
        if not is_rejected(result):
            raise LifecycleError
    elif digest != expected_hash(request):
        raise LifecycleError
    return result
