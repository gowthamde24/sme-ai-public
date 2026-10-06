"""The database's order refusals as typed exceptions (SQLSTATE SM230 to SM239, ADR 0021). Each class carries NO text from the data layer: the API maps it to a fixed message
(app/main.py). SM232 (the lifecycle refuses the event) carries ONE closed reason, taken from the error's DETAIL only when it is on the closed list below, otherwise OTHER."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class OrderQuoteNotApprovedError(RepositoryError):
    """SM230: the quote is not approved (a draft, rejected, superseded or withdrawn quote)."""


class OrderExistsError(RepositoryError):
    """SM231: another order already exists for this quote."""


class OrderRefusedError(RepositoryError):
    """SM232: the lifecycle refuses this event for this order. `reason` is one of REASONS."""

    def __init__(self, code: str, reason: str = "OTHER") -> None:
        super().__init__(code)
        self.reason = reason


class OrderFiguresError(RepositoryError):
    """SM233: the quote's figures cannot satisfy the order policy (zero value, a missing advance, a total above the lifecycle's cap)."""


class OwnerRequiredError(RepositoryError):
    """SM234: this action (a refund, a cancellation that carries money) is the Owner's."""


class OrderClosedError(RepositoryError):
    """SM235: the order is closed (closed_paid, declined, expired or cancelled)."""


class QuoteExpiredError(RepositoryError):
    """SM236: the quote has expired."""


class QuoteHasOrderError(RepositoryError):
    """SM237: the quote has a live order (withdrawal or replacement refused)."""


class OrderMismatchError(RepositoryError):
    """SM238: the request or the result is not what the database computes (typically: the order changed since it was read)."""


class NoOrderPolicyError(RepositoryError):
    """SM239: no order policy is in force."""


# the closed list of the lifecycle's refusal codes the API will repeat to a client (anything else is OTHER)
REASONS: tuple[str, ...] = (
    "ILLEGAL_TRANSITION",
    "QUOTE_NOT_EXPIRED",
    "QUOTE_EXPIRED",
    "CANCEL_WINDOW_CLOSED",
    "ADVANCE_NOT_PAID",
    "DUPLICATE_PAYMENT_ID",
    "DUPLICATE_REFUND_ID",
    "OVERPAYMENT",
    "REFUND_EXCEEDS_PAID",
    "CLOSED_UNPAID",
    "INVALID_ADVANCE",
    "INVALID_CANCEL_WINDOW",
    "INVALID_STATE",
    "INVALID_EVENT",
    "OUT_OF_RANGE",
    "OTHER",
)

SM_ERRORS: dict[str, type[RepositoryError]] = {
    "SM230": OrderQuoteNotApprovedError,
    "SM231": OrderExistsError,
    "SM233": OrderFiguresError,
    "SM234": OwnerRequiredError,
    "SM235": OrderClosedError,
    "SM236": QuoteExpiredError,
    "SM237": QuoteHasOrderError,
    "SM238": OrderMismatchError,
    "SM239": NoOrderPolicyError,
}
