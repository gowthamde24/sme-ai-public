# ruff: noqa: E501
"""Responses are compressed when the caller accepts it (19 Nov 2026), never event streams, never the in-process reads."""

from __future__ import annotations

from starlette.middleware.gzip import DEFAULT_EXCLUDED_CONTENT_TYPES

from tests.fakes import make_client


def test_a_big_answer_is_gzipped_for_a_caller_that_accepts_it_and_plain_for_one_that_does_not() -> None:
    client, _ = make_client()
    plain = client.get("/v1/privacy/subprocessors", headers={"Accept-Encoding": "identity"})
    assert plain.status_code == 200 and "content-encoding" not in plain.headers
    zipped = client.get("/v1/privacy/subprocessors", headers={"Accept-Encoding": "gzip"})
    assert zipped.status_code == 200 and zipped.headers.get("content-encoding") == "gzip" and zipped.json() == plain.json()
    assert "Accept-Encoding" in zipped.headers.get("vary", "")


def test_the_assistants_event_streams_are_never_compressed_and_the_in_process_reads_are_left_alone() -> None:
    assert "text/event-stream" in DEFAULT_EXCLUDED_CONTENT_TYPES
    client, _ = make_client()
    inner = client.get("/v1/privacy/subprocessors", headers={"Accept-Encoding": "gzip", "x-internal-bootstrap": "x"})
    assert inner.headers.get("content-encoding") is None
