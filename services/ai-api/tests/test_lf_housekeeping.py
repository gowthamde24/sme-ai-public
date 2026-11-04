"""Lead Finder (ADR 0119): the scheduler expires Google Maps fields after 30 days, at most every six hours, and a failure never fails its tick."""

# ruff: noqa: E501
from __future__ import annotations

import pytest

from app.lead_finder.housekeeping import MAX_AGE_DAYS, PlacesExpiry
from app.tenancy.repository import TokenRejected


def test_runs_at_most_every_six_hours_and_survives_a_failure() -> None:
    clock = [0.0]
    calls: list[str] = []

    def call(token: str) -> int:
        calls.append(token)
        if len(calls) == 2:
            raise RuntimeError("data layer down")
        return 3

    job = PlacesExpiry(call, monotonic=lambda: clock[0])
    assert job.run_if_due("t") == 3
    clock[0] += 3600
    assert job.run_if_due("t") is None and len(calls) == 1, "not again within six hours"
    clock[0] += 6 * 3600
    assert job.run_if_due("t") is None and len(calls) == 2, "a failure is logged, not raised"
    assert MAX_AGE_DAYS == 30


def test_a_refused_token_still_ends_the_tick() -> None:
    def call(token: str) -> int:
        raise TokenRejected("401")

    with pytest.raises(TokenRejected):
        PlacesExpiry(call).run_if_due("t")
