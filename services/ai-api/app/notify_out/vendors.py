"""The three chat apps: what the Owner pastes (checked), what a message looks like to each, and what its answer means (a closed word, never the vendor's text).

Slack      an incoming webhook: POST {"text": ...} to https://hooks.slack.com/services/T.../B.../... ; 200 "ok" on success; 400 invalid_payload/no_text, 403, 404 (no_service, channel_not_found, no_active_hooks), 410 (channel_is_archived)
           https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/
Telegram   the Bot API: POST https://api.telegram.org/bot<token>/sendMessage {chat_id, text}; {"ok": true, ...} on success, {"ok": false, "error_code", "description"} otherwise; about 1 message a second to one chat and 20 a minute to a group
           https://core.telegram.org/bots/faq (limits), https://core.telegram.org/bots/api (sendMessage)
Teams      a Workflows webhook ("When a Teams webhook request is received"): POST {"type": "message", "attachments": [an Adaptive Card]} to the workflow's address; the Office 365 connector webhooks were retired in May 2026
           https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
Every call goes through app.outbound_http.GuardedHttp (SSRF guard, no redirect, size and time limits) pinned to the vendor's own host names."""

# ruff: noqa: E501

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from app.notify_out.messages import slack_escape, teams_plain
from app.outbound_http import GuardedHttp, HttpResult

KINDS = ("slack", "telegram", "teams")
KIND_NAMES = {"slack": "Slack", "telegram": "Telegram", "teams": "Microsoft Teams"}
CARD_FIELDS: dict[str, list[dict[str, str]]] = {
    "slack": [{"key": "url", "label": "Webhook address", "hint": "In Slack, make an app, turn on Incoming Webhooks and add one for the channel. Paste the address that starts with https://hooks.slack.com/services/."}],
    "telegram": [
        {"key": "token", "label": "Bot token", "hint": "Message @BotFather on Telegram, make a bot and paste the token it gives you."},
        {"key": "chat_id", "label": "Chat ID", "hint": "Add the bot to your chat or group, send it a message, and paste the chat number (a group's starts with a minus) or @channelname."},
    ],
    "teams": [{"key": "url", "label": "Workflow address", "hint": "In Teams, open the channel's Workflows, choose 'Post to a channel when a webhook request is received', and paste the address it gives you."}],
}

REFUSALS = {
    "secret_required": "Paste the address or token for this connection first.",
    "slack_url": "That is not a Slack incoming webhook address. It starts with https://hooks.slack.com/services/.",
    "telegram_token": "That does not look like a Telegram bot token. It looks like 123456789:ABC... and comes from @BotFather.",
    "telegram_chat": "The chat ID is a number (a group's starts with a minus sign) or @channelname.",
    "teams_url": "That is not a Teams workflow address. Make one with the Workflows app in Teams and paste its address.",
    "teams_legacy": "Microsoft stopped the old Teams connector webhooks in May 2026. Make a workflow in the Workflows app and paste its address.",
}

_SLACK_URL = re.compile(r"^https://hooks\.slack\.com/services/T[A-Z0-9]{2,20}/B[A-Z0-9]{2,20}/[A-Za-z0-9]{10,60}$")
_TG_TOKEN = re.compile(r"^[0-9]{5,12}:[A-Za-z0-9_-]{30,50}$")
_TG_CHAT = re.compile(r"^(?:-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$")
_TEAMS_HOSTS = (".logic.azure.com", ".powerplatform.com")   # a Workflows address; verify with a real account (not spelled out on the vendor's pages)
_TEAMS_LEGACY = (".webhook.office.com", ".outlook.office.com")

NO_RETRY = frozenset({"bad_address", "rejected", "blocked", "no_secret", "redirect"})
RETRY_AFTER_FAILURE_S = (60, 300, 1800)   # a message is tried, then again after 1 minute, 5 minutes and 30 minutes; then it has failed


class ChannelInvalid(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def retry_delay(failures: int, reason: str) -> int | None:
    """Seconds until the next try after `failures` failed tries, or None when the message has failed for good."""
    if reason in NO_RETRY or failures < 1 or failures > len(RETRY_AFTER_FAILURE_S):
        return None
    return RETRY_AFTER_FAILURE_S[failures - 1]


def check_secret(kind: str, given: dict[str, str | None], current: dict[str, Any] | None) -> dict[str, str] | None:
    """The value to store: what was pasted, checked, merged with the stored one (a Telegram chat can change alone). None: nothing was pasted (keep what is stored). Raises ChannelInvalid."""
    current = current or {}
    if kind == "telegram":
        token, chat = (given.get("token") or "").strip(), (given.get("chat_id") or "").strip()
        if not token and not chat:
            return None
        token = token or str(current.get("token") or "")
        chat = chat or str(current.get("chat_id") or "")
        if not token:
            raise ChannelInvalid("secret_required")
        if not _TG_TOKEN.fullmatch(token):
            raise ChannelInvalid("telegram_token")
        if not chat:
            raise ChannelInvalid("secret_required")
        if not _TG_CHAT.fullmatch(chat):
            raise ChannelInvalid("telegram_chat")
        return {"token": token, "chat_id": chat}
    url = (given.get("url") or "").strip()
    if not url:
        return None
    if kind == "slack":
        if not _SLACK_URL.fullmatch(url):
            raise ChannelInvalid("slack_url")
        return {"url": url}
    if kind == "teams":
        try:
            parts = urlsplit(url)
            host = (parts.hostname or "").lower()
        except ValueError:
            raise ChannelInvalid("teams_url") from None
        if parts.scheme != "https" or parts.username or parts.password or len(url) > 1500 or not url.isascii() or " " in url:
            raise ChannelInvalid("teams_url")
        if host.endswith(_TEAMS_LEGACY) or host in ("outlook.office.com", "webhook.office.com"):
            raise ChannelInvalid("teams_legacy")
        if not host.endswith(_TEAMS_HOSTS):
            raise ChannelInvalid("teams_url")
        return {"url": url}
    raise ChannelInvalid("secret_required")


def last4_of(secret: dict[str, str]) -> str:
    from app.connector_vault import tail

    return tail(secret.get("url") or secret.get("token") or "")


@dataclass(frozen=True)
class SendOutcome:
    ok: bool
    reason: str | None = None   # bad_address | rejected | rate_limited | timeout | refused | tls | server | blocked | no_secret | redirect
    retry_after_s: int | None = None


def _host_ok(kind: str) -> Any:
    if kind == "slack":
        return lambda host: host == "hooks.slack.com"
    if kind == "telegram":
        return lambda host: host == "api.telegram.org"
    return lambda host: host.endswith(_TEAMS_HOSTS)


def _closed(result: HttpResult, kind: str) -> SendOutcome:
    if result.ok:
        if kind == "telegram" and not (isinstance(result.data, dict) and result.data.get("ok") is True):
            return SendOutcome(False, "rejected")
        return SendOutcome(True)
    err, code = result.error, result.status
    if err in ("timeout", "refused", "tls"):
        return SendOutcome(False, err)
    if err == "redirect":
        return SendOutcome(False, "redirect")
    if err in ("blocked", "host"):
        return SendOutcome(False, "blocked")
    if err == "dns":
        return SendOutcome(False, "refused")
    if err == "too_large":
        return SendOutcome(False, "rejected")
    if code == 429:
        return SendOutcome(False, "rate_limited", result.retry_after_s)
    if code is not None and code >= 500:
        return SendOutcome(False, "server", result.retry_after_s)
    if code in (401, 404, 410):
        return SendOutcome(False, "bad_address")
    if code == 403 and kind != "telegram":
        return SendOutcome(False, "bad_address")
    if code == 400 and kind == "telegram":
        return SendOutcome(False, "bad_address")   # Telegram answers 400 for a chat it cannot find; our own body is always well formed
    return SendOutcome(False, "rejected")


def send(http: GuardedHttp, kind: str, secret: dict[str, Any], text: str) -> SendOutcome:
    """One message to one channel. Never raises; the answer is closed words."""
    try:
        if kind == "slack":
            result = http.post(str(secret["url"]), json_body={"text": slack_escape(text)}, allowed_host=_host_ok("slack"))
        elif kind == "telegram":
            if not _TG_TOKEN.fullmatch(str(secret["token"])) or not _TG_CHAT.fullmatch(str(secret["chat_id"])):
                return SendOutcome(False, "blocked")   # a stored value that is not a bot token (it goes into the address): never sent
            url = f"https://api.telegram.org/bot{secret['token']}/sendMessage"
            result = http.post(url, json_body={"chat_id": secret["chat_id"], "text": text, "disable_web_page_preview": True}, allowed_host=_host_ok("telegram"))
        elif kind == "teams":
            card = {"type": "message", "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json", "type": "AdaptiveCard", "version": "1.2",
                "body": [{"type": "TextBlock", "text": teams_plain(text), "wrap": True}]}}]}
            result = http.post(str(secret["url"]), json_body=card, allowed_host=_host_ok("teams"))
        else:
            return SendOutcome(False, "rejected")
    except KeyError:
        return SendOutcome(False, "no_secret")
    return _closed(result, kind)
