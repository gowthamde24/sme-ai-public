"""The deliveries' dedicated refusals (SQLSTATE SM771 to SM776; job CN). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class TripStateError(RepositoryError):
    """SM771: the trip is not in a state that allows this."""


class OrderNotDispatchedError(RepositoryError):
    """SM772: the truck does not leave before the order is dispatched."""


class QuantityExceedsOrderError(RepositoryError):
    """SM773: more than the order line holds."""


class OrderNotDeliverableError(RepositoryError):
    """SM774: the order is closed, is not accepted yet, or has no material quote."""


class NoSiteContactError(RepositoryError):
    """SM775: the trip has no site contact to tell."""


class ProofIncompleteError(RepositoryError):
    """SM776: the proof of delivery needs a photo in storage and a name."""
