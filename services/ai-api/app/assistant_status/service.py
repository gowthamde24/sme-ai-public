# ruff: noqa: E501
"""The status of the Owner's assistant ("My assistant": Not live / In training / Live) and the Go live / Pause button (owner decision 13 Nov 2026). Only a business name of its own plus a connected phone number are
required to go live; training is optional and every new assistant starts with working defaults. The database gives the FACTS; the state and the lists are made here."""

from __future__ import annotations

import uuid
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class NotReadyError(RepositoryError):
    """SM991: going live needs a business name and a connected phone number."""


class HeldBySupportError(RepositoryError):
    """SM992: Stack19 support paused this assistant; only support resumes it."""


class StatusRepository(Protocol):
    def facts(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def go_live(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def pause(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def knows(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestStatusRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: Any = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM991": NotReadyError, "SM992": HeldBySupportError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def facts(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_status_get", {"p_tenant_id": str(tenant_id)})

    def go_live(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_go_live", {"p_tenant_id": str(tenant_id)})

    def pause(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "assistant_pause", {"p_tenant_id": str(tenant_id)})

    def knows(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "phone_assistant_knows", {"p_tenant_id": str(tenant_id)})


class AssistantStatusOut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # not_live: it never went live and nothing was trained; in_training: not live, but a voice or rules were saved; live: it answers customers;
    # paused: it was switched off (by the Owner's Pause, or by Stack19 support: see held_by_support) and a switch row exists, so it is not "never started" (28 Nov 2026)
    state: Literal["not_live", "in_training", "live", "paused"]
    # true when nothing required is missing (a name of its own and a connected phone number)
    can_go_live: bool
    # what is missing to go live: "business_name", "phone_number"
    missing: list[Literal["business_name", "phone_number"]]
    # what still runs on the standard setting: "voice", "rules"
    using_defaults: list[Literal["voice", "rules"]]
    # true while Stack19 support has paused the assistant (14 Nov): the Go live button waits for support to resume it
    held_by_support: bool = False


def status_of(facts: dict[str, Any]) -> AssistantStatusOut:
    missing: list[Literal["business_name", "phone_number"]] = []
    if not facts.get("business_name_ok"):
        missing.append("business_name")
    if not facts.get("phone_number_ok"):
        missing.append("phone_number")
    defaults: list[Literal["voice", "rules"]] = []
    if not facts.get("voice_saved"):
        defaults.append("voice")
    if not facts.get("rules_saved"):
        defaults.append("rules")
    live = facts.get("live") is True and not missing   # a live assistant whose name or number has gone is not live
    trained = bool(facts.get("voice_saved") or facts.get("rules_saved"))
    paused = not live and facts.get("ever_changed") is True and facts.get("live") is False
    state: Literal["not_live", "in_training", "live", "paused"] = "live" if live else ("paused" if paused else ("in_training" if trained else "not_live"))
    return AssistantStatusOut(state=state, can_go_live=not missing, missing=missing, using_defaults=defaults, held_by_support=facts.get("staff_hold") is True)


class PhoneKnowsOut(BaseModel):
    """What the PHONE assistant has to answer with (28 Nov 2026): counts, so the owner sees before a real call whether it can answer prices and products or will only say the team will call back."""

    model_config = ConfigDict(extra="forbid")

    price_rows: int
    catalogue_items: int
    faq_answers: int
    notes_lines: int
    has_hours: bool
    # what is missing, in the order that helps most: "price_list", "catalogue", "answers" (no FAQ answer and no note)
    missing: list[Literal["price_list", "catalogue", "answers"]]
    ready: bool   # nothing missing: calls can be answered from the business's own facts
    message: str | None = None   # one plain sentence for the first thing to add; None when ready


_ADD = {"price_list": "Add your prices so the assistant can answer them: a price on each item, or a price list.", "catalogue": "Add your catalogue so the assistant can answer what you sell.", "answers": "Add a few answers to questions customers ask, or notes about your business, so the assistant can answer them."}


def knows_of(raw: dict[str, Any]) -> PhoneKnowsOut:
    def n(key: str) -> int:
        value = raw.get(key)
        return int(value) if isinstance(value, int | float) and not isinstance(value, bool) else 0

    missing: list[Literal["price_list", "catalogue", "answers"]] = []
    if n("price_rows") == 0:
        missing.append("price_list")
    if n("catalogue_items") == 0:
        missing.append("catalogue")
    if n("faq_answers") == 0 and n("notes_lines") == 0:
        missing.append("answers")
    return PhoneKnowsOut(price_rows=n("price_rows"), catalogue_items=n("catalogue_items"), faq_answers=n("faq_answers"), notes_lines=n("notes_lines"), has_hours=raw.get("has_hours") is True, missing=missing, ready=not missing, message=_ADD[missing[0]] if missing else None)


class AssistantStatusService:
    def __init__(self, repository: StatusRepository) -> None:
        self._repo = repository

    def status(self, token: str, tenant_id: uuid.UUID) -> AssistantStatusOut:
        return status_of(self._repo.facts(token, tenant_id))

    def go_live(self, token: str, tenant_id: uuid.UUID) -> AssistantStatusOut:
        return status_of(self._repo.go_live(token, tenant_id))

    def pause(self, token: str, tenant_id: uuid.UUID) -> AssistantStatusOut:
        return status_of(self._repo.pause(token, tenant_id))

    def knows(self, token: str, tenant_id: uuid.UUID) -> PhoneKnowsOut:
        return knows_of(self._repo.knows(token, tenant_id))
