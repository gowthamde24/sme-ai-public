"""The business profile's dedicated refusal (job DT, ADR 0115). Carries only the CLOSED reason the database chose; the API maps it to a fixed sentence."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class TypeChangeRefusedError(RepositoryError):
    """SM791: the business type cannot be changed now. `detail` is one of pack_data_present, lead_data_present, unknown_type."""

    carries_detail = True
    detail: str | None = None
