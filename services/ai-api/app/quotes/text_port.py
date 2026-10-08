"""The ONE door to lane C's pure quote text renderer (`packages/pure/quote_text`, docs/plans/quote-text.md).

The renderer turns an APPROVED engine result into plain text a person copies into WhatsApp or e-mail. It sends nothing, reads no contacts and approves nothing; it checks
that the hash it is given equals the engine result's hash, but it is NOT an authorization or a signature check. THIS module and its caller are: lane A supplies `approved=True` only
from the stored approval record and `expected_engine_hash` ONLY from that same stored row (never from the request, never from the result being rendered).

Versioned and fail closed like the engine and mapper adapters (ALLOWED_RENDERER_VERSIONS, a golden test pins the hash and the whole output); a rejection becomes TextRefused (a
fixed code); the renderer's own canonical hash is recomputed and a different one refused. Only this module names `quote_text`."""

from __future__ import annotations

import hashlib
import sys
from collections.abc import Callable
from importlib import import_module as _import_module
from pathlib import Path
from types import ModuleType
from typing import Any

# Only the version the package reports today. The text of a quote is rendered ON DEMAND from the stored approved row (service.render_text): no column, message or log keeps the renderer version or the rendered
# text, so no stored quote needs an older renderer. The older renderers (1.0.0, 1.1.0) are frozen modules inside the package that this adapter never loads. Anything else fails closed (TextUnavailable).
ALLOWED_RENDERER_VERSIONS: frozenset[str] = frozenset({"1.2.0"})
MODULE_NAME = "quote_text"
MAX_WIDTH = 60


def _package_src(here: Path) -> Path | None:
    """app/quotes/text_port.py is four levels below the repository root; packages/pure holds the renderer. In a deployed image there is no checkout: None."""
    try:
        return here.resolve().parents[4] / "packages" / "pure"
    except IndexError:
        return None


_PACKAGE_SRC = _package_src(Path(__file__))


class TextUnavailable(Exception):
    """The renderer cannot be used (not importable, an unreviewed version, a shape we do not know). Fail closed."""

    code = "quote_text_unavailable"

    def __init__(self) -> None:
        super().__init__(self.code)


class TextRefused(Exception):
    """The renderer refused the request or answered something the adapter does not accept. `reason` is the renderer's own fixed code (or ours); never a value."""

    code = "quote_text_refused"

    def __init__(self, reason: str = "INCONSISTENT") -> None:
        super().__init__(self.code)
        self.reason = reason


class _Renderer:
    def __init__(self, module: ModuleType) -> None:
        self.version: str = module.RENDERER_VERSION
        self.render: Callable[[dict[str, Any]], dict[str, Any]] = module.render
        self.canonical_json: Callable[[Any], str] = module.canonical_json


def _check(module: ModuleType) -> _Renderer:
    version = getattr(module, "RENDERER_VERSION", None)
    if not isinstance(version, str) or version not in ALLOWED_RENDERER_VERSIONS:
        raise TextUnavailable
    if not callable(getattr(module, "render", None)) or not callable(
        getattr(module, "canonical_json", None)
    ):
        raise TextUnavailable
    return _Renderer(module)


def _import(src: Path | None = _PACKAGE_SRC) -> ModuleType:
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        pass
    if src is None or not src.is_dir():
        raise TextUnavailable from None
    if str(src) not in sys.path:
        sys.path.append(str(src))  # appended, never first: nothing already importable is shadowed
    try:
        return _import_module(MODULE_NAME)
    except ImportError:
        raise TextUnavailable from None


_renderer: _Renderer | None = None


def renderer() -> _Renderer:
    global _renderer
    if _renderer is None:
        _renderer = _check(_import())
    return _renderer


def renderer_version() -> str:
    return renderer().version


def render_approved(
    quote_result: dict[str, Any], expected_engine_hash: str, display: dict[str, Any]
) -> dict[str, Any]:
    """Render the text of an APPROVED quote. `quote_result` is the stored engine result; `expected_engine_hash` MUST come from the stored approved quote row.

    Returns {text, line_count, canonical_hash, renderer_version}. Raises TextUnavailable (fail closed) or TextRefused (the renderer refused: NOT_APPROVED never happens here
    because this function only ever passes approved=True; HASH_MISMATCH means the stored row and the stored result disagree)."""
    r = renderer()
    request = {
        "quote": quote_result,
        "approved": True,
        "expected_engine_hash": expected_engine_hash,
        "display": display,
    }
    try:
        out = r.render(request)
    except TypeError:
        raise TextRefused("INVALID_TYPE") from None
    if not isinstance(out, dict):
        raise TextRefused
    if out.get("status") == "rejected":
        code = out.get("code")
        raise TextRefused(
            code if isinstance(code, str) and code.isupper() and len(code) <= 40 else "INCONSISTENT"
        )
    text = out.get("text")
    if (
        not isinstance(text, str)
        or out.get("line_count") != len(text.split("\n"))
        or any(len(line) > MAX_WIDTH for line in text.split("\n"))
    ):
        raise TextRefused
    digest = hashlib.sha256(
        r.canonical_json({"renderer_version": r.version, "inputs": request}).encode("utf-8")
    ).hexdigest()
    if out.get("canonical_hash") != digest:
        raise TextRefused
    return {
        "text": text,
        "line_count": out["line_count"],
        "canonical_hash": digest,
        "renderer_version": r.version,
    }
