"""Code-scanning py/polynomial-redos in the knowledge readers: a 5 MB file built to make the scan quadratic is read in well under a second, and the readings are unchanged for ordinary files."""

# ruff: noqa: E501

from __future__ import annotations

import time
import zlib

from app.knowledge import readers


def test_html_with_millions_of_open_brackets_is_stripped_in_linear_time() -> None:
    hostile = "<" * 2_000_000 + "text"
    started = time.monotonic()
    out = readers._strip_html(hostile)
    assert time.monotonic() - started < 2.0 and "text" in out


def test_ordinary_html_is_stripped_as_before() -> None:
    assert readers._strip_html("<p>Hello <b>world</b></p><script>x()</script><br/>done").split() == ["Hello", "world", "done"]
    assert readers._strip_html("a < b and c > d").strip() == "a   d"   # a span from < to > is a tag, as before


def test_a_pdf_with_a_million_stream_starts_and_no_end_is_scanned_in_one_pass() -> None:
    hostile = b"stream\n" * 700_000
    started = time.monotonic()
    assert list(readers._streams(hostile)) == []
    assert time.monotonic() - started < 2.0


def test_the_streams_of_an_ordinary_pdf_are_found_exactly_as_before() -> None:
    body = zlib.compress(b"BT (Hello) Tj ET")
    data = b"%PDF-1.4\n1 0 obj\nstream\n" + body + b"\nendstream\nendobj\n2 0 obj\nstream\r\nBT (World) Tj ET\r\nendstream\n"
    got = list(readers._streams(data))
    assert got == [body, b"BT (World) Tj ET"]
    assert "Hello" in readers._pdf_text(data) and "World" in readers._pdf_text(data)
