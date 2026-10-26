"""The refusals of the outreach functions (job DR A3). Each carries no text from the data layer; the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class OutreachStateError(RepositoryError):
    """SM811: not in a state that allows this (an approved batch cannot be re-planned, a paused-by-minutes batch cannot just resume, a finished item takes no result)."""


class PlanChangedError(RepositoryError):
    """SM812: the plan changed since it was shown; read it again and approve what you see."""
