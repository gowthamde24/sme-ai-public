"""The privacy-rights refusals (job BN, ADR 0075). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class SoleOwnerError(RepositoryError):
    """SM611: the person is the only Owner of a workspace, so their account cannot be deleted until someone else owns it or the workspace is deleted."""


class CoolingOffError(RepositoryError):
    """SM612: the cooling-off period of a deletion has not ended."""


class PrivacyStateError(RepositoryError):
    """SM613: not in a state that allows this (an export is already running, a request is already open, it was cancelled or finished)."""


class PrivacyRateError(RepositoryError):
    """SM614: too many requests in a day."""


class ConfirmationError(RepositoryError):
    """SM615: what the person typed (their e-mail, the workspace name) does not match."""
