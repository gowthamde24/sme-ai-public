"""The building-materials quote refusals as typed exceptions (SQLSTATE SM761 to SM767; job CN). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py).
SM762 and SM766 also carry a CLOSED `detail` code the database function chose itself (which input is missing; which calculator rejection), shown to the caller as `reason`."""

from __future__ import annotations

from app.errors import ApiError
from app.tenancy.repository import RepositoryError


class MaterialQuoteMismatchError(RepositoryError):
    """SM761: the request or the figures are not what the database recomputes (nothing was stored)."""


class MaterialInputMissingError(RepositoryError):
    """SM762: an input the quote needs is missing: detail names it (pick, measure, product_type, price, gst_rate, pieces_per_area, unit, hsn, policy, duplicate_item)."""

    carries_detail = True
    detail: str | None = None


class MaterialQuoteNotDraftError(RepositoryError):
    """SM763: the quote is not a draft."""


class MaterialQuoteStaleError(RepositoryError):
    """SM764: the quote is stale (the price, the item, the rules or the requirement changed) or has expired."""


class MaterialOwnerApprovalError(RepositoryError):
    """SM765: the quote carries a flag, so the Owner alone approves it."""


class MaterialNotComputableError(RepositoryError):
    """SM766: the calculator rejects these inputs (detail is its closed code: DISTANCE_MISSING, DISTANCE_BEYOND_SLABS, LAYING_RATE_MISSING, TOTAL_TOO_LARGE, OUT_OF_RANGE)."""

    carries_detail = True
    detail: str | None = None


class MaterialDisagreementError(ApiError):
    """The calculator and the database computed different quotes for the same inputs. Nothing is stored. This is a defect, never a user error."""

    def __init__(self) -> None:
        super().__init__(500, "calculator_disagreement", "The calculator and the database disagree about this quote, so nothing was stored. Please tell us.")
