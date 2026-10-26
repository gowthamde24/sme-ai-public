"""The knowledge base's dedicated refusal (SQLSTATE 53400, job DR / A1). It carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class KnowledgeLimitError(RepositoryError):
    """53400: too many sources (50) or too many facts (500) in the workspace."""
