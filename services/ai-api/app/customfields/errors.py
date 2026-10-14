"""Custom fields' dedicated refusals (job CK). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class CustomValueInvalidError(RepositoryError):
    """SM711: the value does not fit the field (wrong kind, a choice that is not offered, a text that is too long or holds a phone number or an e-mail address, an unknown field)."""


class CustomFieldLimitError(RepositoryError):
    """SM712: the business has the most fields it may have for that entity (20 active, 40 in all)."""
