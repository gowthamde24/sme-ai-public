"""The refusals of plans and billing (SQLSTATE SM821 to SM823 of the database, and two of our own). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class PlanUnknownError(RepositoryError):
    """SM821: no such plan in the catalogue, or a plan one cannot subscribe to (the trial plan)."""


class TrialAlreadyStartedError(RepositoryError):
    """SM822: this workspace already started its trial (a trial is started once)."""


class NothingToCancelError(RepositoryError):
    """SM823: there is no subscription to cancel, or it is cancelled already."""


class PaymentMethodDeclinedError(RepositoryError):
    """The provider refused the payment method when the trial was to start. Nothing was created."""


class PlanLimitReachedError(RepositoryError):
    """The kind (call minutes or business-initiated WhatsApp messages) is stopped for this workspace until a top-up or the next period. `kind` is one of the two closed words."""

    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind


class WorkspaceReadOnlyError(RepositoryError):
    """The workspace is read-only (its trial or paid period ended unpaid): viewing and exporting stay, every change stops."""


class NotSupportedError(Exception):
    """A provider does not do this (the fake provider receives no webhooks)."""
