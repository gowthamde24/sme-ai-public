"""The job page in one call: `JobDetail` (jobs contract 1.0 section 1, 14, 15; docs/contracts/jobs-detail.md). A Job (the reader of app/jobs/listing.py, with the owner's own name and what waits) plus what the page shows:

  says       the opening line a call or a message really starts with, from the REAL opening-line function (app/opening/resolve.py) with the business name, the job's own name and the greeting setting (the job's override, else the
             business setting): what the page shows is what a customer hears. Left out (empty) when the opening cannot be read; a wrong line is worse than none.
  settings   the catalogue (app/jobs/catalogue.py): `main` (at most four) and `more`
  when       the days and hours the job works in, read from the same place the old screen reads them (null where the job has none)
  finds_out  what the helper asks (the closed keys per kind, each on or off; a key never set is off)
  faqs       the owner's answers the helper may use
  results    the last seven days from what the subsystems hold (app/jobs/results.py)
  cost       the month's call minutes so far and what the plan includes

Every part is read defensively: a part that cannot be read (the caller's role, a subsystem not built here) is empty or null, never a failed page."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.jobs import catalogue, listing, results
from app.jobs import needs as needs_mod

logger = logging.getLogger("app.jobs")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
# what each helper speaks (the page shows a line per language and channel); the researcher never calls or writes to a prospect
SAYS_CHANNELS: dict[str, tuple[str, ...]] = {"speed_to_lead": ("call", "whatsapp"), "answer_calls": ("call",), "followups": ("whatsapp",), "store_visits": ("whatsapp",), "offers": ("whatsapp",), "researcher": ()}
# the channel the "Test" button uses (the owner's own phone)
TEST_CHANNEL = {"speed_to_lead": "call", "answer_calls": "call", "followups": "whatsapp", "store_visits": "whatsapp", "offers": "whatsapp", "researcher": "whatsapp"}


def _safe(what: str, make: Any, default: Any) -> Any:
    try:
        return make()
    except Exception as err:   # noqa: BLE001 - a part of the page that cannot be read leaves that part empty
        logger.info("jobs detail: %s not readable (%s)", what, type(err).__name__)
        return default


# ------------------------------------------------------------------------------------------------------------------ says
def _languages(env: catalogue.Env) -> list[str]:
    main = _safe("language", lambda: str(catalogue._assistant(env).settings.main_language), "en")
    return [main] if main == "en" else [main, "en"]


def says_of(env: catalogue.Env, kind: str, helper_name: str | None) -> list[dict[str, str]]:
    """The line a call or message of this job starts with. A CALL line comes from the same function the live call uses (app/telephony/call_opening.py, with the same resolved greeting setting of the job), so the page and the
    phone say the same words; a WhatsApp line is the opening line of app/opening/resolve.py."""
    channels = SAYS_CHANNELS[kind]
    if not channels:
        return []
    from types import SimpleNamespace

    from app.opening import greeting
    from app.opening import resolve as opening
    from app.telephony import plivo_outbound
    from app.telephony import tone as tone_mod
    from app.telephony.call_opening import call_opening

    def make() -> list[dict[str, str]]:
        doc = opening.talk_training_doc(env.runtime, env.ctx)
        say_ai = greeting.resolved_for_job(doc, kind)
        state = _safe("opening", lambda: opening._repo(env.runtime).opening(env.token, env.tenant_id), None) if "whatsapp" in channels else None   # one read for every language; without it the WhatsApp lines are left out, the call lines stay
        assistant = helper_name or opening.saved_assistant_name(env.runtime, env.ctx)
        from app.how_speaks.routes import _pack_default_tone

        tone = tone_mod.for_task_call(tone_mod.effective_tone(doc, _pack_default_tone(env.runtime, env.ctx))[0])
        out: list[dict[str, str]] = []
        for language in _languages(env):
            for channel in channels:
                if channel == "call":
                    placed = None if kind == "answer_calls" else SimpleNamespace(goal=None, owner_test=False, kind="task", tone=tone, opening_line=plivo_outbound.opening_for("task", language, tone))
                    text = call_opening(language, business=env.ctx.tenant.name, assistant=assistant, training=doc, say_ai=say_ai, outbound=placed)
                elif state is not None:
                    text = opening.resolve(env.runtime, env.ctx, language, mention_ai=say_ai, row=state, helper_name=helper_name).text
                else:
                    continue
                out.append({"language": language, "channel": channel, "text": text})
        return out

    return _safe("says", make, [])  # type: ignore[no-any-return]


# ------------------------------------------------------------------------------------------------------------------ when
def _days(numbers: list[int], *, from_one: bool) -> list[str]:
    return [DAYS[n - 1 if from_one else n] for n in sorted(set(numbers)) if 0 <= (n - 1 if from_one else n) <= 6]


def when_of(env: catalogue.Env, kind: str) -> dict[str, Any]:
    out: dict[str, Any] = {"from_hour": None, "to_hour": None, "days": [], "pace_per_hour": None}
    if kind == "speed_to_lead":
        s = _safe("when", lambda: catalogue._assistant(env).settings, None)
        if s is not None:
            out.update(from_hour=catalogue.hhmm(s.call_from_minute), to_hour=catalogue.hhmm(s.call_to_minute), days=_days(list(s.call_days), from_one=True))
    elif kind == "followups":
        row = _safe("when", lambda: catalogue._fpolicy(env), None)
        if row is not None:   # the quiet hours are when it does NOT write: it works from the end of the quiet time to its start
            out.update(from_hour=str(row["quiet_end"])[:5], to_hour=str(row["quiet_start"])[:5], days=_days([int(d) for d in row["allowed_weekdays"]], from_one=False))
    elif kind == "store_visits":
        s = _safe("when", lambda: catalogue._visits(env), None)
        if s is not None:
            open_days = [(i, h) for i, h in enumerate(s.weekly_hours.values()) if h is not None]
            out.update(from_hour=catalogue._same([h.open for _, h in open_days]), to_hour=catalogue._same([h.close for _, h in open_days]), days=_days([i for i, _ in open_days], from_one=False))
    return out


# ------------------------------------------------------------------------------------------------------------------ results and cost
def cost_of(env: catalogue.Env) -> dict[str, Any]:
    """The month's call minutes so far and what the plan includes; `rupees` is null until a paid plan's rate is read here (early access: always null)."""
    out: dict[str, Any] = {"minutes_used": 0, "minutes_included": None, "rupees": None}
    billing = env.runtime.billing
    if billing is None:
        return out
    meter = _safe("cost", lambda: billing.usage(env.token, env.tenant_id).get("call_minutes") or {}, {})
    used, allowance = meter.get("used"), meter.get("allowance")
    if isinstance(used, (int, float)) and not isinstance(used, bool):
        out["minutes_used"] = int(-(-used // 1))
    if isinstance(allowance, int) and not isinstance(allowance, bool):
        out["minutes_included"] = allowance
    return out


# ------------------------------------------------------------------------------------------------------------------ the page
def finds_out_of(kind: str, meta: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = meta.get("finds_out") if meta else None
    given: dict[str, Any] = raw if isinstance(raw, dict) else {}
    return [{"key": key, "enabled": given.get(key) is True} for key in catalogue.FINDS_OUT.get(kind, ())]


def meta_of(runtime: Any, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any] | None:
    trust = getattr(getattr(runtime, "jobs", None), "trust", None)
    if trust is None:
        return None
    rows = _safe("meta", lambda: trust.meta_list(token, tenant_id), [])
    return next((m for m in rows if m.get("kind") == kind), None)


def build(runtime: Any, ctx: Any, kind: str) -> dict[str, Any] | None:
    """The JobDetail of one kind, or None when this business never has it (the Lead Finder of a school)."""
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    job = listing.read_one(runtime, token, tenant_id, kind)
    if job is None:
        return None
    meta = meta_of(runtime, token, tenant_id, kind)
    name = str(meta["custom_name"]) if meta and meta.get("custom_name") else None
    items = needs_mod.items_of(runtime, token, tenant_id)
    listing.overlay(job, {kind: meta} if meta else {}, needs_mod.count_by_job(items))
    env = catalogue.Env(runtime=runtime, ctx=ctx)
    trust = getattr(getattr(runtime, "jobs", None), "trust", None)
    faqs = _safe("faqs", lambda: trust.faq_list(token, tenant_id, uuid.UUID(str(meta["id"]))), []) if trust is not None and meta else []
    fix = job.get("fix")
    return {
        **job,
        "business_name": ctx.tenant.name,
        "what_it_does": {"code": kind},
        "says": says_of(env, kind, name),
        "when": when_of(env, kind),
        "settings": catalogue.view(kind, env),
        "effect": {"inputs": {"who": None, "event_at": None, "booked_at": None}},
        "finds_out": finds_out_of(kind, meta),
        "faqs": [{"id": f["id"], "question": f["question"], "answer": f["answer"]} for f in faqs],
        "results": results.results_of(env, kind),
        "failure": {"code": fix["code"], "params": {"count": fix.get("count", 0)}, "items": []} if isinstance(fix, dict) else None,
        "test_channel": TEST_CHANNEL[kind],
        "cost": cost_of(env),
    }
