"""The follow-up use cases. The API DECIDES NOTHING: for a draft it reads the lead's recorded state with the caller's own token, builds the cadence request from it
(app/followups/builder.py, the same JSON the database's `app.followup_build` produces), runs the pinned engine (app/followups/cadence_port.py, as of its own clock), and hands the database the
canonical request and result. The database runs the gate (suppression, keys, consent), the stops, rebuilds the request, decides ITSELF whether a follow-up is due and refuses any difference
(SM220-SM227). A touch, a draft and an approval are RECORDS of what a person did; nothing here sends a message, and no request carries wording (the database copies a closed template)."""

from __future__ import annotations

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
    CreateDraftIn,
    CreatePolicyIn,
    DecisionOut,
    DraftOut,
    DraftResultOut,
    DraftStatusOut,
    DueItemOut,
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
    channel: str,
    *,
    now: datetime | None = None,
) -> LeadFollowupOut | None:
    snapshot = repo.lead_snapshot(token, tenant, lead_id)
    if snapshot is None:
        return None
    gate = public_gate(repo.gate(token, lead_id, channel))
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
        channel=channel,  # type: ignore[arg-type]
        gate=GateOut.model_validate(gate),
        decision=decision,
        policy_version_id=None if snapshot.policy is None else uuid.UUID(snapshot.policy.id),
        touches=[
            TouchOut.model_validate(t) for t in repo.list_touches(token, tenant, lead_id, limit=100)
        ],
        drafts=[
            draft_out(d)
            for d in repo.list_drafts(token, tenant, lead_id=lead_id, status=None, limit=50)
        ],
    )


def due_list(
    repo: FollowupsRepository,
    token: str,
    tenant: uuid.UUID,
    *,
    limit: int = 30,
    now: datetime | None = None,
) -> list[DueItemOut]:
    """What a person could do about follow-ups right now, from real backend state: the leads with an outbound touch that the database has not stopped and the gate does not block for e-mail, each put to the pinned engine. Computed when the page is opened (no scheduler)."""
    moment = now or datetime.now(UTC)
    active = repo.list_drafts(token, tenant, lead_id=None, status="active", limit=200)
    open_drafts = {str(d["lead_id"]): d for d in active}
    items: list[DueItemOut] = []
    for lead_id in repo.recent_outbound_leads(token, tenant, limit=limit):
        gate = repo.gate(token, lead_id, "email")
        if gate.get("stopped") is not None or gate.get("blocked") is not None:
            continue  # stopped by the database (an order, a withdrawn quote, an archived lead) or blocked by the gate for e-mail (opted out, a suppressed shared key, erased, no consent): nothing is due, whatever the engine would say
        snapshot = repo.lead_snapshot(token, tenant, lead_id)
        if snapshot is None:
            continue
        ran = decide(snapshot, moment)
        if ran is None or cadence_port.is_rejected(ran[1]):
            continue
        result = ran[1]
        open_draft = open_drafts.get(str(lead_id))
        items.append(
            DueItemOut(
                lead_id=lead_id,
                action=result["action"],
                reason_code=str(result["reason_code"]),
                touch_number=result["touch_number"],
                next_eligible_at=result["next_eligible_at"],
                open_draft_id=None if open_draft is None else uuid.UUID(str(open_draft["id"])),
            )
        )
    return items


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
