"""The connectors' refusals, as closed kinds. The database answers with a SQLSTATE; this maps it to one kind and one fixed sentence for the client. Nothing from a provider or the data layer is ever returned."""

from __future__ import annotations

from app.errors import ApiError

# kind -> (HTTP status, code, sentence)
_API: dict[str, tuple[int, str, str]] = {
    "deny": (403, "forbidden", "You do not have access to do this."),
    "invalid": (422, "validation_error", "Invalid input."),
    "reference": (404, "not_found", "Not found."),
    "too_soon": (429, "asked_too_soon", "Please wait a few minutes before asking again."),
    "state": (409, "not_in_a_state_for_this", "This cannot be done in its present state."),
    "open_link": (409, "open_payment_link", "This order already has an open payment link."),
    "hours": (409, "outside_calling_hours", "Calls are made only between 9 am and 9 pm India time."),
}
SQLSTATE_KIND = {"42501": "deny", "22023": "invalid", "23503": "reference", "SM611": "too_soon", "SM612": "state", "SM613": "open_link", "SM614": "hours"}


class ConnectorRefused(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(kind)
        self.kind = kind

    def api(self) -> ApiError:
        status, code, sentence = _API.get(self.kind, _API["deny"])
        return ApiError(status, code, sentence)


class ProviderError(Exception):
    """A provider refused, was unreachable or answered something unexpected. `code` is one of a few constant words; nothing the provider said is kept."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class WebhookRejected(Exception):
    """The provider's signature (or secret) did not check out. Nothing is done and the caller learns nothing."""
