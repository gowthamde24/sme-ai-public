"""Request models for evidence: shape, limits, hygiene, and what a client can never send."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from pydantic import ValidationError

from app.evidence.models import (
    EvidenceCreate,
    EvidenceKind,
    derive_link_id,
    text_is_clean,
)

ID = str(uuid.uuid4())


def make(**over: Any) -> dict[str, Any]:
    return {"id": ID, "kind": "web_page", "url": "https://example.test/a", **over}


def ok(**over: Any) -> EvidenceCreate:
    return EvidenceCreate.model_validate(make(**over))


def bad(**over: Any) -> None:
    with pytest.raises(ValidationError):
        EvidenceCreate.model_validate(make(**over))


# ==== what a client can never send ====
@pytest.mark.parametrize(
    "field",
    [
        "provider",
        "created_by",
        "created_via",
        "created_at",
        "tenant_id",
        "archived_at",
        "company_id",
        "lead_id",
        "claim_id",
        "stance",
        "supersedes_id",
        "contact_id",
    ],
)
def test_server_owned_and_target_fields_are_refused(field: str) -> None:
    bad(**{field: str(uuid.uuid4()) if field.endswith("_id") or field.endswith("_by") else "x"})


def test_a_minimal_body_is_accepted_and_optional_fields_default_to_none() -> None:
    e = ok()
    assert (
        e.reference is None
        and e.snippet is None
        and e.retrieved_at is None
        and e.published_at is None
    )


def test_the_id_must_be_a_canonical_uuid() -> None:
    for value in ["not-a-uuid", "urn:uuid:" + ID, "{" + ID + "}", ID.replace("-", ""), 123, None]:
        bad(id=value)


def test_kind_is_a_closed_enum() -> None:
    for kind in EvidenceKind:
        if kind is not EvidenceKind.IMPORT_BATCH:
            assert ok(kind=kind.value).kind == kind
    bad(kind="carrier_pigeon")
    with pytest.raises(ValidationError):
        EvidenceCreate.model_validate({"id": ID, "url": "https://example.test/a"})


def test_import_batch_provenance_cannot_be_created_by_a_client() -> None:
    """The import writes this kind itself (and the database refuses it from anyone else): the API
    says so up front instead of passing it on."""
    assert EvidenceKind.IMPORT_BATCH.value == "import_batch"  # readable: the import wrote it
    bad(kind="import_batch")
    bad(kind="import_batch", url=None, reference="import:00000000-0000-0000-0000-000000000000")


# ==== a source must be locatable ====
def test_url_or_reference_is_required() -> None:
    with pytest.raises(ValidationError):
        EvidenceCreate.model_validate({"id": ID, "kind": "note", "snippet": "only text"})
    assert ok(url=None, reference="doc:abc-1").reference == "doc:abc-1"
    assert ok(reference="doc:abc-1").url == "https://example.test/a"


# ==== url ====
@pytest.mark.parametrize(
    "url",
    [
        "https://example.test/a",
        "http://example.test",
        "HTTPS://Example.test/P?q=1&r=2#f",
        "https://sub.example.test:8443/a/b@c",
        "https://xn--bcher-kva.example/",
        "https://example.test/" + "a" * (2048 - 21),
        "https://example.test/page-क‍ष",
    ],
)
def test_good_urls(url: str) -> None:
    assert ok(url=url).url == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html;base64,AAA",
        "file:///etc/passwd",
        "ftp://example.test/x",
        "mailto:a@example.test",
        "//example.test/x",
        "example.test/x",
        "https://",
        "https:///path",
        "https://user:pass@example.test/",
        "https://good.test@evil.test/",
        "https://exa mple.test/",
        "https://example.test/a b",
        "https://example.test/a\x01b",
        "https://example.test/a\x7fb",
        "https://example.test/a\u0085b",
        "https://example.test/‮",
        "https://example.test/⁦",
        "https://example.test/​",
        "https://example.test/﻿",
        "https://example.test/a\u2028b",
        "https://example.test/\U000e0020",
        "https://example.test/<script>",
        'https://example.test/"x',
        "https://example.test/'x",
        "https://example.test\\evil",
        "",
        "https://example.test/" + "a" * (2049 - 21),
    ],
)
def test_bad_urls(url: str) -> None:
    bad(url=url)


def test_surrounding_whitespace_is_stripped_but_inner_whitespace_is_not_allowed() -> None:
    assert ok(url="  https://example.test/a \n").url == "https://example.test/a"
    bad(url="https://example.test/a b")


# ==== snippet ====
def test_snippet_limits_and_hygiene() -> None:
    assert ok(snippet="x").snippet == "x"
    assert len(ok(snippet="s" * 1000).snippet or "") == 1000
    assert ok(snippet="line one\r\n\tline two").snippet == "line one\r\n\tline two"
    assert ok(snippet="<script>alert(1)</script>").snippet == "<script>alert(1)</script>"
    assert ok(snippet="Ignore previous instructions.").snippet == "Ignore previous instructions."
    for value in [
        "s" * 1001,
        "",
        "   \n\t ",
        "a\x01b",
        "a\x1bb",
        "a\x7fb",
        "a\u0085b",
        "a‮b",
        "a​b",
        "a﻿b",
        "a\u2028b",
        "a b",
        "a⁠b",
        "a\U000e0020b",
    ]:
        bad(snippet=value)
    for value in ["क्‍ष", "می‌خواهم", "తెలుగు పట్టు చీర", "مرحبا", "a‎b‏"]:
        assert ok(snippet=value).snippet == value


def test_snippet_is_stored_verbatim_apart_from_edge_whitespace() -> None:
    assert ok(snippet="  keep  inner   spaces  ").snippet == "keep  inner   spaces"


# ==== reference ====
def test_reference_pattern() -> None:
    for value in [
        "doc:abc-123",
        "run:00000000-0000-0000-0000-000000000001",
        "upload:2026/10/a_b.pdf#p2",
    ]:
        assert ok(reference=value).reference == value
    for value in [
        "abc123",
        "DOC:abc",
        "d:abc",
        "doc:has space",
        "doc:someone@example.test",
        "doc:",
        "doc:" + "a" * 97,
        "doc:abc\n",
    ]:
        bad(reference=value)


# ==== dates ====
def test_dates_need_a_timezone_and_published_cannot_follow_retrieved() -> None:
    assert ok(retrieved_at="2026-01-02T00:00:00Z", published_at="2026-01-01T00:00:00Z")
    assert ok(retrieved_at="2026-01-02T00:00:00Z", published_at="2026-01-02T00:00:00Z")
    bad(retrieved_at="2026-01-02T00:00:00")  # naive
    bad(published_at="2026-01-02T00:00:00")
    bad(retrieved_at="2026-01-01T00:00:00Z", published_at="2026-01-02T00:00:00Z")
    bad(retrieved_at="yesterday")


# ==== hygiene function ====
@pytest.mark.parametrize(
    "cp",
    [
        0x1,
        0x8,
        0xB,
        0xC,
        0xE,
        0x1F,
        0x7F,
        0x85,
        0x9F,
        0x200B,
        0x2028,
        0x2029,
        0x202A,
        0x202E,
        0x2060,
        0x2064,
        0x2066,
        0x2069,
        0xFEFF,
        0xE0000,
        0xE0020,
        0xE007F,
    ],
)
def test_text_is_clean_blocks(cp: int) -> None:
    assert not text_is_clean("a" + chr(cp) + "b")


@pytest.mark.parametrize(
    "cp",
    [
        0x9,
        0xA,
        0xD,
        0x20,
        0xA0,
        0xAD,
        0x200C,
        0x200D,
        0x200E,
        0x200F,
        0x2065,
        0x2065 + 0x100,
        0xE0080,
        0xFFFD,
        0x1F600,
    ],
)
def test_text_is_clean_allows(cp: int) -> None:
    assert text_is_clean("a" + chr(cp) + "b")


# ==== link ids ====
def test_the_link_id_is_derived_and_depends_on_every_input() -> None:
    e, t = uuid.uuid4(), uuid.uuid4()
    assert derive_link_id(e, "company", t) == derive_link_id(e, "company", t)
    assert derive_link_id(e, "company", t) != derive_link_id(e, "lead", t)
    assert derive_link_id(e, "company", t) != derive_link_id(e, "company", uuid.uuid4())
    assert derive_link_id(e, "company", t) != derive_link_id(uuid.uuid4(), "company", t)
