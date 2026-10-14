"""The dues' dedicated refusals (job CN). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class InvoiceNumberUsedError(RepositoryError):
    """SM781: that invoice number is already used by a live invoice of this business."""


class AlreadyVoidedError(RepositoryError):
    """SM782: the invoice or payment is already voided."""
