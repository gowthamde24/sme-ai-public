"""The visits' dedicated refusals (job AS, ADR 0067). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class VisitStateError(RepositoryError):
    """SM501: the visit is not in a state that allows this (already confirmed, already closed, not arrived yet, a second live visit at the same moment)."""


class CustomerErasedError(RepositoryError):
    """SM502: the customer's record was erased: no visit can be booked for them."""


class ShopClosedError(RepositoryError):
    """SM511: the shop is closed that day (a closed weekday or a closed date)."""


class SlotInvalidError(RepositoryError):
    """SM512: that time is not one of the day's slots (not on the grid, or outside the opening hours)."""


class SlotFullError(RepositoryError):
    """SM513: every place in that slot is taken."""


class PastDateError(RepositoryError):
    """SM514: that date has already passed."""


class NoQuoteError(RepositoryError):
    """SM515: the customer has no approved quote without an order to make the order from."""
