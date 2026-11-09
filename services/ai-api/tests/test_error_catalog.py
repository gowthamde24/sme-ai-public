"""The API's error codes are a published list (scripts/error_catalog.py): C2 maps each `code` to a plain-language sentence.

1. The committed files (packages/contracts/error_codes.{json,ts}, docs/contracts/error-codes.md) equal what the source says now: a new code cannot ship unlisted (run `make contracts`).
2. A code that was published (error_codes.published.txt, append-only) is still in the source: a code is never renamed or removed, because the web may be mapping it.
3. Every code on the wire matches the closed-word shape, and the codes a real client meets (signed out, wrong path, wrong method, bad body) are in the list.
No database, no network."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

from tests.fakes import TENANT_A, make_client

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("error_catalog", ROOT / "scripts/error_catalog.py")
assert spec and spec.loader
catalog_module = importlib.util.module_from_spec(spec)
sys.modules["error_catalog"] = catalog_module
spec.loader.exec_module(catalog_module)


def codes() -> set[str]:
    return {r["code"] for r in catalog_module.catalog()["codes"]}


def test_committed_files_are_current() -> None:
    assert (ROOT / "packages/contracts/error_codes.json").read_text(
        encoding="utf-8"
    ) == catalog_module.json_text(), "stale: run `make contracts`"
    assert (ROOT / "packages/contracts/error_codes.ts").read_text(
        encoding="utf-8"
    ) == catalog_module.ts_text(), "stale: run `make contracts`"
    assert (ROOT / "docs/contracts/error-codes.md").read_text(
        encoding="utf-8"
    ) == catalog_module.md_text(), "stale: run `make contracts`"


def test_a_published_code_is_never_removed() -> None:
    published = set(catalog_module.PUBLISHED.read_text(encoding="utf-8").split())
    assert published - codes() == set(), (
        "a published code left the source: keep sending it (map the new situation to a new code)"
    )
    assert codes() - published == set(), (
        "a new code is not in error_codes.published.txt: run `make contracts` and commit it"
    )


def test_every_code_is_a_closed_word_with_a_status() -> None:
    cat = catalog_module.catalog()
    assert len(cat["codes"]) > 300
    for row in cat["codes"]:
        assert re.fullmatch(r"[a-z][a-z0-9_]*", row["code"]), row
        assert row["statuses"] and all(400 <= s < 600 for s in row["statuses"]), row
        assert row["areas"], row
    assert [r["code"] for r in cat["codes"]] == sorted(r["code"] for r in cat["codes"])
    assert {f["prefix"] for f in cat["families"]} >= {"indiamart_", "recording_"}


def test_codes_a_client_meets_are_listed() -> None:
    client, _ = make_client()
    seen: list[tuple[str, Any]] = []
    cases: list[tuple[str, str, dict[str, Any]]] = [
        ("GET", "/v1/no-such-path", {}),
        ("DELETE", "/health", {}),
        ("GET", f"/v1/tenants/{TENANT_A.id}/leads", {}),
        ("POST", f"/v1/tenants/{TENANT_A.id}/leads", {"json": ["not", "an", "object"]}),
    ]
    for method, path, kwargs in cases:
        body = client.request(method, path, **kwargs).json()
        if "error" in body:
            seen.append((path, body["error"]["code"]))
    assert seen, "no error answers were produced"
    for path, code in seen:
        assert code in codes(), f"{path}: code {code!r} is not in the catalog"
    for word in (
        "not_found",
        "unauthorized",
        "forbidden",
        "mfa_required",
        "validation_error",
        "rate_limited",
        "payload_too_large",
        "internal_error",
        "method_not_allowed",
    ):
        assert word in codes(), word
