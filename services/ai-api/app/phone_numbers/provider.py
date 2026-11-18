"""The ONE adapter for a business's phone number (planner, 18 Nov 2026): the per-business number model (a Plivo sub-account per business and its own accepted compliance application, which is what the
in-app KYC builds) sits behind this interface, so Plivo's answer on how a reseller holds numbers changes one class, not the routes, the service or the database.

  search(pattern, limit)  the numbers on offer (nothing is rented)
  assign(...)             rent the number for the business, with its own Application, and link them; returns the line (the sub-account id and the vault key of its token). Costs money at the provider.
  release(line)           give the number back (unlink, unrent, delete the Application); idempotent: a number the provider no longer knows counts as released

`FakeNumbers` (staging and tests) rents nothing and costs nothing. `PlivoSubaccountNumbers` speaks Plivo's documented REST API (through PlivoAdmin); it has been exercised only against a fake that follows the
documentation (tests/fake_plivo_numbers.py), never on a real account: the first real run is the check."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from app.telephony.plivo_admin import PlivoAdmin, e164
from app.telephony.plivo_api import PlivoError, digits
from app.telephony.plivo_onboarding import vault_key


@dataclass(frozen=True)
class Line:
    number: str                  # +91...
    account_ref: str | None      # the NAME of the secret that holds the sub-account's token (None: the main account)
    external_ref: str | None     # the sub-account's Auth ID (None: the main account)


class NumberProvider(Protocol):
    live: bool

    def search(self, pattern: str, limit: int) -> list[str]: ...
    def assign(self, *, tenant_id: uuid.UUID, number: str, subaccount_id: str | None, compliance_id: str, public_base: str) -> Line: ...
    def release(self, line: Line, application_ref: str | None = None) -> None: ...


class FakeNumbers:
    """Staging (no provider call, no cost) and tests: made-up Bengaluru 080 numbers, rented and given back in memory."""

    live = False

    def __init__(self) -> None:
        self.rented: dict[str, Line] = {}

    def search(self, pattern: str, limit: int) -> list[str]:
        free = [f"+9180444{n:05d}" for n in range(40100, 40100 + 50) if f"+9180444{n:05d}" not in self.rented and digits(pattern) in f"{n:05d}"]
        return free[: max(1, limit)]

    def assign(self, *, tenant_id: uuid.UUID, number: str, subaccount_id: str | None, compliance_id: str, public_base: str) -> Line:
        if number in self.rented:
            raise PlivoError("rejected")
        line = Line(number, vault_key(tenant_id), subaccount_id)
        self.rented[number] = line
        return line

    def release(self, line: Line, application_ref: str | None = None) -> None:
        self.rented.pop(line.number, None)


class PlivoSubaccountNumbers:
    """Plivo with ONE sub-account per business (its own accepted compliance application). The main account's credentials rent and release; the sub-account's own (its token, read from the vault by `token_of`)
    make its Application. `main` is a PlivoAdmin on the main account; `sub_admin(auth_id, token)` makes one on a sub-account."""

    live = True

    def __init__(self, main: PlivoAdmin, sub_admin: Callable[[str, str], PlivoAdmin], token_of: Callable[[str], str | None]) -> None:
        self._main, self._sub_admin, self._token_of = main, sub_admin, token_of

    def search(self, pattern: str, limit: int) -> list[str]:
        return self._main.search_numbers(pattern=pattern, number_type="fixed", limit=limit)

    def assign(self, *, tenant_id: uuid.UUID, number: str, subaccount_id: str | None, compliance_id: str, public_base: str) -> Line:
        if not subaccount_id:
            raise PlivoError("rejected")   # no sub-account: the business has not filed its KYC here
        if self._main.compliance_status(compliance_id) != "accepted":
            raise PlivoError("rejected")
        token = self._token_of(vault_key(tenant_id))
        if not token:
            raise PlivoError("unauthorized")
        self._main.buy_number(number, subaccount_id=subaccount_id, compliance_application_id=compliance_id)
        sub = self._sub_admin(subaccount_id, token)
        base = public_base.rstrip("/")
        app_id = sub.create_application(f"s19-{str(tenant_id)[:8]}", f"{base}/v1/telephony/plivo/answer", f"{base}/v1/telephony/plivo/hangup")
        sub.link_number(number, app_id)
        return Line(e164(number), vault_key(tenant_id), subaccount_id)

    def release(self, line: Line, application_ref: str | None = None) -> None:
        # unrent first (Plivo: DELETE Number/<number>/ on the account that holds it); an Application left behind costs nothing
        self._main.release_number(line.number)
