"""The campaigns' dedicated refusals (SQLSTATE SM801 to SM803; job CP, ADR 0086). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py). SM803 also carries a CLOSED
`detail` word the database function chose itself (the first thing that stands between a draft and its approval), shown to the caller as `reason`."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError

# what can stand between a draft and its approval (campaign_issues), one fixed sentence each
NOT_READY_TEXT: dict[str, str] = {
    "no_recipients": "The campaign has nobody on its list.",
    "too_many_recipients": "The list is longer than 5,000 people.",
    "no_template": "The campaign has no approved WhatsApp template yet.",
    "template_not_approved": "The WhatsApp template has not been approved yet.",
    "template_language": "The template is in another language than the campaign.",
    "template_purpose": "The template is not a reminder template.",
    "bad_field": "The text uses a field that does not exist. Use only name, amount, due_date, reference and business.",
    "amount_not_allowed": "This kind of campaign does not carry an amount.",
    "link_not_allowed": "The text may not hold a link.",
    "line_break": "The text must be one line.",
    "text_words": "The text promises something, or reads as a complaint or a price talk it should not.",
    "recipient_missing_amount": "Someone on the list has no amount, but the text uses one.",
    "recipient_missing_reference": "Someone on the list has no reference, but the text uses one.",
    "step_in_quiet_hours": "A step is at a time inside this business's quiet hours.",
    "call_plan_invalid": "The call plan does not fit: only money reminders have a call step, and it must follow a step that exists.",
    "no_future_step": "Every step is already in the past: nothing would be sent.",
}


class CampaignStateError(RepositoryError):
    """SM801: the campaign is not in a state that allows this."""


class CampaignStaleError(RepositoryError):
    """SM802: the samples the Owner saw are not what the campaign now holds."""


class CampaignNotReadyError(RepositoryError):
    """SM803: something stands between this draft and its approval: detail names the first thing."""

    carries_detail = True
    detail: str | None = None
