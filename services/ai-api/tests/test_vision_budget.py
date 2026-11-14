# ruff: noqa: E501
"""A scanned page is read by the AI one page per call, each call small enough for a run's output budget (every call reserves its whole max_output_tokens; 2 x max must fit in 3,000). With 6,000 here every
scanned PDF failed on staging with "couldn't read the scanned pages" (owner, 14 Nov 2026, his GST certificate)."""

from __future__ import annotations

from typing import Any

import pytest

from app.assistant_work.extract import Page
from app.assistant_work.vision import MAX_PAGES, TOKENS_OUT, model_vision


def test_the_reads_are_small_and_one_per_page(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[int, int]] = []

    def fake_run(runtime: Any, token: str, tenant_id: Any, **kw: Any) -> dict[str, Any]:
        calls.append((kw["max_output_tokens"], len(kw["attachments"])))
        return {"text": f"page {len(calls)}"}

    monkeypatch.setattr("app.assistant_context.modelrun.run", fake_run)
    read = model_vision(object(), "t", object())   # type: ignore[arg-type]
    text = read([Page("image/png", b"1"), Page("image/png", b"2"), Page("image/png", b"3")])
    assert text == "page 1\n\npage 2\n\npage 3" and calls == [(TOKENS_OUT, 1)] * 3
    assert 2 * TOKENS_OUT <= 3_000, "two reservations must fit in the run's output budget"
    calls.clear()
    read([Page("image/png", b"x")] * 9)
    assert len(calls) == MAX_PAGES
    calls.clear()
    assert read([Page("application/pdf", b"%PDF")]) == "page 1" and calls == [(TOKENS_OUT, 1)], "a PDF that could not be turned into pages goes as one document"
