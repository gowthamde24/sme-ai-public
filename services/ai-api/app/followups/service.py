"""The follow-up use cases. The API DECIDES NOTHING: for a draft it reads the lead's recorded state with the caller's own token, builds the cadence request from it
(app/followups/builder.py, the same JSON the database's `app.followup_build` produces), runs the pinned engine (app/followups/cadence_port.py, as of its own clock), and hands the database the
canonical request and result. The database runs the gate (suppression, keys, consent), the stops, rebuilds the request, decides ITSELF whether a follow-up is due and refuses any difference
(SM220-SM227). A touch, a draft and an approval are RECORDS of what a person did; nothing here sends a message, and no request carries wording (the database copies a closed template)."""

from __future__ import annotations

import base64
import binascii
import datetime as dt
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from app.crm.repository import NotFoundError
from app.enquiries.repository import EnquiriesRepository
from app.enquiries.service import build_view
from app.errors import ApiError
from app.followups import cadence_port
from app.followups.builder import FollowupRequestError, LeadSnapshot, build_request
from app.followups.models import (
    ApproveDraftIn,
    ChannelStateOut,
    CreateDraftIn,
    CreatePolicyIn,
    DecisionOut,
    DraftChannel,
    DraftOut,
    DraftResultOut,
    DraftStatusOut,
    DueItemOut,
    DueListOut,
    GateOut,
    LeadFollowupOut,
    PolicyResultOut,
    PolicyVersionOut,
    QuestionDecisionOut,
    QuestionDraftOut,
    QuestionSyncOut,
    RecordSentIn,
    RecordTouchIn,
    SentResultOut,
    TouchOut,
    TouchResultOut,
)
from app.followups.repository import FollowupsRepository


def _cadence_failure(exc: Exception) -> ApiError:
    if isinstance(exc, cadence_port.CadenceUnavailable):
        return ApiError(
            503, "followup_cadence_unavailable", "Follow-ups are not available right now."
        )
    return ApiError(
        502,
        "followup_cadence_failed",
        "The follow-up rules could not be run. Nothing was recorded.",
    )


def run_engine(
    snapshot: LeadSnapshot, now: datetime
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """(request, engine result) for the lead as of `now`, or None when no policy is in force. The engine's own failures (CadenceUnavailable, CadenceInputError, CadenceError) are NOT caught here:
    the caller decides what a failure means (a page shows no decision; a draft fails closed)."""
    try:
        request = build_request(snapshot, as_of=now)
    except FollowupRequestError as exc:
        if exc.code == "no_policy":
            return None
        raise ApiError(422, "validation_error", "Invalid input.") from None
    return request, cadence_port.run_decide(request)


ENGINE_FAILURES = (
    cadence_port.CadenceUnavailable,
    cadence_port.CadenceInputError,
    cadence_port.CadenceError,
)


def decide(snapshot: LeadSnapshot, now: datetime) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """run_engine, FAIL CLOSED: an engine that cannot run is an ApiError (503 unavailable, 502 failed) and nothing is recorded. Used by creating a draft and by the due list."""
    try:
        return run_engine(snapshot, now)
    except ENGINE_FAILURES as exc:
        raise _cadence_failure(exc) from None


def decision_out(result: dict[str, Any]) -> DecisionOut:
    version = str(result["engine_version"])
    if cadence_port.is_rejected(result):
        return DecisionOut(
            action=None,
            reason_code=str(result["codes"][0]),
            terminal=None,
            touch_number=None,
            next_eligible_at=None,
            engine_version=version,
        )
    return DecisionOut(
        action=result["action"],
        reason_code=str(result["reason_code"]),
        terminal=result["terminal"],
        touch_number=result["touch_number"],
        next_eligible_at=result["next_eligible_at"],
        engine_version=version,
    )


def stopped_decision(reason: str) -> DecisionOut:
    """A lead the DATABASE has stopped (an order accepted, declined or cancelled, a quote withdrawn, the lead archived: `app.followup_stopped`) is not put to the engine. The engine does not know
    about orders and would say a draft can be made now, which the database then refuses; the stop reason overrides it, so a screen never shows "due" for a lead that cannot be followed up.
    `engine_version` is "none": no engine produced this answer, the database's stop rule did. The pinned engine is unchanged."""
    return DecisionOut(
        action="stop",
        reason_code=reason,
        terminal=True,
        touch_number=None,
        next_eligible_at=None,
        engine_version="none",
    )


def public_gate(gate: dict[str, Any]) -> dict[str, Any]:
    """The gate as a client may see it: an erased marker on a key (another person erased by right shared the identifier) is `key`, never `erased_key`. The database already answers `key`; this is the same rule held once more at the door."""
    blocked = gate.get("blocked")
    return {**gate, "blocked": "key" if blocked == "erased_key" else blocked}


# The draft channels, in the order a screen shows them (the order is also the default's last resort).
CHANNELS: tuple[DraftChannel, ...] = ("email", "whatsapp")

# The most leads ONE REQUEST of the due list processes (the page size). Each candidate costs at most two gate reads (e-mail, then WhatsApp; a stopped lead only the first), so a request makes at most
# 2 * DUE_LIST_MAX_LEADS = 60 gate reads, 30 snapshot reads and 30 engine runs, however many leads the workspace has: the rest is reached by the cursor (`?after=`). A caller cannot raise it.
DUE_LIST_MAX_LEADS = 30
# The most leads the database function EXAMINES for one page (it skips the ones that cannot be due); a stretch of dead leads cannot make one call slow, and the cursor continues after it.
DUE_SCAN_MAX = 300
# A cursor is the base64url of {"at", "id"} (about 110 characters); anything longer is not ours.
CURSOR_MAX_CHARS = 200


def encode_cursor(cursor: tuple[str, uuid.UUID]) -> str:
    raw = json.dumps({"at": cursor[0], "id": str(cursor[1])}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_cursor(text: str) -> tuple[str, uuid.UUID]:
    """A client's cursor back into (time, lead id), or a 422: it is validated here and is nothing the database has to trust (it only compares). Anything that is not exactly what `encode_cursor` makes is refused."""
    invalid = ApiError(422, "validation_error", "Invalid input.")
    if not text or len(text) > CURSOR_MAX_CHARS or not text.isascii():
        raise invalid
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
        data = json.loads(raw)
        if (
            not isinstance(data, dict)
            or set(data) != {"at", "id"}
            or not isinstance(data["at"], str)
            or not isinstance(data["id"], str)
        ):
            raise invalid
        moment = dt.datetime.fromisoformat(
            data["at"]
        )  # `datetime` itself is the module's clock (the tests freeze it): parsing uses the real class
        lead = uuid.UUID(data["id"])
    except (binascii.Error, ValueError, UnicodeDecodeError):
        raise invalid from None
    if moment.tzinfo is None or str(lead) != data["id"]:
        raise invalid
    return moment.isoformat(), lead


def channel_is_open(gate: dict[str, Any]) -> bool:
    """A draft channel is open when the database has neither stopped the lead nor blocked this channel."""
    return gate.get("stopped") is None and gate.get("blocked") is None


def channel_states(gates: dict[DraftChannel, dict[str, Any]]) -> list[ChannelStateOut]:
    return [ChannelStateOut(channel=c, blocked=gates[c].get("blocked")) for c in CHANNELS]


def default_channel(
    gates: dict[DraftChannel, dict[str, Any]],
    open_draft_channel: str | None,
    last_outbound_channel: str | None,
) -> DraftChannel:
    """The channel a lead opens on when nobody asked for one (there is no preferred-channel field): the channel of the draft a person has open, else the channel of the lead's latest outbound e-mail or
    WhatsApp touch (carry on where you last spoke), each only while that channel is open; else e-mail if open, else WhatsApp if open; else e-mail, so the page shows why it is closed."""
    for wanted in (open_draft_channel, last_outbound_channel):
        for channel in CHANNELS:
            if channel == wanted and channel_is_open(gates[channel]):
                return channel
    for channel in CHANNELS:
        if channel_is_open(gates[channel]):
            return channel
    return "email"


def read_gates(
    repo: FollowupsRepository, token: str, lead_id: uuid.UUID
) -> dict[DraftChannel, dict[str, Any]]:
    """The gate as a client may see it, for every draft channel of the lead (the lead page reads both; the stop is the lead's, the block is the channel's)."""
    return {c: public_gate(repo.gate(token, lead_id, c)) for c in CHANNELS}


def blocked_decision(reason: str) -> DecisionOut:
    """A lead whose contact the gate BLOCKS for this channel (the contact asked not to be contacted, a suppressed key shared with someone else, an erased contact, no consent, no key) is not put to the engine either:
    the engine sees only the lead's own flag, not keys, consent or erasure, and would say a draft can be made, which the database then refuses (SM220/SM221). The block overrides it with the gate's own closed word as the
    reason. `terminal` is false: a lifted key or a recorded consent can reopen it, and the database decides again. `engine_version` is "none": no engine produced it."""
    return DecisionOut(
        action="stop",
        reason_code=reason,
        terminal=False,
        touch_number=None,
        next_eligible_at=None,
        engine_version="none",
    )


def draft_out(row: dict[str, Any]) -> DraftOut:
    return DraftOut.model_validate(row)


def lead_followup(
    repo: FollowupsRepository,
    token: str,
    tenant: uuid.UUID,
    lead_id: uuid.UUID,
    channel: str | None,
    *,
    now: datetime | None = None,
) -> LeadFollowupOut | None:
    """The page for `channel`, or for the lead's default channel when `channel` is None. Gate first, per channel: the lead's stop, then this channel's block, then the engine (which is lead-level and asked only for an open channel)."""
    snapshot = repo.lead_snapshot(token, tenant, lead_id)
    if snapshot is None:
        return None
    gates = read_gates(repo, token, lead_id)
    touches = [
        TouchOut.model_validate(t) for t in repo.list_touches(token, tenant, lead_id, limit=100)
    ]
    drafts = [
        draft_out(d)
        for d in repo.list_drafts(token, tenant, lead_id=lead_id, status=None, limit=50)
    ]
    open_draft = next((d for d in drafts if d.status in ("draft", "approved")), None)
    last_out = next((t for t in touches if t.direction == "out" and t.channel in CHANNELS), None)
    default = default_channel(
        gates,
        None if open_draft is None else open_draft.channel,
        None if last_out is None else last_out.channel,
    )
    shown: DraftChannel = default if channel is None else channel  # type: ignore[assignment]
    gate = gates[shown]
    stopped, blocked = gate.get("stopped"), gate.get("blocked")
    decision: DecisionOut | None = None
    if stopped is not None:
        decision = stopped_decision(str(stopped))  # the database's stop: the engine is not asked
    elif blocked is not None:
        decision = blocked_decision(
            str(blocked)
        )  # the gate's block for this channel: the engine is not asked
    else:
        try:
            ran = run_engine(snapshot, now or datetime.now(UTC))
        except ENGINE_FAILURES:
            ran = None  # the page still shows the gate, the touches and the drafts; it just has no decision (creating a draft stays fail-closed)
        decision = None if ran is None else decision_out(ran[1])
    return LeadFollowupOut(
        lead_id=lead_id,
        channel=shown,
        default_channel=default,
        channels=channel_states(gates),
        gate=GateOut.model_validate(gate),
        decision=decision,
        policy_version_id=None if snapshot.policy is None else uuid.UUID(snapshot.policy.id),
        touches=touches,
        drafts=drafts,
    )


def due_list(
    repo: FollowupsRepository,
    token: str,
    tenant: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = DUE_LIST_MAX_LEADS,
    now: datetime | None = None,
) -> DueListOut:
    """One page of what a person could do about follow-ups right now, from real backend state. The candidates come from the database (`public.followup_due_candidates`: oldest last outbound touch first, only leads that
    could still be due); for each of them the API does what it always did: the gate per channel (stop > block > engine), the snapshot, the pinned engine (the cadence is the lead's, not the channel's). At most
    DUE_LIST_MAX_LEADS candidates are processed per request, whatever `limit` says; the rest is reached with the cursor. Computed when the page is opened (no scheduler)."""
    after = None if cursor is None else decode_cursor(cursor)
    moment = now or datetime.now(UTC)
    page = repo.due_candidates(
        token, tenant, after=after, limit=min(limit, DUE_LIST_MAX_LEADS), scan_max=DUE_SCAN_MAX
    )
    if not page.policy_in_force:
        return DueListOut(
            items=[], next_cursor=None, policy_in_force=False, left_out=0
        )  # no policy: nothing is due, the engine is not asked, and whatever the function sent is ignored
    items: list[DueItemOut] = []
    left_out = 0
    for candidate in page.items:
        lead_id = candidate.lead_id
        email = public_gate(repo.gate(token, lead_id, "email"))
        if email.get("stopped") is not None:
            left_out += 1  # stopped by the database since the candidates were read (an order, a withdrawn quote): the stop is the lead's, so WhatsApp is not read
            continue
        gates: dict[DraftChannel, dict[str, Any]] = {
            "email": email,
            "whatsapp": public_gate(repo.gate(token, lead_id, "whatsapp")),
        }
        if not any(channel_is_open(g) for g in gates.values()):
            left_out += 1  # blocked on every channel (erased, no consent or no key): nothing is due, whatever the engine would say
            continue
        snapshot = repo.lead_snapshot(token, tenant, lead_id)
        if snapshot is None:
            left_out += 1
            continue
        ran = decide(snapshot, moment)
        if ran is None or cadence_port.is_rejected(ran[1]):
            left_out += 1
            continue
        result = ran[1]
        if result["action"] == "stop":
            continue  # the engine says there is nothing to do (the candidates function should not have sent it); a stop is not a row of the working list
        items.append(
            DueItemOut(
                lead_id=lead_id,
                action=result["action"],
                reason_code=str(result["reason_code"]),
                touch_number=result["touch_number"],
                next_eligible_at=result["next_eligible_at"],
                open_draft_id=candidate.open_draft_id,
                open_draft_channel=candidate.open_draft_channel,  # type: ignore[arg-type]
                channels=channel_states(gates),
                default_channel=default_channel(
                    gates, candidate.open_draft_channel, candidate.last_outbound_channel
                ),
            )
        )
    return DueListOut(
        items=items,
        next_cursor=None if page.next_cursor is None else encode_cursor(page.next_cursor),
        policy_in_force=page.policy_in_force,
        left_out=left_out,
    )


def create_policy(
    repo: FollowupsRepository, token: str, tenant: uuid.UUID, body: CreatePolicyIn
) -> PolicyResultOut:
    done = repo.create_policy(
        token,
        {
            "p_version_id": str(body.id),
            "p_tenant_id": str(tenant),
            "p_effective_from": body.effective_from.isoformat(),
            "p_policy": {
                "gap_days": body.gap_days,
                "max_touches": body.max_touches,
                "quiet_hours": {"start": body.quiet_start, "end": body.quiet_end},
                "allowed_weekdays": body.allowed_weekdays,
                "holidays": [d.isoformat() for d in body.holidays],
                "min_gap_hours": body.min_gap_hours,
                "recipient_utc_offset_minutes": body.recipient_utc_offset_minutes,
            },
        },
    )
    return PolicyResultOut.model_validate(
        {k: done[k] for k in ("version_id", "version_no", "effective_from", "replayed")}
    )


def list_policies(
    repo: FollowupsRepository, token: str, tenant: uuid.UUID
) -> list[PolicyVersionOut]:
    return [PolicyVersionOut.model_validate(r) for r in repo.list_policies(token, tenant, limit=50)]


def record_touch(
    repo: FollowupsRepository, token: str, lead_id: uuid.UUID, body: RecordTouchIn
) -> TouchResultOut:
    done = repo.record_touch(
        token,
        {
            "p_touch_id": str(body.id),
            "p_lead_id": str(lead_id),
            "p_direction": body.direction,
            "p_channel": body.channel,
            # null is "now" (the database clock); a stated time is the person's, and the database refuses a future one
            "p_occurred_at": None if body.occurred_at is None else body.occurred_at.isoformat(),
        },
    )
    return TouchResultOut.model_validate(done)


def create_draft(
    repo: FollowupsRepository,
    token: str,
    tenant: uuid.UUID,
    lead_id: uuid.UUID,
    body: CreateDraftIn,
    *,
    now: datetime | None = None,
) -> DraftResultOut:
    snapshot = repo.lead_snapshot(token, tenant, lead_id)
    if snapshot is None:
        raise NotFoundError("lead")
    ran = decide(snapshot, now or datetime.now(UTC))
    try:
        version = cadence_port.cadence_version()
        # no policy in force: nothing to run; the database answers in ITS order (the gate and the stops first, then SM222)
        request_text = "{}" if ran is None else cadence_port.canonical_json(ran[0])
        result_text = "{}" if ran is None else cadence_port.canonical_json(ran[1])
    except (
        cadence_port.CadenceUnavailable,
        cadence_port.CadenceInputError,
        cadence_port.CadenceError,
    ) as exc:
        raise _cadence_failure(exc) from None
    done = repo.create_draft(
        token,
        {
            "p_draft_id": str(body.id),
            "p_lead_id": str(lead_id),
            "p_channel": body.channel,
            "p_engine_version": version,
            "p_request_text": request_text,
            "p_result_text": result_text,
        },
    )
    return DraftResultOut.model_validate(done)


def approve_draft(
    repo: FollowupsRepository, token: str, draft_id: uuid.UUID, body: ApproveDraftIn
) -> DraftStatusOut:
    return DraftStatusOut.model_validate(repo.approve_draft(token, draft_id, body.state_hash))


def discard_draft(repo: FollowupsRepository, token: str, draft_id: uuid.UUID) -> DraftStatusOut:
    return DraftStatusOut.model_validate(repo.discard_draft(token, draft_id))


def record_sent(
    repo: FollowupsRepository, token: str, draft_id: uuid.UUID, body: RecordSentIn
) -> SentResultOut:
    done = repo.record_sent(
        token,
        draft_id,
        body.touch_id,
        None if body.occurred_at is None else body.occurred_at.isoformat(),
    )
    return SentResultOut.model_validate(done)


# ----------------------------------------------------------------------------- question drafts
def question_drafts(
    repo: FollowupsRepository,
    token: str,
    tenant: uuid.UUID,
    requirement_id: uuid.UUID,
    *,
    active_only: bool,
) -> list[QuestionDraftOut]:
    return [
        QuestionDraftOut.model_validate(r)
        for r in repo.list_question_drafts(token, tenant, requirement_id, active_only=active_only)
    ]


def sync_questions(
    repo: FollowupsRepository,
    enquiries: EnquiriesRepository,
    token: str,
    tenant: uuid.UUID,
    requirement_id: uuid.UUID,
) -> QuestionSyncOut:
    """Store the questions the closed templates derive from the requirement's fields NOW (app/requirements/questions.py), and resolve those no longer derived. The ids are RANDOM (uuid4), never
    derived from the requirement, the code or the text: a derived id would collide when a question comes back after a discard."""
    enquiry_id = repo.requirement_enquiry(token, tenant, requirement_id)
    if enquiry_id is None:
        raise NotFoundError("requirement")
    requirement, rows = enquiries.get_requirement(token, tenant, enquiry_id)
    if requirement is None or str(requirement["id"]) != str(requirement_id):
        raise NotFoundError("requirement")
    view = build_view(requirement, rows)
    items = [
        {"id": str(uuid.uuid4()), "code": q.code, "line": q.line_no, "text": q.text}
        for q in view.questions
    ]
    done = repo.persist_questions(token, requirement_id, items)
    return QuestionSyncOut(
        requirement_id=requirement_id,
        changed=int(done["changed"]),
        drafts=question_drafts(repo, token, tenant, requirement_id, active_only=True),
    )


def decide_question(
    repo: FollowupsRepository, token: str, draft_id: uuid.UUID, decision: str
) -> QuestionDecisionOut:
    done = repo.decide_question(token, draft_id, decision)
    return QuestionDecisionOut.model_validate(
        {"draft_id": done["draft_id"], "status": done["status"], "replayed": done["replayed"]}
    )
