"""The read-only Cartesia refresh (app/conversation/cartesia_refresh.py): a fake list, no network, no key."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.conversation import cartesia_refresh as cr
from app.conversation.voices import default_config

CFG = default_config()


def test_it_lists_the_voices_cartesia_has_and_the_catalogue_lacks_and_those_that_are_gone() -> None:
    ramya = CFG.catalogue["te-ramya"].voices.primary.voice
    offered: dict[tuple[str, str], list[dict[str, Any]]] = {
        ("te", "female"): [{"id": ramya, "name": "Ramya", "language": "te"}, {"id": "brand-new-id", "name": "Fresh", "language": "te"}],
        ("te", "male"): [],   # nothing came back for the men: we do not say every Telugu man is gone
    }
    new, gone = cr.compare(CFG, offered)
    assert new == ["te female brand-new-id Fresh"]
    assert "te female te-sindhu " + CFG.catalogue["te-sindhu"].voices.primary.voice in gone and not any(line.startswith("te male") for line in gone)
    assert not any(ramya in line for line in new + gone)


def test_fetch_asks_for_one_language_and_gender_and_keeps_only_public_voices_of_that_language() -> None:
    seen: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(dict(request.url.params) | {"key": request.headers["x-api-key"]})
        return httpx.Response(200, json={"data": [{"id": "a", "language": "te"}, {"id": "b", "language": "te", "is_public": False}, {"id": "c", "language": "en"}]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        got = cr.fetch(client, "k", "te", "male")
    assert [v["id"] for v in got] == ["a"] and seen[0]["language"] == "te" and seen[0]["gender"] == "masculine" and seen[0]["limit"] == "100"


def test_without_a_key_it_says_so_and_does_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    assert cr.main() == 2
