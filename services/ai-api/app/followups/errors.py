"""The database's follow-up refusals as typed exceptions (SQLSTATE SM220 to SM229, ADR 0022). Each class carries NO text from the data layer: the API maps it to a fixed sentence
(app/main.py). The ones that explain themselves (SM220, SM223, SM225, SM227) carry ONE closed reason, taken from the error's DETAIL only when it is on the closed list below, otherwise `other`.
A reason is never a value, a key, an identifier or a name."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError

# the closed lists of reasons per SQLSTATE (the migration's header is the other half of this contract)
REASONS: dict[str, tuple[str, ...]] = {
    "SM220": ("contact", "key", "erased_key", "erased", "consent"),
    "SM223": ("exists", "not_draft", "not_approved", "closed"),
    "SM225": (
        "suppressed",
        "replied",
        "closed",
        "max_touches",
        "initial_outreach",
        "future_history",
        "not_yet",
        "invalid",
    ),
    "SM227": (
        "order_accepted",
        "order_declined",
        "order_cancelled",
        "quote_withdrawn",
        "lead_archived",
    ),
}


class FollowupRefusal(RepositoryError):
    """A refusal of the follow-up family. `sqlstate` is the code; `reason` is one of REASONS[sqlstate] or None (the codes that carry none)."""

    def __init__(self, sqlstate: str, reason: str | None = None) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate
        self.reason = reason


class ContactBlockedError(FollowupRefusal):
    """SM220: this contact cannot be contacted (reason: contact | key | erased_key | erased | consent)."""


class NoSuppressionKeyError(FollowupRefusal):
    """SM221: no suppression key is recorded for this contact and channel (missing data never means "not suppressed")."""


class NoFollowupPolicyError(FollowupRefusal):
    """SM222: no follow-up policy is in force."""


class DraftStateError(FollowupRefusal):
    """SM223: the draft is not in a state that allows this (reason: exists | not_draft | not_approved | closed)."""


class FollowupStaleError(FollowupRefusal):
    """SM224: the history, the policy, the contact or the suppression state moved since the draft was made."""


class NotDueError(FollowupRefusal):
    """SM225: the database finds no follow-up due (reason: suppressed | replied | closed | max_touches | initial_outreach | future_history | not_yet | invalid)."""


class FollowupMismatchError(FollowupRefusal):
    """SM226: the request or the result is not what the database computes."""


class FollowupStoppedError(FollowupRefusal):
    """SM227: follow-ups are stopped for this lead (reason: order_accepted | order_declined | order_cancelled | quote_withdrawn | lead_archived)."""


class DraftNotYoursError(FollowupRefusal):
    """SM228: the draft belongs to someone else (a Sales user discarding another person's draft)."""


class FollowupLimitError(FollowupRefusal):
    """SM229: a limit was reached (500 touches for one lead)."""


SM_ERRORS: dict[str, type[FollowupRefusal]] = {
    "SM220": ContactBlockedError,
    "SM221": NoSuppressionKeyError,
    "SM222": NoFollowupPolicyError,
    "SM223": DraftStateError,
    "SM224": FollowupStaleError,
    "SM225": NotDueError,
    "SM226": FollowupMismatchError,
    "SM227": FollowupStoppedError,
    "SM228": DraftNotYoursError,
    "SM229": FollowupLimitError,
}


def refusal(sqlstate: str, detail: object) -> FollowupRefusal:
    """The exception for a SM22x code; the detail is kept only when it is on the closed list for that code (else `other` for the codes that carry one)."""
    cls = SM_ERRORS[sqlstate]
    allowed = REASONS.get(sqlstate)
    if allowed is None:
        return cls(sqlstate)
    reason = str(detail) if isinstance(detail, str) and detail in allowed else "other"
    return cls(sqlstate, reason)
