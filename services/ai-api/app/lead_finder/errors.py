"""The Lead Finder's dedicated refusals (SQLSTATE SM971 to SM973; ADR 0119). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

# ruff: noqa: E501

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class NotForThisBusinessError(RepositoryError):
    """SM971: this business type has no Lead Finder (a school: no outreach)."""


class SearchCapError(RepositoryError):
    """SM972: the searches of today are used up."""


class ProspectStateError(RepositoryError):
    """SM973: not possible in the state it is in now (a suppressed business, a search that is not approved)."""
