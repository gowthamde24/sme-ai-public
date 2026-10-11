"""API-facing models of the scheduler's settings and the Owner's status card (job AW, ADR 0068). The contract the web is built on: the job AW report.

Times are ISO instants (the screen shows them in Asia/Kolkata). Counts are the India day's. Nothing here carries a phone number, a message, a name or a token. Requests are closed: an unknown
field is a 422."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StrictBool


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SchedulerSettingsIn(_Strict):
    """The whole set at once (the Owner, with a second factor). The worker acts only while the global outbox switch AND the business's automatic sending are on, whatever is set here."""

    # the evening before a visit, from this hour (India time) until 21:00
    reminder_evening_enabled: StrictBool
    reminder_evening_hour: Annotated[int, Field(ge=9, le=20)]
    # some minutes before the visit (never in quiet hours 21:00 to 09:00, never closer than 30 minutes)
    reminder_heads_up_enabled: StrictBool
    reminder_heads_up_minutes: Annotated[int, Field(ge=60, le=480)]
    # a CONFIRMED visit becomes "no show" this many minutes after its slot ended. Off unless switched on.
    no_show_enabled: StrictBool
    no_show_after_minutes: Annotated[int, Field(ge=5, le=720)]


class SchedulerSettingsOut(SchedulerSettingsIn):
    # true while the business has never saved its own: these are the defaults (evening 18:00 on, 120 minutes before on, no-show off)
    is_default: bool


class SchedulerTodayOut(_Strict):
    """What the worker did for the business today (India day): counts only."""

    sent: int
    failed: int
    reminders: int
    no_shows: int
    errors: int


class SchedulerStatusOut(_Strict):
    # the global outbox kill switch and the business's own automatic sending; the worker acts only while both are on (`active`)
    platform_switch_on: bool
    auto_send_enabled: bool
    active: bool
    # true while the worker has been heard from within three of its intervals
    worker_running: bool
    # the worker's last tick (for the whole installation) and when the next is due; null when it was never heard from, `next_run_at` also null while it is not running
    last_run_at: datetime | None
    next_run_at: datetime | None
    interval_seconds: int | None
    # the last time the worker DID something for this business (a message, a reminder, a no-show, an error)
    last_activity_at: datetime | None
    today: SchedulerTodayOut
