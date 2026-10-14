"""The sites' dedicated refusal (job CN). Carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class SiteContactError(RepositoryError):
    """SM751: the site contact is not a contact of this business."""
