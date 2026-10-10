"""The outbox's two dedicated refusals (job AT, ADR 0066). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class OutboxStateError(RepositoryError):
    """SM501: the message or call request is not in a state that allows this (already decided, already sent, not waiting for approval)."""


class CustomerStoppedError(RepositoryError):
    """SM502: the customer has asked us to stop (or the record was erased): no call request, no approval."""
