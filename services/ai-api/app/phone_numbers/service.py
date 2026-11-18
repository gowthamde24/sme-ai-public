"""A business takes and gives back its own phone number (planner, 18 Nov 2026; blocker 3). The Owner (second factor) chooses one of the numbers on offer; it is rented through ONE adapter
(app/phone_numbers/provider.py) for the business's own sub-account and accepted KYC, recorded as the business's line (inbound OFF until the first test call has passed), and given back when the Owner
asks or when the workspace is closed. Nothing is rented unless the business's own compliance application is `accepted`; one line per business."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

from app.errors import ApiError
from app.phone_numbers.models import AvailableNumbersOut, LineOut
from app.phone_numbers.provider import Line, NumberProvider
from app.telephony.plivo_api import PlivoError

logger = logging.getLogger("app.phone_numbers")
UNAVAILABLE = ApiError(502, "number_provider_unavailable", "The phone provider did not answer. Try again in a minute.")


class NumbersRepository(Protocol):
    def line(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def kyc(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def attach(self, token: str, tenant_id: uuid.UUID, number: str, account_ref: str | None, external_ref: str | None) -> dict[str, Any]: ...
    def detach(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]: ...
    def closed_lines(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def removed(self, token: str, number: str) -> bool: ...


class PhoneNumbersService:
    def __init__(self, repository: NumbersRepository, provider: NumberProvider, public_base: str) -> None:
        self._repo, self._provider, self._base = repository, provider, public_base

    def available(self, pattern: str) -> AvailableNumbersOut:
        try:
            return AvailableNumbersOut(live=self._provider.live, items=self._provider.search(pattern, 5))
        except PlivoError as exc:
            logger.warning("number search failed: %s", exc.reason)
            raise UNAVAILABLE from exc

    def line(self, token: str, tenant_id: uuid.UUID) -> LineOut:
        row = self._repo.line(token, tenant_id)
        if not row:
            return LineOut(state="none", live=self._provider.live)
        return LineOut(state="ready", number=str(row["number"]), inbound_on=bool(row.get("inbound_on")), live=self._provider.live)

    def take(self, token: str, tenant_id: uuid.UUID, number: str) -> LineOut:
        if self._repo.line(token, tenant_id):
            raise ApiError(409, "already_has_number", "This business already has a phone number. Give it back first.")
        kyc = self._repo.kyc(token, tenant_id)
        if kyc.get("status") != "accepted" or not kyc.get("compliance_id"):
            raise ApiError(409, "phone_kyc_required", "The phone provider has not accepted your business registration yet. A number can be taken once it has.")
        try:
            line = self._provider.assign(tenant_id=tenant_id, number=number, subaccount_id=kyc.get("plivo_subaccount"), compliance_id=str(kyc["compliance_id"]), public_base=self._base)
        except PlivoError as exc:
            logger.warning("number not rented: %s", exc.reason)
            if exc.reason == "kyc":
                raise ApiError(409, "phone_kyc_required", "The phone provider has not accepted your business registration. A number can be taken once it has.") from exc
            if exc.reason == "rejected" and exc.status in (400, 404, 409):
                raise ApiError(409, "number_not_available", "That number is not available any more. Choose another.") from exc
            raise UNAVAILABLE from exc
        try:
            self._repo.attach(token, tenant_id, line.number, line.account_ref, line.external_ref)
        except Exception:
            try:
                self._provider.release(line)   # rented but not recorded: give it back rather than pay for a number nobody holds
            except PlivoError as exc:
                logger.error("a rented number could not be recorded and could not be given back: %s (it needs a person)", exc.reason)
            raise
        return LineOut(state="ready", number=line.number, inbound_on=False, live=self._provider.live)

    def give_back(self, token: str, tenant_id: uuid.UUID) -> LineOut:
        row = self._repo.line(token, tenant_id)
        if not row:
            return LineOut(state="none", live=self._provider.live)
        try:
            self._provider.release(Line(str(row["number"]), row.get("account_ref"), row.get("external_ref")))   # the provider FIRST: a number we cannot release stays on the record
        except PlivoError as exc:
            logger.warning("number not released: %s", exc.reason)
            raise UNAVAILABLE from exc
        self._repo.detach(token, tenant_id, str(row["number"]))
        return LineOut(state="none", live=self._provider.live)

    def release_closed(self, scheduler_token: str, limit: int = 5) -> dict[str, int]:
        """The phone server's job: the lines of CLOSED (archived) workspaces are given back at the provider, then their rows are removed. A line the provider cannot release now is left for the next run."""
        released = failed = 0
        for row in self._repo.closed_lines(scheduler_token, limit):
            try:
                self._provider.release(Line(str(row["number"]), row.get("account_ref"), row.get("external_ref")))
            except PlivoError as exc:
                logger.warning("closed line not released: %s", exc.reason)
                failed += 1
                continue
            self._repo.removed(scheduler_token, str(row["number"]))
            released += 1
        return {"released": released, "failed": failed}
