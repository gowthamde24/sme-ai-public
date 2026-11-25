"""The settings catalogue of the jobs (jobs contract 1.0 sections 2, 3 and 14; docs/contracts/jobs-detail.md): server-side DATA per kind. One table says, for every kind, which settings its page shows (key, type, the closed
`options`, `main` or `more`) and the two functions that read and write that setting THROUGH TODAY'S SERVICE LAYER (the outreach rules and policy, the assistant's hours, the visit settings, the follow-up policy, the offer
campaigns, the Lead Finder settings, the Talk training document). A job owns no rows: the old screens, the old routes and the assistant see exactly what the job page sees, and a new choice is a new row here, not a web change.

The rules every setting follows:
  * a value outside `options` is `422 setting_invalid` (with `fields`), checked BEFORE anything is written; a toggle is a boolean (the strings "on" / "off" are accepted from the web and read as true / false);
  * a read that cannot be done (the caller's role, a subsystem that is not built in this process, a value the options have no word for) gives `null`, never an error: the page still opens;
  * a write goes through the same function, with the same role and second-factor rules, as the old screen: the database decides who may (Owner + second factor for a standing rule, the follow-up policy and the Talk training
    document; Owner or Admin for the visit hours, the Lead Finder and the offer's cap);
  * a setting that needs something that does not exist yet (a rule nobody approved, a follow-up policy nobody set, an offer nobody drafted) is `409 job_not_set_up`; it never creates an approval;
  * `main` holds at most four settings; the rest is `more`."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from pydantic import ValidationError

from app.errors import ApiError

logger = logging.getLogger("app.jobs")
MAX_MAIN = 4
GREETING_OPTIONS = ("business", "on", "off")
HOURS_HALF = tuple(f"{h:02d}:{m:02d}" for h in range(6, 24) for m in (0, 30))          # a shop's opening and closing, on the half hour
HOURS_CALLING = tuple(f"{h:02d}:{m:02d}" for h in range(10, 22) for m in (0, 30) if (h, m) <= (21, 0))   # the assistant's calling hours: 10:00 to 21:00
IST = timezone(timedelta(hours=5, minutes=30))
LADDER_DEFAULT: tuple[dict[str, int], ...] = ({"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 600})


def not_set_up() -> ApiError:
    return ApiError(409, "job_not_set_up", "There is nothing to change here yet. Set the job up first.")


def locked() -> ApiError:
    return ApiError(409, "job_locked", "This was approved or set up in another way, so it cannot be changed here.")


def invalid(key: str) -> ApiError:
    return ApiError(422, "setting_invalid", "That choice is not one of the options.", extra={"fields": [key]})


@dataclass
class Env:
    """What a setting's read and write get: the workspace's runtime and the caller. `memo` keeps a read for the length of one request (a write clears it)."""

    runtime: Any
    ctx: Any   # the TenantContext of the caller
    memo: dict[str, Any] = field(default_factory=dict)

    @property
    def token(self) -> str:
        return str(self.ctx.principal.token)

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.ctx.tenant.id  # type: ignore[no-any-return]

    def once(self, key: str, make: Callable[[], Any]) -> Any:
        if key not in self.memo:
            self.memo[key] = make()
        return self.memo[key]


@dataclass(frozen=True)
class Spec:
    key: str
    type: Literal["choice", "toggle"]
    area: Literal["main", "more"]
    read: Callable[[Env], Any]
    write: Callable[[Env, Any], None]
    options: tuple[str, ...] = ()


# ------------------------------------------------------------------------------------------------------------------ minutes in a day <-> "HH:MM"
def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def minute_of(clock: str) -> int:
    return int(clock[:2]) * 60 + int(clock[3:5])


def _word(value: Any, options: tuple[str, ...]) -> str | None:
    return value if isinstance(value, str) and value in options else None


# ------------------------------------------------------------------------------------------------------------------ the greeting override (every job that speaks): the Talk training document
def _talk_row(env: Env) -> Any:
    return env.once("talk", lambda: env.runtime.talk_training.get(env.token, env.tenant_id))


def say_ai_override(doc: Any, kind: str) -> str:
    """`business` (follow the business setting), `on` or `off`: what the job's own override says (docs/contracts/greeting-disclosure.md)."""
    from app.opening import greeting

    return greeting.job_word(doc if isinstance(doc, dict) else None, kind) or "business"


def _say_ai_read(kind: str) -> Callable[[Env], Any]:
    def read(env: Env) -> Any:
        row = _talk_row(env)
        return say_ai_override(row.get("doc") if isinstance(row, dict) else None, kind)

    return read


def _say_ai_write(kind: str) -> Callable[[Env, Any], None]:
    def write(env: Env, value: Any) -> None:
        # the same read the "how I speak" screen makes (the saved document, else the business type's defaults)
        from app.how_speaks.routes import _row_and_training
        from app.talk_training.models import TalkTraining
        from app.talk_training.routes import _repo

        _, training = _row_and_training(env.runtime, env.ctx)
        doc = training.model_dump(mode="json")
        by_job = {k: v for k, v in dict(doc.get("say_ai_by_job") or {}).items() if k != kind}
        if value != "business":
            by_job[kind] = value
        doc["say_ai_by_job"] = by_job
        _repo(env.runtime).save(env.token, env.tenant_id, TalkTraining.model_validate(doc).model_dump(mode="json"))

    return write


def _say_ai(kind: str) -> Spec:
    return Spec("say_ai_when_greeting", "choice", "more", _say_ai_read(kind), _say_ai_write(kind), GREETING_OPTIONS)


# ------------------------------------------------------------------------------------------------------------------ speed_to_lead: the standing rules, their policy and the assistant's hours
def _rules(env: Env) -> list[Any]:
    return list(env.once("rules", lambda: list(env.runtime.outreach.rules(env.token, env.tenant_id))))


def _same(values: list[Any]) -> Any:
    return values[0] if values and all(v == values[0] for v in values) else None


def _save_rules(env: Env, **changes: Any) -> None:
    """Every standing rule of the workspace, saved again with one thing changed (the owner's approval of each is renewed by the database: Owner and second factor). A rule that is on stays on; one that is paused stays paused."""
    from app.outreach import models as m

    rules = _rules(env)
    if not rules:
        raise not_set_up()
    bodies: list[Any] = []
    for r in rules:   # build every body first: nothing is written when one of them cannot be
        try:
            bodies.append(m.RuleIn(rule_id=r.id, source=r.source, action=r.action, within_minutes=changes.get("within_minutes", r.within_minutes), goal=r.goal, channel=changes.get("channel", r.channel),
                                   language=changes.get("language", r.language), questions=list(r.questions), wa_first_template=r.wa_first_template, wa_missed_template=r.wa_missed_template,
                                   max_calls_per_day=r.max_calls_per_day, max_total_minutes=r.max_total_minutes))
        except ValidationError:
            raise locked() from None
    for body in bodies:
        env.runtime.outreach.rule_save(env.token, env.tenant_id, body)
    env.memo.pop("rules", None)


WHEN_MINUTES = {"right_away": 0, "after_10_min": 10}
LANGUAGES = ("auto", "en", "te", "hi", "kn", "ta", "ml", "mr")


def _when_read(env: Env) -> Any:
    minutes = _same([r.within_minutes for r in _rules(env)])
    return next((word for word, n in WHEN_MINUTES.items() if n == minutes), None)


def _when_write(env: Env, value: Any) -> None:
    _save_rules(env, within_minutes=WHEN_MINUTES[value])


def _rule_language_read(env: Env) -> Any:
    return _word(_same([r.language for r in _rules(env)]), LANGUAGES)


def _rule_language_write(env: Env, value: Any) -> None:
    _save_rules(env, language=value)


def _thank_you_read(env: Env) -> Any:
    rules = _rules(env)
    return bool(rules) and all(r.channel == "both" for r in rules)


def _thank_you_write(env: Env, value: Any) -> None:
    _save_rules(env, channel="both" if value else "call")


def _policy(env: Env) -> Any:
    return env.once("policy", lambda: env.runtime.outreach.policy(env.token, env.tenant_id))


def _tries_read(env: Env) -> Any:
    n = len(_policy(env).retry_steps)
    return f"tries_{n}" if n in (1, 2, 3) else None


def _tries_write(env: Env, value: Any) -> None:
    from app.outreach import models as m

    n = int(str(value).rsplit("_", 1)[1])
    now = [dict(s) for s in _policy(env).retry_steps]
    steps = (now + [dict(s) for s in LADDER_DEFAULT[len(now):]])[:n]   # the owner's own steps first; the platform's ladder only fills the gap
    env.runtime.outreach.policy_save(env.token, env.tenant_id, m.PolicyIn.model_validate({"retry_steps": steps}))
    env.memo.pop("policy", None)


def _assistant(env: Env) -> Any:
    return env.once("assistant", lambda: env.runtime.assistant_settings.get(env.token, env.tenant_id))


def _calling_read(field_name: str) -> Callable[[Env], Any]:
    def read(env: Env) -> Any:
        return _word(hhmm(getattr(_assistant(env).settings, field_name)), HOURS_CALLING)

    return read


def _calling_write(field_name: str) -> Callable[[Env, Any], None]:
    def write(env: Env, value: Any) -> None:
        from app.assistant_settings.models import AssistantSettings

        got = _assistant(env)
        if not got.saved:   # the assistant has no name of its own yet: Settings > AI assistant sets it up first
            raise not_set_up()
        doc = got.settings.model_dump()
        doc[field_name] = minute_of(value)
        try:
            body = AssistantSettings.model_validate(doc)
        except ValidationError:
            raise invalid("from_hour" if field_name == "call_from_minute" else "to_hour") from None
        env.runtime.assistant_settings.save(env.token, env.tenant_id, body)
        env.memo.pop("assistant", None)

    return write


# ------------------------------------------------------------------------------------------------------------------ followups: the cadence policy (a new version each time it changes)
NUDGES = ("nudges_1", "nudges_2", "nudges_3")
GAPS = ("days_2", "days_3", "days_5")


def _fpolicy(env: Env) -> dict[str, Any] | None:
    rows = env.once("fpolicy", lambda: env.runtime.followups.list_policies(env.token, env.tenant_id, limit=1))
    return dict(rows[0]) if rows else None


def _nudges_read(env: Env) -> Any:
    row = _fpolicy(env)
    return _word(f"nudges_{int(row['max_touches']) - 1}", NUDGES) if row else None


def _gap_read(env: Env) -> Any:
    row = _fpolicy(env)
    gaps = [int(g) for g in row["gap_days"]] if row else []
    return _word(f"days_{gaps[0]}", GAPS) if gaps and all(g == gaps[0] for g in gaps) else None


def _save_policy(env: Env, *, nudges: int | None = None, gap: int | None = None) -> None:
    """A new version of the follow-up policy (the old one stays as history; the database takes the latest by date and number): Owner and second factor, like the old screen."""
    from app.followups import service as followups_service
    from app.followups.models import CreatePolicyIn

    row = _fpolicy(env)
    if row is None:
        raise not_set_up()
    gaps = [int(g) for g in row["gap_days"]]
    if nudges is not None:
        gaps = (gaps + [gaps[-1] if gaps else 3] * nudges)[:nudges]
    if gap is not None:
        gaps = [gap] * len(gaps)
    try:
        body = CreatePolicyIn.model_validate({
            "id": str(uuid.uuid4()), "effective_from": datetime.now(IST).date().isoformat(), "gap_days": gaps, "max_touches": len(gaps) + 1,
            "quiet_start": str(row["quiet_start"])[:5], "quiet_end": str(row["quiet_end"])[:5], "allowed_weekdays": list(row["allowed_weekdays"]),
            "holidays": [str(h) for h in row["holidays"]], "min_gap_hours": row["min_gap_hours"], "recipient_utc_offset_minutes": row["recipient_utc_offset_minutes"],
        })
    except ValidationError:
        raise locked() from None
    followups_service.create_policy(env.runtime.followups, env.token, env.tenant_id, body)
    env.memo.pop("fpolicy", None)


def _nudges_write(env: Env, value: Any) -> None:
    _save_policy(env, nudges=int(str(value).rsplit("_", 1)[1]))


def _gap_write(env: Env, value: Any) -> None:
    _save_policy(env, gap=int(str(value).rsplit("_", 1)[1]))


# ------------------------------------------------------------------------------------------------------------------ store_visits: the visit settings (the week's hours, the slot, the gap after a booking)
SLOTS = tuple(f"minutes_{n}" for n in (15, 20, 30, 45, 60, 90, 120))
BUFFERS = tuple(f"minutes_{n}" for n in (0, 10, 15, 30))


def _visits(env: Env) -> Any:
    from app.visits import service as visits_service

    return env.once("visits", lambda: visits_service.settings_out(env.runtime.visits.settings_get(env.token, env.tenant_id)))


def _visit_hour_read(which: Literal["open", "close"]) -> Callable[[Env], Any]:
    def read(env: Env) -> Any:
        values = [getattr(h, which) for h in _visits(env).weekly_hours.values() if h is not None]
        return _word(_same(values), HOURS_HALF)

    return read


def _visits_save(env: Env, key: str, **changes: Any) -> None:
    from app.visits import service as visits_service
    from app.visits.models import DayHours, StoreSettingsIn

    cur = _visits(env)
    week: dict[str, Any] = {}
    try:
        for day, hours in cur.weekly_hours.items():
            week[day] = None if hours is None else DayHours(open=changes.get("open", hours.open), close=changes.get("close", hours.close))   # a closed day stays closed
        body = StoreSettingsIn.model_validate({"weekly_hours": week, "closed_dates": list(cur.closed_dates), "slot_minutes": changes.get("slot_minutes", cur.slot_minutes), "max_parallel": cur.max_parallel,
                                               "buffer_minutes": changes.get("buffer_minutes", cur.buffer_minutes)})
    except ValidationError:
        raise invalid(key) from None
    env.runtime.visits.settings_set(env.token, env.tenant_id, visits_service.settings_args(body))
    env.memo.pop("visits", None)


def _visit_hour_write(which: Literal["open", "close"], key: str) -> Callable[[Env, Any], None]:
    def write(env: Env, value: Any) -> None:
        _visits_save(env, key, **{which: value})

    return write


def _slot_read(env: Env) -> Any:
    return _word(f"minutes_{_visits(env).slot_minutes}", SLOTS)


def _slot_write(env: Env, value: Any) -> None:
    _visits_save(env, "slot_minutes", slot_minutes=int(str(value).rsplit("_", 1)[1]))


def _buffer_read(env: Env) -> Any:
    return _word(f"minutes_{_visits(env).buffer_minutes}", BUFFERS)


def _buffer_write(env: Env, value: Any) -> None:
    _visits_save(env, "buffer_minutes", buffer_minutes=int(str(value).rsplit("_", 1)[1]))


# ------------------------------------------------------------------------------------------------------------------ offers: the offer campaigns
CAPS = ("cap_1", "cap_2", "cap_3")


def _offers(env: Env) -> list[dict[str, Any]]:
    rows = env.once("offers", lambda: env.runtime.campaigns.list_campaigns(env.token, env.tenant_id, None, 50, None))
    return [r for r in rows if r.get("kind") == "offer" and r.get("status") not in ("done", "cancelled")]


def _cap_read(env: Env) -> Any:
    live = _offers(env)
    return _word(f"cap_{live[0].get('weekly_cap')}", CAPS) if live else None


def _cap_write(env: Env, value: Any) -> None:
    """The cap of an offer that is still a draft. One that was approved is the owner's approval of THAT text, list and cap: changing it sends it back to draft, so it is changed on the campaign's own screen, not here."""
    live = _offers(env)
    if not live:
        raise not_set_up()
    if any(r.get("status") != "draft" for r in live):
        raise locked()
    for r in live:
        env.runtime.campaigns.offer_set(env.token, env.tenant_id, uuid.UUID(str(r["id"])), str(r.get("offer_label") or ""), int(str(value).rsplit("_", 1)[1]))
    env.memo.pop("offers", None)


# ------------------------------------------------------------------------------------------------------------------ researcher: the Lead Finder settings
RESULTS = ("results_5", "results_10", "results_20")
FIT_BARS = ("fit_60", "fit_70", "fit_80", "fit_90")


def _finder(env: Env) -> Any:
    return env.once("finder", lambda: env.runtime.lead_finder.settings(env.token, env.tenant_id))


def _results_read(env: Env) -> Any:
    return _word(f"results_{_finder(env).results_per_search}", RESULTS)


def _fit_read(env: Env) -> Any:
    return _word(f"fit_{_finder(env).fit_bar}", FIT_BARS)


def _finder_write(field_name: str) -> Callable[[Env, Any], None]:
    def write(env: Env, value: Any) -> None:
        from app.lead_finder.models import SettingsIn

        env.runtime.lead_finder.set_settings(env.token, env.tenant_id, SettingsIn(**{field_name: int(str(value).rsplit("_", 1)[1])}))
        env.memo.pop("finder", None)

    return write


# ------------------------------------------------------------------------------------------------------------------ the table
CATALOGUE: dict[str, tuple[Spec, ...]] = {
    "speed_to_lead": (
        Spec("when", "choice", "main", _when_read, _when_write, tuple(WHEN_MINUTES)),
        Spec("language", "choice", "main", _rule_language_read, _rule_language_write, LANGUAGES),
        Spec("tries", "choice", "main", _tries_read, _tries_write, ("tries_1", "tries_2", "tries_3")),
        Spec("thank_you_whatsapp", "toggle", "main", _thank_you_read, _thank_you_write),
        Spec("from_hour", "choice", "more", _calling_read("call_from_minute"), _calling_write("call_from_minute"), HOURS_CALLING),
        Spec("to_hour", "choice", "more", _calling_read("call_to_minute"), _calling_write("call_to_minute"), HOURS_CALLING),
        _say_ai("speed_to_lead"),
    ),
    # nothing of "answer only when I don't / after hours" exists in the code base yet (no forwarding fallback): the page has the greeting override only
    "answer_calls": (_say_ai("answer_calls"),),
    "followups": (
        Spec("nudges", "choice", "main", _nudges_read, _nudges_write, NUDGES),
        Spec("gap_days", "choice", "main", _gap_read, _gap_write, GAPS),
        _say_ai("followups"),
    ),
    "store_visits": (
        Spec("from_hour", "choice", "main", _visit_hour_read("open"), _visit_hour_write("open", "from_hour"), HOURS_HALF),
        Spec("to_hour", "choice", "main", _visit_hour_read("close"), _visit_hour_write("close", "to_hour"), HOURS_HALF),
        Spec("slot_minutes", "choice", "main", _slot_read, _slot_write, SLOTS),
        Spec("buffer_minutes", "choice", "more", _buffer_read, _buffer_write, BUFFERS),
        _say_ai("store_visits"),
    ),
    "offers": (
        Spec("weekly_cap", "choice", "main", _cap_read, _cap_write, CAPS),
        _say_ai("offers"),
    ),
    # never a call or a message to a prospect: no greeting, no hours
    "researcher": (
        Spec("results_per_search", "choice", "main", _results_read, _finder_write("results_per_search"), RESULTS),
        Spec("fit_bar", "choice", "main", _fit_read, _finder_write("fit_bar"), FIT_BARS),
    ),
}

# what a helper may ask (jobs contract section 6; the same closed keys the database holds: app.job_finds_out_ok)
FINDS_OUT: dict[str, tuple[str, ...]] = {
    "speed_to_lead": ("need", "quantity", "when", "visit"),
    "followups": ("still_interested", "budget_range"),
}


def read_value(spec: Spec, env: Env) -> Any:
    """A setting's value as the wire has it: a word of `options`, a boolean for a toggle, or null when it cannot be read or has no word."""
    try:
        value = spec.read(env)
    except Exception as err:   # noqa: BLE001 - the caller's role, a subsystem not built here, an unreadable row: the page still opens
        logger.info("jobs setting %s not readable (%s)", spec.key, type(err).__name__)
        return None
    if spec.type == "toggle":
        return value if isinstance(value, bool) else None
    return _word(value, spec.options)


def view(kind: str, env: Env) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {"main": [], "more": []}
    for spec in CATALOGUE.get(kind, ()):
        entry: dict[str, Any] = {"key": spec.key, "type": spec.type, "value": read_value(spec, env)}
        if spec.type == "choice":
            entry["options"] = list(spec.options)
        out[spec.area].append(entry)
    return out


def clean(kind: str, given: dict[str, Any]) -> dict[str, Any]:
    """The values to write, checked against the catalogue before anything is written: an unknown key or a value outside `options` is `422 setting_invalid` naming the key."""
    specs = {s.key: s for s in CATALOGUE.get(kind, ())}
    bad = sorted(k for k in given if k not in specs)
    out: dict[str, Any] = {}
    for key, value in given.items():
        spec = specs.get(key)
        if spec is None:
            continue
        if spec.type == "toggle":
            word = {"on": True, "off": False}.get(value) if isinstance(value, str) else value
            if not isinstance(word, bool):
                bad.append(key)
                continue
            out[key] = word
        elif isinstance(value, str) and value in spec.options:
            out[key] = value
        else:
            bad.append(key)
    if bad:
        raise ApiError(422, "setting_invalid", "That choice is not one of the options.", extra={"fields": sorted(set(bad))})
    return out


def apply(kind: str, env: Env, values: dict[str, Any]) -> None:
    """Write checked values, one setting after the other, through each setting's own function. The first refusal (a role, the second factor, a state) stops the rest and is the answer."""
    specs = {s.key: s for s in CATALOGUE.get(kind, ())}
    for key, value in values.items():
        specs[key].write(env, value)
        env.memo.clear()

