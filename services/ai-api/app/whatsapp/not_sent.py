"""Why a message in a chat did NOT go, in plain words, and what to do next (owner, 16 Nov 2026: "Not sent" must say why and what to try). The facts are already stored on the message (status, reason, failure_code) and on its delivery record (error word):
this only turns those closed words into one fixed sentence each. Nothing here reads customer words. `action` is a closed word the screen can turn into a button: send_template | open_approvals | open_templates | open_consent | open_settings | check_number | wait | none."""

from __future__ import annotations

from typing import Any

# (what happened, what to do, action)
Explain = tuple[str, str, str]

FAILURE: dict[str, Explain] = {
    "window_closed": ("The customer's 24 hours were over, and WhatsApp only allows an approved template after that.", "Send an approved template instead.", "send_template"),
    "template_required": ("This message needs an approved template and none matched.", "Check that the template of this kind is approved (Settings, WhatsApp), then send it again as a template.", "open_templates"),
    "recipient_unreachable": ("WhatsApp could not reach this phone number.", "Check the number, or call the customer.", "check_number"),
    "rejected": ("WhatsApp refused the message. On a test number only the approved test numbers can be messaged.", "Check that the number is on the test list and that the template is approved, then try again.", "open_settings"),
    "rate_limited": ("WhatsApp is limiting messages right now.", "Nothing to do: it is tried again by itself.", "wait"),
    "timeout": ("WhatsApp did not answer in time.", "Nothing to do: it is tried again by itself. If it stays like this, send it again later.", "wait"),
    "adapter_error": ("WhatsApp had a problem on its side.", "Nothing to do: it is tried again by itself. If it stays like this, send it again later.", "wait"),
    "not_configured": ("WhatsApp is not connected for this business.", "Connect the number in Settings, WhatsApp.", "open_settings"),
}
DELIVERY: dict[str, Explain] = {
    "window_closed": FAILURE["window_closed"],
    "unreachable": FAILURE["recipient_unreachable"],
    "not_delivered_health": ("WhatsApp did not deliver it (the number is not in a state to receive it).", "Try again later, or call the customer.", "wait"),
    "rate_limited": FAILURE["rate_limited"],
    "throughput": FAILURE["rate_limited"],
    "spam_limited": ("WhatsApp held it back because many messages from this number were not wanted.", "Wait a day before sending more; send only what the customer asked for.", "wait"),
    "opted_out_marketing": ("This customer chose not to receive promotions.", "Do not send promotions to them; a message they asked for is still fine.", "none"),
    "template_params": ("WhatsApp did not accept the values of the template.", "Open the template and check its values, then send again.", "open_templates"),
    "template_missing": FAILURE["template_required"],
    "template_paused": ("The template is paused by WhatsApp.", "Use another approved template, or wait until it is active again.", "open_templates"),
    "template_disabled": ("The template was disabled by WhatsApp.", "Use another approved template.", "open_templates"),
    "token_expired": ("The WhatsApp connection of this business has expired.", "Connect the number again in Settings, WhatsApp.", "open_settings"),
    "bad_request": ("WhatsApp did not accept the message.", "Check the message and the number, then try again.", "check_number"),
    "other_error": ("WhatsApp could not deliver it.", "Try again; if it keeps failing, tell support.", "wait"),
}
BLOCKED: dict[str, Explain] = {
    "no_inbound_window": ("It is a reply, and a reply goes only within 24 hours of the customer's own message.", "Send an approved template instead.", "send_template"),
    "stopped": ("The customer asked us to stop. Nothing more is sent.", "Do not message them; they can write to you first.", "none"),
    "erased": ("The customer's record was erased. Nothing more is sent.", "Nothing to do.", "none"),
    "no_opt_in": ("The customer has not agreed to WhatsApp messages and has never written to us.", "Get their consent first (Contacts, consent), or wait for them to write.", "open_consent"),
    "no_key": ("The phone number has no stop-check key on record, so it cannot be checked against stops.", "Open the customer and save the number again.", "check_number"),
    "daily_limit": ("This customer already has the day's limit of messages.", "It can go tomorrow.", "wait"),
    "switch_off": ("Sending is switched off for the whole system.", "Nothing to do on your side: it is switched on again by us.", "none"),
    "no_contact": ("This lead has no contact to message.", "Add the customer's phone number.", "check_number"),
    "no_phone": ("The contact has no phone number.", "Add the customer's phone number.", "check_number"),
    "owner_rejected": ("A person rejected it.", "Write a new message if you still want to send one.", "none"),
    "send_failed": ("The channel could not deliver it.", "Send it again as a template if the customer's 24 hours are over.", "send_template"),
    "auto_off": ("Automatic sending is switched off for this business.", "Approve it yourself.", "open_approvals"),
}


def explain(item: dict[str, Any]) -> dict[str, str] | None:
    """For one outgoing message of a thread (`status`, `reason`, `failure_code`, `delivery`, `delivery_error`): null when it went (or is on its way), else {code, text, next_step, action}."""
    if item.get("direction") != "out":
        return None
    status, reason = str(item.get("status") or ""), str(item.get("reason") or "")
    error = item.get("delivery_error")
    if item.get("delivery") == "failed" or (isinstance(error, str) and error and status == "sent" and item.get("delivery") != "delivered"):
        word = str(error or "other_error")
        found = DELIVERY.get(word, DELIVERY["other_error"])
        return _out(word, found)
    if status == "failed":
        word = str(item.get("failure_code") or "send_failed")
        return _out(word, FAILURE.get(word) or BLOCKED["send_failed"])
    if status == "blocked":
        return _out(reason or "blocked", BLOCKED.get(reason) or ("It could not be sent.", "Ask support if you are not sure why.", "none"))
    if status == "needs_approval":
        return _out("needs_approval", ("It is waiting for a person to approve it.", "Open Approvals and approve, edit or reject it.", "open_approvals"))
    if status == "queued" and reason == "quiet_hours":
        return _out("quiet_hours", ("It is waiting for the morning: this business sends no messages at night.", "Nothing to do: it goes by itself.", "wait"))
    return None


def _out(code: str, e: Explain) -> dict[str, str]:
    return {"code": code, "text": e[0], "next_step": e[1], "action": e[2]}
