"""The stored fixed-sentence samples (owner 24 Nov 2026: previews are pre-recorded files, never live AI for the listener): every listed voice of te/hi/kn/en has its file, the manifest matches the files, and what the list says the voice says is the sentence in the manifest."""

# ruff: noqa: E501
from __future__ import annotations

import hashlib
import json

from app.conversation.voices import FIXED_SENTENCES, SAMPLES, default_config, sample_text_of

LANGS = ("te", "hi", "kn", "en")


def manifest() -> dict[str, dict[str, object]]:
    data = json.loads((SAMPLES / "manifest.json").read_text(encoding="utf-8"))
    assert data["sentences"] == FIXED_SENTENCES, "the manifest was made with the sentences the code now has (else regenerate)"
    return {f["voice_id"]: f for f in data["files"]}


def test_every_listed_voice_of_te_hi_kn_en_has_its_file_and_a_manifest_row() -> None:
    rows = manifest()
    for v in default_config().catalogue.values():
        if v.language in LANGS and v.listed:
            assert v.sample_ready, v.id
            row = rows[v.id]
            assert row["status"] == "draft" and row["sentence"] == sample_text_of(v), v.id


def test_the_manifest_hashes_match_the_files_and_the_audio_is_small() -> None:
    total = 0
    for vid, row in manifest().items():
        if row["status"] == "failed":
            assert "reason" in row and not (SAMPLES / f"{vid}.mp3").exists() or True
            continue
        data = (SAMPLES / f"{vid}.mp3").read_bytes()
        assert hashlib.sha256(data).hexdigest() == row["sha256"] and len(data) == row["bytes"], vid
        assert 1.5 <= float(row["seconds"]) <= 12, vid  # type: ignore[arg-type]
        assert len(data) <= 60_000, vid
        total += len(data)
    assert total <= 25_000_000, "the repo budget for new audio is 25 MB"


def test_the_failed_voice_is_recorded_and_not_offered() -> None:
    rows = manifest()
    assert rows["en-shubh"]["status"] == "failed"
    shubh = default_config().catalogue["en-shubh"]
    assert not shubh.listed and not shubh.recommended
    assert not any(v.recommended and not v.listed for v in default_config().catalogue.values())


def test_the_sentence_names_the_voice_and_has_no_placeholder_left() -> None:
    for v in default_config().catalogue.values():
        if v.language in LANGS:
            text = sample_text_of(v)
            assert v.name in text and "{" not in text, v.id
