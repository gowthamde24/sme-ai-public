"""The database's quote refusals as typed exceptions (SQLSTATE SM213 to SM218). SM212 (a quote blocks discarding a requirement) belongs to the enquiries repository, which must not import this package.
Each class carries NO text: the API maps it to a fixed message (app/main.py) and nothing from the data layer ever reaches a client."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class RequirementNotConfirmedError(RepositoryError):
    """SM213: the requirement is not confirmed (or no longer is)."""


class QuoteNotDraftError(RepositoryError):
    """SM214: the quote is not in the state this action needs (a draft to approve or reject, an approved quote to withdraw)."""


class QuoteStaleError(RepositoryError):
    """SM215: a newer price list or policy is active, the picks or the requirement changed, or the quote has expired."""


class QuoteMismatchError(RepositoryError):
    """SM216: the request or the figures are not what the database recomputes (nothing was stored)."""


class QuoteInputMissingError(RepositoryError):
    """SM217: an input the quote needs is missing (a pick for every line, a price list, a policy, a required requirement input)."""


class OwnerApprovalRequiredError(RepositoryError):
    """SM218: the quote needs the Owner's approval (an Admin is told so)."""


SM_ERRORS: dict[str, type[RepositoryError]] = {
    "SM213": RequirementNotConfirmedError,
    "SM214": QuoteNotDraftError,
    "SM215": QuoteStaleError,
    "SM216": QuoteMismatchError,
    "SM217": QuoteInputMissingError,
    "SM218": OwnerApprovalRequiredError,
}
