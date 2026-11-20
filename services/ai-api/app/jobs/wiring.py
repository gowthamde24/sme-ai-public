"""What the Jobs routes need from the process: the two flags, where the pack files are, and a clock (injectable, like the Lead Finder's). None when JOBS is off: every route then answers 404."""

# ruff: noqa: E501

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.config import Settings
from app.jobs.samples import SampleStore
from app.packs.registry import default_directory


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class JobsRuntime:
    get_paid: bool = False
    directory: Path | None = None
    clock: Callable[[], datetime] = field(default=_now)
    samples: SampleStore | None = None   # the spoken samples of the job cards (ops.job_samples); None in tests that do not use them


def build_jobs(settings: Settings, rest_url: str | None = None, anon_key: str | None = None) -> JobsRuntime | None:
    if settings.jobs != "on":
        return None
    directory = Path(settings.packs_dir) if settings.packs_dir else default_directory()
    return JobsRuntime(get_paid=settings.jobs_get_paid == "on", directory=directory, samples=SampleStore(rest_url, anon_key) if rest_url and anon_key else None)
