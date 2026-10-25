"""Job DJ (ADR 0093): ffmpeg is in the WORKER's image only. The API image stays small (the API never codes audio); the worker image is a target of the same Dockerfile."""

from __future__ import annotations

import re
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[3] / "deploy"


def stages() -> dict[str, str]:
    text = (DEPLOY / "Dockerfile.api").read_text()
    parts = re.split(r"^FROM .* AS (\w+)\s*$", text, flags=re.M)
    return {parts[i]: parts[i + 1] for i in range(1, len(parts), 2)}


def test_the_dockerfile_has_a_base_a_worker_and_a_last_stage_for_the_api() -> None:
    text = (DEPLOY / "Dockerfile.api").read_text()
    s = stages()
    assert list(s) == ["base", "worker", "api"], "the API is the LAST stage: a plain `docker build` makes the small image"
    assert re.findall(r"^FROM .* AS (\w+)\s*$", text, flags=re.M)[-1] == "api"


def test_ffmpeg_is_installed_in_the_worker_stage_and_nowhere_else() -> None:
    s = stages()
    assert "ffmpeg" in s["worker"] and "--no-install-recommends" in s["worker"]
    assert "apt-get" not in s["base"] and "apt-get" not in s["api"]


def test_the_worker_image_runs_as_the_same_non_root_user() -> None:
    assert s_last_user(stages()["worker"]) == "10001"
    assert "USER 10001" in stages()["base"]


def s_last_user(stage: str) -> str:
    users: list[str] = re.findall(r"^USER (\S+)", stage, flags=re.M)
    return users[-1]


def test_the_build_files_build_the_worker_as_its_own_image() -> None:
    run = (DEPLOY / "cloudrun.sh").read_text()
    assert 'image="$registry/worker:$TAG"' in run and "build_worker" in run and "_TARGET=worker" in run
    assert 'image="$registry/api:$TAG"' in run
    build = (DEPLOY / "cloudbuild-api.yaml").read_text()
    assert "--target" in build and "${_TARGET}" in build and "_TARGET: api" in build
