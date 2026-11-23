"""Job EB part A on the real stack: the owner's notes are versioned in the database, the version check holds across two people, an old version is restorable as a new one, roles are enforced by the database,
and one business never reads another's notes. Synthetic data only."""

# ruff: noqa: E501, S608

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from assistant_support import assistant_app
from conftest import bearer
from crm_support import World
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack)


def test_the_notes_are_versioned_checked_restorable_and_private(app: TestClient, eval_world: World) -> None:
    a, b = eval_world.a, eval_world.b
    base = f"/v1/tenants/{a.id}/ai-assistant/context"
    owner, admin, viewer = bearer(a.users["owner"]), bearer(a.users["admin"]), bearer(a.users["viewer"])

    empty = app.get(base, headers=viewer).json()
    assert empty["version"] == 0 and empty["notes"] == "" and empty["updated_by"] is None

    one = app.put(base, json={"notes": "We sell pavers.\nFree delivery within 10 km.", "expected_version": 0}, headers=owner)
    assert one.status_code == 200, one.text
    assert one.json()["version"] == 1 and one.json()["updated_by"]["id"]

    stale = app.put(base, json={"notes": "Admin text", "expected_version": 0}, headers=admin)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "context_changed" and stale.json()["error"]["current"]["version"] == 1

    two = app.put(base, json={"notes": "We sell pavers.\nFree delivery within 10 km.\nOpen 9 to 7.", "expected_version": 1}, headers=admin)
    assert two.json()["version"] == 2
    same = app.put(base, json={"notes": "We sell pavers.\nFree delivery within 10 km.\nOpen 9 to 7.", "expected_version": 2}, headers=owner)
    assert same.json()["version"] == 2, "the same words again change nothing"

    listed = app.get(f"{base}/versions", headers=viewer).json()["items"]
    assert [i["version"] for i in listed] == [2, 1] and listed[0]["change"] == "added 1 line" and "notes" not in listed[0]
    assert app.get(f"{base}/versions/1", headers=viewer).json()["notes"].startswith("We sell pavers.")
    assert app.get(f"{base}/versions/9", headers=viewer).status_code == 404

    restored = app.post(f"{base}/versions/1/restore", json={"expected_version": 2}, headers=owner)
    assert restored.status_code == 200 and restored.json()["version"] == 3 and "Open 9 to 7." not in restored.json()["notes"]
    assert app.get(f"{base}/versions", headers=owner).json()["items"][0]["change"] == "restored version 1"

    assert app.put(base, json={"notes": "x", "expected_version": 3}, headers=viewer).status_code == 403
    assert app.put(base, json={"notes": "x" * 20_001, "expected_version": 3}, headers=owner).status_code == 422

    other = bearer(b.users["owner"])
    assert app.get(base, headers=other).status_code == 404, "another business is a stranger"
    assert app.get(f"/v1/tenants/{b.id}/ai-assistant/context", headers=other).json()["version"] == 0, "and has its own notes"
