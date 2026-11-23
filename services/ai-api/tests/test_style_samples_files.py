"""The stored style previews (owner 24 Nov 2026): every recommended voice of te/hi/kn/en has a file for each of the seven styles, the manifest matches the files, and the public route serves them."""

# ruff: noqa: E501
from __future__ import annotations

import hashlib
import json

from app.conversation import picker
from app.conversation.style_previews import items
from app.conversation.voices import SAMPLES
from app.telephony import tone
from tests.fakes import make_client

FOLDER = SAMPLES / "styles"


def manifest() -> dict[str, dict[str, object]]:
    data = json.loads((FOLDER / "manifest.json").read_text(encoding="utf-8"))
    return {f["name"]: f for f in data["files"]}


def test_every_recommended_voice_has_all_seven_styles_in_its_language() -> None:
    rows = manifest()
    todo = items()
    assert len(todo) == 112 == len(rows)
    for item in todo:
        row = rows[item.name]
        assert row["status"] == "draft" and row["style"] == item.style and row["language"] == item.language and row["line"] == item.line, item.name
    assert {r["style"] for r in rows.values()} == set(tone.CHOICES)


def test_the_manifest_hashes_match_the_files_and_the_audio_is_small() -> None:
    total = 0
    for name, row in manifest().items():
        data = (FOLDER / f"{name}.mp3").read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["sha256"] and len(data) == row["bytes"], name
        assert 1.5 <= float(row["seconds"]) <= 12 and len(data) <= 60_000, name  # type: ignore[arg-type]
        total += len(data)
    assert total <= 25_000_000


def test_the_public_route_serves_a_stored_style_preview_and_refuses_a_missing_one() -> None:
    client, _ = make_client()
    name = next(iter(manifest()))
    ok = client.get(f"/v1/voice-style-samples/{name}.mp3")
    assert ok.status_code == 200 and ok.headers["content-type"] == "audio/mpeg" and len(ok.content) > 5000
    assert picker.STYLE_SAMPLES == FOLDER
    assert client.get("/v1/voice-style-samples/te-kavitha.confident.hi.mp3").status_code == 404
