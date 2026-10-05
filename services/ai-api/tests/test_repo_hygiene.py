"""check-no-leftovers.sh fails on tracked editor, patch and `sed -i` leftovers; clean repos pass."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "check-no-leftovers.sh"


def run(directory: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [str(SCRIPT), str(directory)], capture_output=True, text=True, check=False
    )


def tracked_repo(tmp_path: Path, names: list[str]) -> Path:
    git = shutil.which("git")
    assert git
    subprocess.run([git, "init", "-q", str(tmp_path)], check=True)  # noqa: S603
    for name in names:
        (tmp_path / name).write_text("x")
    subprocess.run([git, "-C", str(tmp_path), "add", "-f", "-A"], check=True)  # noqa: S603
    return tmp_path


def test_this_repository_has_no_tracked_leftovers() -> None:
    result = run(ROOT)
    assert result.returncode == 0, result.stderr


def test_a_clean_repository_passes(tmp_path: Path) -> None:
    assert run(tracked_repo(tmp_path, ["a.py", "README.md", "e-mail.txt"])).returncode == 0


@pytest.mark.parametrize(
    "name", ["runtime.py-E", "settings.orig", "patch.rej", "notes.bak", "draft.txt~"]
)
def test_each_leftover_pattern_fails(tmp_path: Path, name: str) -> None:
    result = run(tracked_repo(tmp_path, ["ok.py", name]))
    assert result.returncode == 1
    assert name in result.stderr
