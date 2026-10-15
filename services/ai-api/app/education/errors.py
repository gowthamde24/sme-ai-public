"""The education pack's dedicated refusals (SQLSTATE SM811 to SM815; job CR, ADR 0087). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class AdmissionNumberUsedError(RepositoryError):
    """SM811: that admission number is already used by a student of this school."""


class AdmissionStageError(RepositoryError):
    """SM812: the enquiry cannot move to that stage from where it is."""


class FeePlanInUseError(RepositoryError):
    """SM813: a student has been assigned this fee plan, so it can no longer change."""


class FeePlanExistsError(RepositoryError):
    """SM814: the student already has a fee plan for that academic year."""


class StudentInactiveError(RepositoryError):
    """SM815: the student left or was erased, so this cannot be done."""
