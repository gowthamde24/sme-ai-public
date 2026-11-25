"""The words a phone call opens with, in ONE place: the live call (app/telephony/inbound_routes.phone_parts) and the job page's `says` (app/jobs/detail.py) both ask this function, so what the page shows is what the caller hears.

Pure: no network, no database. `say_ai` is the RESOLVED "Say 'AI assistant' when greeting" for the job the call belongs to (app/opening/greeting.py: the job's override, else the business setting, else off)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any, Protocol

from app.telephony import persona
from app.telephony import tone as tone_mod


class OutboundLike(Protocol):
    """What the opening needs of a call WE placed (app/telephony/inbound_routes.OutboundCall has all of it)."""

    @property
    def goal(self) -> str | None: ...
    @property
    def opening_line(self) -> str | None: ...
    @property
    def owner_test(self) -> bool: ...
    @property
    def kind(self) -> str: ...
    @property
    def tone(self) -> str: ...


def call_opening(language: str, *, business: str, assistant: str | None, training: dict[str, Any] | None, say_ai: bool, outbound: OutboundLike | None = None, introduction: Any = None, recording_notice: bool = False, monitor_notice: bool = False) -> str:
    """An inbound call (`outbound` None): the standard inbound opening, or the Owner's trained greeting. A call we placed: the Owner's opening (a test call), else the trained greeting, else the standard outbound opening, with or
    without the AI words as `say_ai` says."""
    from app.talk_training.prompt import greeting as trained_greeting
    from app.telephony import plivo_outbound

    if outbound is not None:   # we rang them: no "you rang us" greeting
        owner_line = tone_mod.opener(language, outbound.tone, introduction, say_ai) if outbound.goal and outbound.owner_test else None
        # ONE greeting (owner decision 13 Nov 2026, decided by C1): a call to a customer opens with the Owner's Talk training greeting when there is one
        standard = outbound.opening_line if say_ai else plivo_outbound.opening_for(outbound.kind, language, outbound.tone, None, False)
        placed = persona.opening_line(language, business=business, assistant=assistant, customer=None, owner_line=owner_line or trained_greeting(training, language) or standard, inbound=False, mention_ai=say_ai)
        return persona.with_monitoring_notice(language, placed) if monitor_notice else placed
    said = persona.opening_line(language, business=business, assistant=assistant, customer=None, inbound=True, greeting=trained_greeting(training, language), mention_ai=say_ai)
    said = persona.with_recording_notice(language, said) if recording_notice else said   # only a call a person rang in on says it is recorded (VOICELINK_RECORDING_EXPECTED)
    return persona.with_monitoring_notice(language, said) if monitor_notice else said
