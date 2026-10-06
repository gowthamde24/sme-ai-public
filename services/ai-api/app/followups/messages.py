"""The fixed sentences of the follow-up refusals (SQLSTATE SM220-SM229, ADR 0022), in plain words: status, error code and one sentence per closed reason (`-` for the codes that carry no reason). Nothing from the data layer reaches a client."""

from __future__ import annotations

FOLLOWUP_REFUSALS: dict[str, tuple[int, str, dict[str, str]]] = {
    "SM220": (
        409,
        "contact_blocked",
        {
            "contact": "This person has asked not to be contacted.",
            "key": "This e-mail address or phone number is on the do-not-contact list.",
            "erased_key": "This e-mail address or phone number belongs to a person who was erased by right and must not be contacted.",
            "erased": "This contact has been erased: nothing new can be recorded about them.",
            "consent": "There is no recorded consent for this channel, or no address for it.",
            "other": "This contact cannot be contacted.",
        },
    ),
    "SM221": (
        409,
        "no_suppression_key",
        {
            "-": "This contact has no suppression key recorded yet, so it cannot be contacted. The owner can record the keys first."
        },
    ),
    "SM222": (
        409,
        "no_followup_policy",
        {"-": "No follow-up policy is in force: the owner must publish one."},
    ),
    "SM223": (
        409,
        "draft_state",
        {
            "exists": "A draft for this follow-up already exists.",
            "not_draft": "That draft is not waiting for approval.",
            "not_approved": "That draft has not been approved yet.",
            "closed": "That is already closed.",
            "other": "That draft is not in a state that allows this.",
        },
    ),
    "SM224": (
        409,
        "followup_stale",
        {
            "-": "Something changed since this draft was made (the touches, the policy, the contact or the suppression state). Make a new draft."
        },
    ),
    "SM225": (
        409,
        "not_due",
        {
            "suppressed": "This lead is flagged do-not-contact, opted out or bounced: there is no follow-up.",
            "replied": "The customer replied: a person takes over.",
            "closed": "This lead is won or lost: there is no follow-up.",
            "max_touches": "The policy's limit of touches is reached.",
            "initial_outreach": "There is no first message yet: the first message is a person's. Record it, then follow-ups can start.",
            "future_history": "A touch is recorded after now: wait until it has passed.",
            "not_yet": "It is not time for the next follow-up yet.",
            "invalid": "The follow-up rules could not read this lead's state.",
            "other": "No follow-up is due.",
        },
    ),
    "SM226": (
        409,
        "followup_mismatch",
        {
            "-": "This follow-up does not match the database's own recomputation. Nothing was changed: try again."
        },
    ),
    "SM227": (
        409,
        "followup_stopped",
        {
            "order_accepted": "An order for this lead was accepted: follow-ups stop.",
            "order_declined": "An order for this lead was declined: follow-ups stop.",
            "order_cancelled": "An order for this lead was cancelled: follow-ups stop.",
            "quote_withdrawn": "The quote for this lead was withdrawn: follow-ups stop.",
            "lead_archived": "This lead is archived: follow-ups stop.",
            "other": "Follow-ups are stopped for this lead.",
        },
    ),
    "SM228": (
        403,
        "not_your_draft",
        {"-": "Only the person who made this draft, an Admin or the Owner can discard it."},
    ),
    "SM229": (
        409,
        "followup_limit",
        {"-": "This lead has reached the limit of recorded touches."},
    ),
}
