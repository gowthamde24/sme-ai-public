"""The tasks' dedicated refusals (SQLSTATE SM951 to SM953; job DR B1). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class NotForSchoolsError(RepositoryError):
    """SM951: a school's task may not talk about fees, marks or dues (nor remind of a payment)."""


class PlanChangedError(RepositoryError):
    """SM952: the plan the Owner saw is not what the task now holds."""


class TaskStateError(RepositoryError):
    """SM953: the task is not in a state that allows this."""
