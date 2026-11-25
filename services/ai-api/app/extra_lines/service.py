"""Extra lines (26 Nov 2026; switch EXTRA_LINES, off): what an Owner may do about "calls at once", joined in the right order. The rules and the money are the database's (migration 20261231992500: the
cap, the Owner-only check, the wallet charge, the monthly renewal and its grace days); this module only carries them, buys the channel at the phone company through the port, and says every refusal as a closed word.

  add     the wallet is charged and the line recorded (one database call), THEN the channel is bought. A channel that could not be bought gives the money back at once (the line never counted).
  cancel  the line works to the end of the paid month; `keep` takes the cancel back.
  renew   the worker's monthly pass: renew what is due, give grace, pause, end; retry a channel that was paid but not bought; give back the channel of an ended line.

A price, an id or an account detail is never put in a log line."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from typing import Any, Protocol

from app.extra_lines.channel import ChannelProvider, ChannelRefused
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

log = logging.getLogger("app.extra_lines")


class LinesBlocked(RepositoryError):
    """The line cannot be added or changed now. `reason` is a closed word: paused, at_limit, no_number, not_enough_credits, not_found, unavailable."""

    reason = "unavailable"

    def __init__(self, reason: str | None = None) -> None:
        super().__init__(reason or self.reason)
        if reason:
            self.reason = reason


class _Paused(LinesBlocked):
    reason = "paused"


class _AtLimit(LinesBlocked):
    reason = "at_limit"


class _NoNumber(LinesBlocked):
    reason = "no_number"


class _NotEnough(LinesBlocked):
    reason = "not_enough_credits"


class _NotFound(LinesBlocked):
    reason = "not_found"


class LinesRepository(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def buy(self, token: str, tenant_id: uuid.UUID, key: str) -> dict[str, Any]: ...
    def channel_result(self, token: str, line_id: uuid.UUID, ok: bool, ref: str | None) -> dict[str, Any]: ...
    def cancel(self, token: str, tenant_id: uuid.UUID, line_id: uuid.UUID, cancel: bool) -> dict[str, Any]: ...
    def renew(self, token: str, limit: int) -> dict[str, Any]: ...
    def released(self, token: str, line_id: uuid.UUID) -> None: ...


class PostgrestLinesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM954": _Paused, "SM955": _AtLimit, "SM956": _NoNumber, "SM957": _NotEnough, "SM958": _NotFound}, client=client)

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "extra_lines_get", {"p_tenant_id": str(tenant_id)})

    def buy(self, token: str, tenant_id: uuid.UUID, key: str) -> dict[str, Any]:
        return self._rpc.object(token, "extra_line_buy", {"p_tenant_id": str(tenant_id), "p_key": key})

    def channel_result(self, token: str, line_id: uuid.UUID, ok: bool, ref: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "extra_line_channel_result", {"p_id": str(line_id), "p_ok": ok, "p_ref": ref})

    def cancel(self, token: str, tenant_id: uuid.UUID, line_id: uuid.UUID, cancel: bool) -> dict[str, Any]:
        return self._rpc.object(token, "extra_line_cancel", {"p_tenant_id": str(tenant_id), "p_id": str(line_id), "p_cancel": cancel})

    def renew(self, token: str, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "extra_lines_renew", {"p_limit": limit})

    def released(self, token: str, line_id: uuid.UUID) -> None:
        self._rpc.call(token, "extra_line_released", {"p_id": str(line_id)})


def _ids(rows: Any) -> list[tuple[uuid.UUID, uuid.UUID]]:
    out: list[tuple[uuid.UUID, uuid.UUID]] = []
    for row in rows if isinstance(rows, list) else []:
        try:
            out.append((uuid.UUID(str(row["id"])), uuid.UUID(str(row["tenant_id"]))))
        except (KeyError, TypeError, ValueError):
            continue
    return out


class ExtraLinesService:
    def __init__(self, repo: LinesRepository, channels: ChannelProvider, *, alert: Callable[[str], None] | None = None, forget: Callable[[uuid.UUID], None] | None = None, is_production: bool = False) -> None:
        self._repo, self._channels, self._alert, self._forget = repo, channels, alert, forget   # forget: the call gate's memory of the workspace's lines (a change applies at once on this instance)
        self._tell_by_hand = is_production and not channels.live   # a line was paid but no channel was really bought: the team buys it by hand
        self._told: set[uuid.UUID] = set()   # the ended lines the team was told about (once each, not on every pass)

    def overview(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._repo.get(token, tenant_id)

    def add(self, token: str, tenant_id: uuid.UUID, key: str) -> dict[str, Any]:
        row = self._repo.buy(token, tenant_id, key)   # every rule and the wallet charge, atomically, or a closed refusal
        if row.get("channel_state") == "pending":
            row = self._buy_channel(token, tenant_id, row)
        self._changed(tenant_id)
        return row

    def _buy_channel(self, token: str, tenant_id: uuid.UUID, row: dict[str, Any]) -> dict[str, Any]:
        line_id = uuid.UUID(str(row["id"]))
        try:
            order = self._channels.buy(tenant_id=tenant_id, line_id=line_id, token=token)
        except ChannelRefused as refused:
            log.warning("extra_line channel_not_bought reason=%s", refused.reason)
            self._repo.channel_result(token, line_id, False, None)   # the money goes back, the line never counted
            if refused.reason in ("vendor_unavailable", "not_built", "no_account"):
                self._tell(f"Extra lines: a channel could not be bought ({refused.reason}); the customer was given the money back.")
            raise LinesBlocked("unavailable") from None
        done = self._repo.channel_result(token, line_id, True, order.ref)
        if self._tell_by_hand:
            self._tell("Extra lines: a line was bought and paid, but no channel was bought at the phone company (the switch is off). Buy one by hand in the VoiceLink portal.")
        return done

    def cancel(self, token: str, tenant_id: uuid.UUID, line_id: uuid.UUID, cancel: bool = True) -> dict[str, Any]:
        row = self._repo.cancel(token, tenant_id, line_id, cancel)
        self._changed(tenant_id)
        return row

    def renew(self, token: str, limit: int = 50) -> int:
        """The worker's pass. Returns how many lines it renewed, paused or ended (for the log)."""
        out = self._repo.renew(token, limit)
        for line_id, tenant_id in _ids(out.get("pending")):   # paid, but the API stopped before the channel was bought: buy it now, or give the money back when it cannot be bought
            try:
                order = self._channels.buy(tenant_id=tenant_id, line_id=line_id, token=token)
            except ChannelRefused as refused:
                if refused.reason != "vendor_unavailable":
                    self._repo.channel_result(token, line_id, False, None)
                continue
            self._repo.channel_result(token, line_id, True, order.ref)
            self._changed(tenant_id)
        for line_id, tenant_id in _ids(out.get("release")):   # an ended line: give its channel back (a refusal leaves it in the list for the next pass and for the team)
            try:
                self._channels.release(tenant_id=tenant_id, line_id=line_id, ref=None, token=token)
            except ChannelRefused as refused:
                if refused.reason == "not_built" and line_id not in self._told and len(self._told) < 1000:
                    self._told.add(line_id)
                    self._tell("Extra lines: a line ended and its channel is to be given back by hand in the VoiceLink portal.")
                continue
            self._repo.released(token, line_id)
        total = sum(int(out.get(k) or 0) for k in ("renewed", "grace", "paused", "ended"))
        if total:
            log.info("extra_lines renewals renewed=%s grace=%s paused=%s ended=%s", out.get("renewed"), out.get("grace"), out.get("paused"), out.get("ended"))
        return total

    def _changed(self, tenant_id: uuid.UUID) -> None:
        if self._forget is not None:
            self._forget(tenant_id)

    def _tell(self, detail: str) -> None:
        if self._alert is not None:
            try:
                self._alert(detail)
            except Exception as exc:  # noqa: BLE001 - only the class is logged; a failed alert never spoils the answer
                log.warning("extra_lines alert_failed %s", exc.__class__.__name__)
