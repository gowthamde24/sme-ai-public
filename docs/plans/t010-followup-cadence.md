# T010 pure follow-up cadence (lane C)

## API and ownership

Stdlib-only `packages/pure/followup_cadence`. Add `packages/pure` to sys.path;
`from followup_cadence import decide, canonical_json, ENGINE_VERSION`.
`decide(request) -> dict` has no clock, randomness, I/O, sending or approvals.
The nested package is discovered/imported by the unchanged `make test-packages`.
Synthetic example: `followup_cadence/tests/fixtures/synthetic.json`.

Request (exact fields; booleans only for flags, integers only for numbers):
- `as_of`: UTC ISO timestamp, canonical `YYYY-MM-DDTHH:MM:SSZ` only.
- `recipient_utc_offset_minutes`: fixed integer offset; no timezone/DST database.
- `lead`: boolean do_not_contact, opted_out, replied, bounced, won, lost.
- `history`: list of `{timestamp, channel, direction: "out" | "in", outcome}`.
  Timestamps use the as_of format; channel/outcome are nonempty opaque strings.
- `policy`: `{gap_days, max_touches, quiet_hours: {start: "HH:MM", end: "HH:MM"},
  allowed_weekdays, holidays, min_gap_hours}`. Holidays are local ISO dates.

Result: `{action, reason_code, touch_number, next_eligible_at, trace,
engine_version, canonical_hash}`. Action is wait, draft_followup or stop, never
send. Stopped decisions have null next_eligible_at. Trace entries contain rule_id,
operands and readable text; local_at has no UTC suffix, UTC times end in Z.
Version is 1.0.0. Hash is sha256 of sorted compact ASCII JSON of
`{"engine_version": ENGINE_VERSION, "inputs": request}`. Dictionary key order
does not matter; list order affects the hash but not history/calendar semantics.
`canonical_json(result).encode("utf-8")` is byte-identical for equal inputs.
No input mutation. Wrong types (including floats/bools in number fields) raise
TypeError; invalid values return `{status: "rejected", codes, engine_version,
canonical_hash, trace}`. Preflight oversize rejection has null hash to avoid
serialization. Other invalid values retain the request hash.

## Rules and smallest safe assumptions

1. Suppression wins: do_not_contact, then opted_out, then bounced => stop with
   that flag as reason_code; these override every reply/closed/cadence condition.
2. replied or any inbound history entry => stop/human_takeover, even if closed.
3. won/lost => stop (won wins ties), before touch-limit calculation.
4. Every outbound entry counts, regardless of channel/outcome; duplicates count.
   max_touches includes initial outreach. Reaching/exceeding the limit stops.
5. touch_number = outbound count + 1. With no outbound, stop with
   initial_outreach_required: this engine cannot invent an initial anchor.
6. gap_days[0] is before touch 2; gap_days[n-2] is before touch n.
   Exactly max(max_touches-1, 0) gaps are required, all supplied by policy.
7. Anchor is max outbound timestamp (history can be unordered). Future history
   rejects. Candidate = max(last + gap_days, last + min_gap_hours, as_of).
8. Move only forward in recipient local time. Weekdays use Monday=0..Sunday=6;
   allowed_weekdays is nonempty/unique; holidays are unique local dates.
9. Quiet hours are [start,end); start is quiet, end is allowed. Wrapping windows
   cross midnight; equal endpoints disable quiet hours. Seconds are preserved
   outside quiet periods; skips land exactly at local quiet end or midnight.
10. eligible == as_of gives draft_followup/eligible_now; future gives
    wait/not_yet_eligible. next_eligible_at is never earlier than as_of/minimum gap.
11. For the same touch number, later last-outbound evidence cannot move eligibility
    earlier. Added history at unchanged outbound count is inbound and stops;
    stop has no earlier scheduled draft. Adding an outbound changes touch number.

Rejection codes: OUT_OF_RANGE, INVALID_FIELDS, EMPTY_IDENTIFIER,
INVALID_TIMESTAMP, INVALID_DATE, INVALID_QUIET_HOURS, INVALID_GAP_COUNT,
NO_ALLOWED_WEEKDAYS, DUPLICATE_WEEKDAY, DUPLICATE_HOLIDAY, FUTURE_HISTORY,
INVALID_DIRECTION, DATE_OVERFLOW, NO_ELIGIBLE_TIME (bounded-search fallback).
All calendar arithmetic overflow rejects. Search is bounded by holiday capacity
and a seven-day week; no policy cadence/quiet-time defaults are implicit.

## Inclusive operational maxima (owner-reviewable, not business policy)

| Module constant | Maximum |
| --- | --- |
| MAX_HISTORY / MAX_TOUCHES / MAX_GAPS | 1,000 / 100 / 99 |
| MAX_HOLIDAYS / MAX_WEEKDAYS | 366 / 7 |
| MAX_GAP_DAYS / MAX_MIN_GAP_HOURS | 365 / 8,760 |
| MAX_OFFSET_MINUTES | absolute 840 (UTC -14:00..+14:00) |
| MAX_STRING_LENGTH | 128 Unicode characters (including keys) |
| MAX_DEPTH / MAX_NODES / MAX_OBJECT_FIELDS | 8 / 10,000 / 16 |
| MAX_INTEGER | absolute 10,000, before field-specific bounds |
Quiet endpoints are 00:00..23:59; weekday integers 0..6. Outer list sizes are
checked before hashing, parsing or item work. Iterative depth/node budgets also
contain malformed unknown fields. Tests cover limit/one-above and huge inputs.

## Owner decisions and lane A handoff

Owner must confirm gap days/indexing, max touches/counting attempts, quiet hours
(including equal endpoints), weekdays, local holidays, minimum gap and who handles
replies. Fixed offset is caller-supplied; India has no DST. Outcomes do not infer
suppression flags: lane A supplies authoritative flags and observed history.
Legality (consent, DND, opt-in rules and suppression list with HMAC) is NOT decided
here: lane A must supply the flags before first outreach. This is pure scheduling;
lane A owns authorization, approval, persistence, authoritative lookup, provenance,
durable audit, reply handling and integration. A hash authenticates no actor/data.
