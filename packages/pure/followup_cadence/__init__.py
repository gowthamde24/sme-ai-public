"""Pure follow-up cadence decisions; no sending or external I/O."""

from datetime import date, datetime, timedelta, timezone
import hashlib
import json

ENGINE_VERSION = "1.0.0"

MAX_HISTORY = 1_000
MAX_TOUCHES = 100
MAX_GAPS = MAX_TOUCHES - 1
MAX_HOLIDAYS = 366
MAX_WEEKDAYS = 7
MAX_GAP_DAYS = 365
MAX_MIN_GAP_HOURS = 8_760
MAX_OFFSET_MINUTES = 840
MAX_STRING_LENGTH = 128
MAX_DEPTH = 8
MAX_NODES = 10_000
MAX_OBJECT_FIELDS = 16
MAX_INTEGER = 10_000


class _Invalid(Exception):
    pass


def _typed(value, kind):
    if type(value) is not kind:
        raise TypeError("Expected " + kind.__name__)


def _list(value, maximum):
    _typed(value, list)
    if len(value) > maximum:
        raise _Invalid("OUT_OF_RANGE")


def _bounded(request):
    """Bound shape and size before hashing, parsing or history item work."""
    _typed(request, dict)
    if "history" in request:
        _list(request["history"], MAX_HISTORY)
    if "policy" in request:
        p = request["policy"]
        _typed(p, dict)
        for field, maximum in (("gap_days", MAX_GAPS), ("allowed_weekdays", MAX_WEEKDAYS),
                               ("holidays", MAX_HOLIDAYS)):
            if field in p:
                _list(p[field], maximum)
    pending = [(request, 0)]
    count = 0
    while pending:
        value, depth = pending.pop()
        count += 1
        if depth > MAX_DEPTH or count > MAX_NODES:
            raise _Invalid("OUT_OF_RANGE")
        if type(value) is int:
            if value < -MAX_INTEGER or value > MAX_INTEGER:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is str:
            if len(value) > MAX_STRING_LENGTH:
                raise _Invalid("OUT_OF_RANGE")
        elif type(value) is list:
            _list(value, MAX_HISTORY)
            pending.extend((item, depth + 1) for item in value)
        elif type(value) is dict:
            if len(value) > MAX_OBJECT_FIELDS:
                raise _Invalid("OUT_OF_RANGE")
            for key, item in value.items():
                _typed(key, str)
                if len(key) > MAX_STRING_LENGTH:
                    raise _Invalid("OUT_OF_RANGE")
                pending.append((item, depth + 1))
        elif type(value) not in (bool, type(None)):
            raise TypeError("Only integer JSON values are supported")


def canonical_json(value):
    """Sorted, compact ASCII JSON; reject non-JSON types and floating point."""
    def check(item):
        if type(item) in (str, int, bool, type(None)):
            return
        if type(item) is list:
            for part in item:
                check(part)
        elif type(item) is dict:
            for key, part in item.items():
                _typed(key, str)
                check(part)
        else:
            raise TypeError("Only integer JSON values are supported")
    check(value)
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _fields(obj, keys):
    _typed(obj, dict)
    if obj.keys() != set(keys):
        raise _Invalid("INVALID_FIELDS")


def _integer(value, minimum, maximum):
    _typed(value, int)
    if value < minimum or value > maximum:
        raise _Invalid("OUT_OF_RANGE")


def _text(value):
    _typed(value, str)
    if not value:
        raise _Invalid("EMPTY_IDENTIFIER")


def _utc(value):
    _typed(value, str)
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo != timezone.utc or _iso(parsed) != value:
            raise ValueError()
        return parsed
    except ValueError:
        raise _Invalid("INVALID_TIMESTAMP") from None


def _iso(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def _day(value):
    _typed(value, str)
    try:
        parsed = date.fromisoformat(value)
        if parsed.isoformat() != value:
            raise ValueError()
        return parsed
    except ValueError:
        raise _Invalid("INVALID_DATE") from None


def _minute(value):
    _typed(value, str)
    if len(value) != 5 or value[2] != ":" or not (value[:2] + value[3:]).isascii() or not (value[:2] + value[3:]).isdigit():
        raise _Invalid("INVALID_QUIET_HOURS")
    hour, minute = int(value[:2]), int(value[3:])
    if hour > 23 or minute > 59:
        raise _Invalid("OUT_OF_RANGE")
    return hour * 60 + minute


def _validate(r):
    _fields(r, ("as_of", "recipient_utc_offset_minutes", "lead", "history", "policy"))
    now = _utc(r["as_of"])
    _integer(r["recipient_utc_offset_minutes"], -MAX_OFFSET_MINUTES, MAX_OFFSET_MINUTES)
    lead = r["lead"]
    _fields(lead, ("do_not_contact", "opted_out", "replied", "bounced", "won", "lost"))
    for flag in lead.values():
        _typed(flag, bool)
    p = r["policy"]
    _fields(p, ("gap_days", "max_touches", "quiet_hours", "allowed_weekdays", "holidays", "min_gap_hours"))
    _integer(p["max_touches"], 0, MAX_TOUCHES)
    _integer(p["min_gap_hours"], 0, MAX_MIN_GAP_HOURS)
    for gap in p["gap_days"]:
        _integer(gap, 0, MAX_GAP_DAYS)
    if len(p["gap_days"]) != max(p["max_touches"] - 1, 0):
        raise _Invalid("INVALID_GAP_COUNT")
    _fields(p["quiet_hours"], ("start", "end"))
    start, end = _minute(p["quiet_hours"]["start"]), _minute(p["quiet_hours"]["end"])
    for weekday in p["allowed_weekdays"]:
        _integer(weekday, 0, 6)
    if not p["allowed_weekdays"]:
        raise _Invalid("NO_ALLOWED_WEEKDAYS")
    if len(set(p["allowed_weekdays"])) != len(p["allowed_weekdays"]):
        raise _Invalid("DUPLICATE_WEEKDAY")
    holidays = {_day(value) for value in p["holidays"]}
    if len(holidays) != len(p["holidays"]):
        raise _Invalid("DUPLICATE_HOLIDAY")
    history = []
    for touch in r["history"]:
        _fields(touch, ("timestamp", "channel", "direction", "outcome"))
        at = _utc(touch["timestamp"])
        if at > now:
            raise _Invalid("FUTURE_HISTORY")
        _text(touch["channel"])
        _text(touch["outcome"])
        _typed(touch["direction"], str)
        if touch["direction"] not in ("in", "out"):
            raise _Invalid("INVALID_DIRECTION")
        history.append((at, touch["direction"]))
    return now, start, end, holidays, history


def decide(request):
    """Return stop/wait/draft_followup, or a rejection. Never approve/send."""
    digest, trace = None, []

    def rule(rule_id, **values):
        trace.append({"rule_id": rule_id, "inputs": values,
                      "text": rule_id + ": " + canonical_json(values)})

    def rejected(code):
        return {"status": "rejected", "codes": [code], "engine_version": ENGINE_VERSION,
                "canonical_hash": digest, "trace": trace}

    try:
        _bounded(request)
    except _Invalid as exc:
        return rejected(str(exc))
    digest = hashlib.sha256(canonical_json({"engine_version": ENGINE_VERSION,
                                          "inputs": request}).encode("utf-8")).hexdigest()
    try:
        now, start, end, holidays, history = _validate(request)
    except _Invalid as exc:
        return rejected(str(exc))
    lead, p = request["lead"], request["policy"]
    outbound = [at for at, direction in history if direction == "out"]
    number = len(outbound) + 1

    def result(action, reason, eligible=None):
        return {"action": action, "reason_code": reason, "touch_number": number,
                "next_eligible_at": _iso(eligible) if eligible is not None else None,
                "engine_version": ENGINE_VERSION, "canonical_hash": digest, "trace": trace}

    rule("lead.flags", **lead)
    for flag in ("do_not_contact", "opted_out", "bounced"):
        if lead[flag]:
            rule("stop.suppression", flag=flag)
            return result("stop", flag)
    if lead["replied"] or any(direction == "in" for _, direction in history):
        rule("stop.human_takeover", replied=lead["replied"], inbound=sum(direction == "in" for _, direction in history))
        return result("stop", "human_takeover")
    if lead["won"] or lead["lost"]:
        rule("stop.closed", won=lead["won"], lost=lead["lost"])
        return result("stop", "won" if lead["won"] else "lost")
    rule("cadence.max_touches", outbound_count=len(outbound), max_touches=p["max_touches"])
    if len(outbound) >= p["max_touches"]:
        return result("stop", "max_touches_reached")
    if not outbound:
        return result("stop", "initial_outreach_required")
    try:
        last = max(outbound)
        gap = p["gap_days"][number - 2]
        cadence_floor = last + timedelta(days=gap)
        minimum_floor = last + timedelta(hours=p["min_gap_hours"])
        candidate = max(cadence_floor, minimum_floor, now)
        rule("cadence.gap", touch_number=number, last_outbound=_iso(last), gap_days=gap,
             min_gap_hours=p["min_gap_hours"], cadence_floor=_iso(cadence_floor),
             minimum_floor=_iso(minimum_floor), as_of=_iso(now), candidate=_iso(candidate))
        offset = timedelta(minutes=request["recipient_utc_offset_minutes"])
        local = candidate.replace(tzinfo=None) + offset
        # At most one weekly allowed day can be blocked by each holiday. Quiet
        # hours skip once per date. This bound is computational, not policy.
        for _ in range(2 * 7 * (MAX_HOLIDAYS + 1)):
            day = local.date()
            if local.weekday() not in p["allowed_weekdays"] or day in holidays:
                rule("calendar.skip_date", local_date=day.isoformat(), weekday=local.weekday(),
                     holiday=day in holidays, allowed_weekdays=p["allowed_weekdays"])
                local = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0)
                continue
            minute = local.hour * 60 + local.minute
            quiet = (start <= minute < end if start < end else
                     (minute >= start or minute < end) if start > end else False)
            if quiet:
                next_day = start > end and minute >= start
                rule("calendar.quiet", local_at=_iso(local), start=start, end=end, next_day=next_day)
                local = (local + timedelta(days=int(next_day))).replace(hour=end // 60, minute=end % 60, second=0)
                continue
            eligible = (local - offset).replace(tzinfo=timezone.utc)
            rule("calendar.eligible", utc=_iso(eligible), local_at=_iso(local), offset_minutes=request["recipient_utc_offset_minutes"])
            if eligible <= now:
                return result("draft_followup", "eligible_now", eligible)
            return result("wait", "not_yet_eligible", eligible)
        return rejected("NO_ELIGIBLE_TIME")
    except OverflowError:
        return rejected("DATE_OVERFLOW")
