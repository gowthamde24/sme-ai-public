"""The refusals of the top-up refund (SQLSTATE SM936 to SM938, migration 20261231992210).

The API maps each to a fixed sentence in routes.py."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class NothingUnusedError(RepositoryError):
    """SM936: every rupee of that top-up was used; there is nothing to refund."""


class AlreadyRefundedError(RepositoryError):
    """SM937: that order already has a refund (done or in progress)."""


class NotAPaidTopupError(RepositoryError):
    """SM938: no paid top-up with that id in that business."""
