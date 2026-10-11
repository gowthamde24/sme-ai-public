"""The integrations' dedicated refusals (job BI, ADR 0073). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class ExportTooLargeError(RepositoryError):
    """SM601: the window holds more than an export may carry (2,000 sales or 5,000 payment events): narrow the dates."""


class ImportJobStateError(RepositoryError):
    """SM602: the import job is not in a state that allows this (for example a stock change for a job that is not a previewed stock import)."""


class ImportMismatchError(RepositoryError):
    """SM603: not the same file or mapping as the job's preview."""
