"""The packs' dedicated refusals (job CK). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class ModuleOffError(RepositoryError):
    """SM701: the module is off for this business (default deny): the database refused the work."""


class ExampleAlreadyLoadedError(RepositoryError):
    """SM721: the example data is already loaded for this business."""
