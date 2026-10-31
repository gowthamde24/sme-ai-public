"""The gate: nothing is dialled and nothing is answered unless every rule here says yes (job phone-calls part 1, owner brief 31 Oct 2026). Pure code: the caller gathers the facts from the database and the settings, this
function decides, and the reason of a refusal is a closed word that is stored on the call row. No clock is read here (`now` is given), no network, no randomness: a test pins each rule.

The order below is the order of the checks; the first refusal wins, so the reason says the first thing to fix. The strictest reading is built in (owner has not had the lawyer's answers yet, docs/pre-pilot-checklist.md):
the AI says it is an AI first, calls only 09:00 to 21:00 India time, respects DND, stops at once on request, records nothing."""

# ruff: noqa: E501

from __future__ import annotations

import re
from collections.abc import Collection
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from app.connectors.phone import normalise

IST = ZoneInfo("Asia/Kolkata")
WINDOW_FROM_MINUTE = 9 * 60    # the regulation's window for promotional calls; applied to every outbound call
WINDOW_TO_MINUTE = 21 * 60

Mode = Literal["off", "sandbox", "live"]
Dnd = Literal["yes", "no", "unknown"]
Purpose = Literal["sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder"]
Approval = Literal["plan", "standing_rule", "task"]

# which purposes are promotional (sales) and which are transactional (about something the person already has with the business). ASSUMPTION until the owner's lawyer answers (job-phone-calls.md, Needs owner 2):
# the stricter class is used whenever in doubt.
PROMOTIONAL: frozenset[str] = frozenset({"sales_followup", "admission_followup"})
TRANSACTIONAL: frozenset[str] = frozenset({"payment_reminder", "visit_reminder", "event_reminder"})

AI_MARK = re.compile(r"\bAI\b|ఏఐ|एआई|ಎಐ|ஏஐ|എഐ")


@dataclass(frozen=True)
class Allowed:
    """The call may go ahead. `promotional` tells the rest of the call (the opening line, the stop rules) which class it is."""

    promotional: bool


@dataclass(frozen=True)
class Refused:
    reason: str   # a closed word; see REASONS


REASONS: tuple[str, ...] = (
    "telephony_off", "live_not_confirmed", "bad_number", "not_on_sandbox_list", "not_approved", "workspace_paused", "billing_blocked", "purpose_not_allowed", "school_rule",
    "outside_window", "outside_hours", "holiday", "weekly_limit", "daily_cap", "minutes_cap", "no_consent", "suppressed", "erased_or_archived", "dnd", "dnd_unknown", "no_ai_disclosure",
    "already_calling", "too_many_calls",
    "inbound_off", "no_such_line", "blocked_caller",
)


@dataclass(frozen=True)
class Settings:
    """The deployment's switches (config)."""

    mode: Mode = "off"
    live_confirmed: bool = False
    sandbox_numbers: frozenset[str] = frozenset()   # +91... forms; the only numbers a sandbox call may ring
    max_concurrent: int = 2


@dataclass(frozen=True)
class Hours:
    days: Collection[int]   # Monday = 1 .. Sunday = 7
    from_minute: int
    to_minute: int


@dataclass(frozen=True)
class OutboundFacts:
    """Everything the gate needs to know about ONE planned outbound call. The caller fills it in from the database; nothing here is a guess."""

    number: str
    purpose: str
    now: datetime
    hours: Hours
    holidays: Collection[str] = field(default_factory=tuple)   # ISO dates the workspace never calls on
    approval: Approval | None = None      # which approved thing this call belongs to (None: nothing approved it)
    approval_valid: bool = False          # the plan's hash still matches / the rule is still on
    workspace_paused: bool = False
    billing_ok: bool = True
    allowed_purposes: Collection[str] = field(default_factory=lambda: tuple(PROMOTIONAL | TRANSACTIONAL))
    is_school: bool = False
    calls_to_contact_this_week: int = 0
    weekly_limit: int = 1
    calls_today: int = 0
    daily_cap: int | None = None
    minutes_today: float = 0.0
    minutes_cap: float | None = None
    can_contact: bool = False             # app.can_contact(contact, 'phone') for this purpose
    suppressed: bool = False              # on the STOP list
    erased_or_archived: bool = False
    dnd: Dnd = "unknown"                  # the lead flag, else the provider's live answer, else unknown
    opening_line: str = ""
    active_calls_to_number: int = 0
    active_calls_total: int = 0


def is_promotional(purpose: str) -> bool:
    """Anything not known to be transactional counts as promotional (the stricter class)."""
    return purpose not in TRANSACTIONAL


def has_ai_disclosure(line: str) -> bool:
    return bool(AI_MARK.search(line))


def check_outbound(settings: Settings, f: OutboundFacts) -> Allowed | Refused:
    if settings.mode == "off":
        return Refused("telephony_off")
    if settings.mode == "live" and not settings.live_confirmed:
        return Refused("live_not_confirmed")
    number = normalise(f.number)
    if number is None:
        return Refused("bad_number")
    if settings.mode == "sandbox" and number not in settings.sandbox_numbers:
        return Refused("not_on_sandbox_list")
    if f.approval is None or not f.approval_valid:
        return Refused("not_approved")
    if f.workspace_paused:
        return Refused("workspace_paused")
    if not f.billing_ok:
        return Refused("billing_blocked")
    if f.is_school and f.purpose in PROMOTIONAL | {"payment_reminder"}:
        return Refused("school_rule")   # a school never makes sales calls and never calls about dues or fees
    if f.purpose not in f.allowed_purposes:
        return Refused("purpose_not_allowed")
    local = f.now.astimezone(IST)
    minute = local.hour * 60 + local.minute
    if not WINDOW_FROM_MINUTE <= minute < WINDOW_TO_MINUTE:
        return Refused("outside_window")
    if local.date().isoformat() in set(f.holidays):
        return Refused("holiday")
    if local.isoweekday() not in set(f.hours.days) or not f.hours.from_minute <= minute < f.hours.to_minute:
        return Refused("outside_hours")
    if f.calls_to_contact_this_week >= f.weekly_limit:
        return Refused("weekly_limit")
    if f.daily_cap is not None and f.calls_today >= f.daily_cap:
        return Refused("daily_cap")
    if f.minutes_cap is not None and f.minutes_today >= f.minutes_cap:
        return Refused("minutes_cap")
    if f.erased_or_archived:
        return Refused("erased_or_archived")
    if f.suppressed:
        return Refused("suppressed")
    if not f.can_contact:
        return Refused("no_consent")
    promotional = is_promotional(f.purpose)
    if f.dnd == "yes":
        return Refused("dnd")   # DND blocks every purpose here; the lawyer may allow transactional calls to a DND number later
    if f.dnd == "unknown" and promotional:
        return Refused("dnd_unknown")
    if not has_ai_disclosure(f.opening_line):
        return Refused("no_ai_disclosure")
    if f.active_calls_to_number > 0:
        return Refused("already_calling")
    if f.active_calls_total >= settings.max_concurrent:
        return Refused("too_many_calls")
    return Allowed(promotional)


@dataclass(frozen=True)
class InboundFacts:
    to_number: str                  # the ExoPhone that was rung
    now: datetime
    line_known: bool = False        # the number belongs to a workspace
    inbound_on: bool = False        # that workspace answers inbound calls
    hours: Hours | None = None      # inside these the assistant talks; outside it only leaves a short message (see InboundDecision)
    blocked_caller: bool = False
    active_calls_total: int = 0


@dataclass(frozen=True)
class InboundDecision:
    talk: bool                      # False: play the short after-hours message and offer a callback, no conversation
    reason: str = ""


def check_inbound(settings: Settings, f: InboundFacts) -> InboundDecision | Refused:
    if settings.mode == "off":
        return Refused("telephony_off")
    if settings.mode == "live" and not settings.live_confirmed:
        return Refused("live_not_confirmed")
    if not f.line_known:
        return Refused("no_such_line")
    if not f.inbound_on:
        return Refused("inbound_off")
    if f.blocked_caller:
        return Refused("blocked_caller")
    if f.active_calls_total >= settings.max_concurrent:
        return Refused("too_many_calls")
    if f.hours is not None:
        local = f.now.astimezone(IST)
        minute = local.hour * 60 + local.minute
        if local.isoweekday() not in set(f.hours.days) or not f.hours.from_minute <= minute < f.hours.to_minute:
            return InboundDecision(False, "outside_hours")
    return InboundDecision(True)
