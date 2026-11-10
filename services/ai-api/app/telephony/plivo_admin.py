"""Plivo's account side, the little of it onboarding a business needs (job 3 phase C, 10 Nov 2026): a subaccount per business, its compliance (KYC) application's status, a number, an Application, and the link between them.
Plivo's own flow for a reseller (docs, read 10 Nov 2026): create a subaccount for each customer -> the customer's compliance application (filed for THAT subaccount) is accepted -> buy numbers with `subaccount` and
`compliance_application_id` -> each customer's KYC stays with their subaccount.

WHAT THIS NEVER DOES: file a compliance application or touch a document. Plivo's Compliance API takes the documents as an upload by the account holder; the owner's rule is that Stack19 never handles a customer's documents, so the
application is made by the business itself with Plivo (or by the owner in the Plivo console, for Customer Zero) and this module only READS its status and uses its id.

Every call is made with the credentials of the object's own account (the main account's for the subaccount and the purchase, the subaccount's for its Application); credentials stay inside the object and are never logged or returned
(a new subaccount's token is returned to the ONE caller that stores it). A failure is a closed word (PlivoError.reason). The REST shapes of search, purchase, application and link follow Plivo's documentation but have not yet been
exercised on a real account: the first real run is the check, which is why the onboarding tool is a dry run unless told otherwise."""

# ruff: noqa: E501

from __future__ import annotations

import re
from collections.abc import Callable

from app.telephony.plivo_api import PlivoApi, PlivoError, digits

_ID = re.compile(r"^[A-Za-z0-9_.-]{4,100}$")


def e164(number: str) -> str:
    return "+" + digits(number)


class PlivoAdmin(PlivoApi):
    def create_subaccount(self, name: str, keep_token: Callable[[str], None]) -> str:
        """Make an enabled subaccount and return its Auth ID. Its Auth Token is handed ONLY to `keep_token` (the caller stores it in Secret Manager); it is not part of what this returns."""
        body = self._send("POST", "Subaccount/", {"name": name[:50], "enabled": True}).json()
        try:
            auth_id = str(body["auth_id"])
        except (KeyError, TypeError):
            raise PlivoError("bad_response") from None
        if not _ID.fullmatch(auth_id):
            raise PlivoError("bad_response")
        try:   # (read in its own step: the id returned above never shares a statement with the token)
            kept = str(body["auth_token"])
        except (KeyError, TypeError):
            raise PlivoError("bad_response") from None
        if not kept:
            raise PlivoError("bad_response")
        keep_token(kept)
        return auth_id

    def compliance_status(self, compliance_id: str) -> str:
        """The status of a compliance application: draft | submitted | accepted | rejected | suspended | expired (Plivo's words)."""
        if not _ID.fullmatch(compliance_id or ""):
            raise PlivoError("rejected")
        body = self._send("GET", f"PhoneNumber/Compliance/{compliance_id}/").json()
        status = str(body.get("status") or (body.get("compliance_application") or {}).get("status") or "").lower() if isinstance(body, dict) else ""
        if status not in ("draft", "submitted", "accepted", "rejected", "suspended", "expired"):
            raise PlivoError("bad_response")
        return status

    def search_numbers(self, *, pattern: str = "", number_type: str = "local", limit: int = 5) -> list[str]:
        """Voice-capable Indian numbers on offer, as +91... (nothing is bought)."""
        query = f"PhoneNumber/?country_iso=IN&type={number_type}&services=voice&limit={int(limit)}" + (f"&pattern={digits(pattern)}" if digits(pattern) else "")
        body = self._send("GET", query).json()
        objects = body.get("objects") if isinstance(body, dict) else None
        return [e164(str(o["number"])) for o in (objects or []) if isinstance(o, dict) and o.get("number")][:limit]

    def buy_number(self, number: str, *, subaccount_id: str, compliance_application_id: str) -> None:
        """Rent `number` into the subaccount, backed by the business's own accepted compliance application. This COSTS MONEY (the monthly rent)."""
        if not _ID.fullmatch(subaccount_id or "") or not _ID.fullmatch(compliance_application_id or ""):
            raise PlivoError("rejected")
        self._send("POST", f"PhoneNumber/{digits(number)}/", {"subaccount": subaccount_id, "compliance_application_id": compliance_application_id})

    def create_application(self, name: str, answer_url: str, hangup_url: str) -> str:
        """An XML Application under THIS object's account (use the subaccount's credentials for the subaccount's own). Returns its id."""
        body = self._send("POST", "Application/", {"app_name": name[:50], "answer_url": answer_url, "answer_method": "POST", "hangup_url": hangup_url, "hangup_method": "POST"}).json()
        app_id = str(body.get("app_id") or "") if isinstance(body, dict) else ""
        if not _ID.fullmatch(app_id):
            raise PlivoError("bad_response")
        return app_id

    def link_number(self, number: str, app_id: str) -> None:
        """Point a rented number at an Application (its Answer URL then rings our server)."""
        if not _ID.fullmatch(app_id or ""):
            raise PlivoError("rejected")
        self._send("POST", f"Number/{digits(number)}/", {"app_id": app_id})

