"""The nightly pronunciation round trip (job pronunciation-quality): which languages a night covers, the Cartesia caps (night and month), what it writes, and that it never runs without keys. The engine and the recogniser are fakes: no network, no key, no character spent."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import random
from datetime import UTC, date, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from app.pronunciation import nightly


class FakeEngine:
    spoken: list[str] = []

    def __init__(self, *_: Any, **__: Any) -> None: ...

    async def stream(self, text: str, language: str) -> Any:
        FakeEngine.spoken.append(text)
        yield (b"\x00\x10" * 4000)


class FakeHttp:
    def __init__(self, *_: Any, **__: Any) -> None: ...

    async def __aenter__(self) -> FakeHttp:
        return self

    async def __aexit__(self, *_: Any) -> None: ...

    async def post(self, *_: Any, **__: Any) -> Any:
        return SimpleNamespace(status_code=200, json=lambda: {"transcript": "Dharmavaram"})


@pytest.fixture
def fakes(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeEngine.spoken = []
    monkeypatch.setattr(nightly, "CartesiaStreamTts", FakeEngine)
    monkeypatch.setattr(httpx, "AsyncClient", FakeHttp)
    monkeypatch.setenv("CARTESIA_API_KEY", "k1")
    monkeypatch.setenv("SARVAM_API_KEY", "k2")


def test_a_night_covers_three_languages_and_two_nights_cover_all_six() -> None:
    day = date(2026, 10, 30)
    a, b = nightly.languages_for(day), nightly.languages_for(date.fromordinal(day.toordinal() + 1))
    assert len(a) == 3 and len(set(a)) == 3 and set(a) | set(b) == set(nightly.ALL_LANGUAGES)


def test_it_does_not_run_without_both_keys(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("CARTESIA_API_KEY", raising=False)
    monkeypatch.setenv("SARVAM_API_KEY", "x")
    assert asyncio.run(nightly.main(["--out", str(tmp_path)])) == 2


def test_a_run_writes_the_report_the_clips_and_the_month_s_count_and_stays_under_the_night_cap(fakes: None, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert asyncio.run(nightly.main(["--out", str(tmp_path), "--languages", "te", "kn", "--cap", "300"])) == 0
    day = next(p for p in tmp_path.iterdir() if p.is_dir())
    assert (day / "report.md").read_text(encoding="utf-8").startswith("#") and json.loads((day / "results.json").read_text(encoding="utf-8"))
    assert list((day / "clips" / "te").glob("*.wav")) and list((day / "clips" / "kn").glob("*.wav"))
    sent = sum(len(t) for t in FakeEngine.spoken)
    assert 0 < sent <= 300 and next(tmp_path.glob("usage-*.txt")).read_text(encoding="utf-8") == str(sent)
    out = capsys.readouterr().out
    assert "pronunciation-nightly" in out and "month " in out and "k1" not in out and "k2" not in out


def test_the_canaries_are_always_in_the_slice() -> None:
    items = nightly.corpus("te", 4, True, random.Random(3))  # noqa: S311
    assert [i["id"] for i in items][:2] == ["te-lex-Dharmavaram", "te-lex-Anantapur"]


def test_the_month_cap_stops_a_run_before_anything_is_spoken(fakes: None, tmp_path: Path) -> None:
    today = datetime.now(UTC).date()
    (tmp_path / f"usage-{today:%Y-%m}.txt").write_text("20000", encoding="utf-8")
    assert asyncio.run(nightly.main(["--out", str(tmp_path), "--languages", "te"])) == 0
    assert FakeEngine.spoken == [] and not [p for p in tmp_path.iterdir() if p.is_dir()]


def test_old_days_are_removed_and_other_files_are_left_alone(tmp_path: Path) -> None:
    for name in ("2026-09-01", "2026-10-29"):
        (tmp_path / name).mkdir()
    (tmp_path / "usage-2026-10.txt").write_text("1", encoding="utf-8")
    (tmp_path / "notes").mkdir()
    nightly.prune(tmp_path, date(2026, 10, 30), 30)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["2026-10-29", "notes", "usage-2026-10.txt"]
