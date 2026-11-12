"""Code-scanning alert 60 (py/partial-ssrf).

A bucket name and an object path become parts of a URL on the storage service, so anything that could
leave that place is refused BEFORE a request is made.
"""

# ruff: noqa: E501

from __future__ import annotations

import httpx
import pytest

from app.catalogue.storage import HttpStorageClient

SEEN: list[str] = []


def client() -> HttpStorageClient:
    def handler(request: httpx.Request) -> httpx.Response:
        SEEN.append(str(request.url))
        return httpx.Response(200, json=[])

    return HttpStorageClient("https://storage.example.test/storage/v1", "anon", client=httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.mark.parametrize("bucket,path", [
    ("catalogue", "../other/secret.jpg"),
    ("catalogue", "tenant/./x.jpg"),
    ("catalogue", "tenant//x.jpg"),
    ("catalogue", "/absolute.jpg"),
    ("catalogue", "tenant\\x.jpg"),
    ("catalogue", "tenant/x.jpg?token=1"),
    ("catalogue", "tenant/x.jpg#frag"),
    ("catalogue", "tenant/x\x00.jpg"),
    ("catalogue", ""),
    ("../catalogue", "tenant/x.jpg"),
    ("Cat alogue", "tenant/x.jpg"),
    ("catalogue/..", "tenant/x.jpg"),
    ("", "tenant/x.jpg"),
])
def test_a_bucket_or_path_that_could_leave_its_place_is_refused_before_any_request(bucket: str, path: str) -> None:
    SEEN.clear()
    with pytest.raises(ValueError, match="storage path refused"):
        client().upload("token", bucket, path, b"x", "image/jpeg")
    assert SEEN == []


def test_the_ordinary_shapes_the_product_uses_still_go_through() -> None:
    SEEN.clear()
    client().upload("token", "business-files", "6f1c0d52-0000-4000-8000-000000000001/logo-1.jpg", b"x", "image/jpeg")
    client().upload("token", "exports", "tenant-a/2026-11/export.zip", b"x", "application/zip")
    assert len(SEEN) == 2 and all(u.startswith("https://storage.example.test/storage/v1/object/") for u in SEEN)
