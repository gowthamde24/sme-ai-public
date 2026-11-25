"""Notifications out (docs/contracts/commerce-notify.md section C): the three channels, what is accepted, what a message may say, the guarded send, the worker pass and its retry schedule. The fake repository
answers as migration 20261231992345's functions do (the SQL smoke run and pgTAP 292 pin the database side: the rate limit, the collapse, the queueing). No test reaches the network: DNS is a table and the
other side is an httpx MockTransport."""

# ruff: noqa: E501, S105, S106

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any, cast

import httpx
import pytest

from app.connector_vault import ConnectorVault, secret_name
from app.errors import ApiError
from app.notify_out import messages, vendors
from app.notify_out.runner import NotifyRunner
from app.notify_out.service import NotifyOut
from app.outbound_http import GuardedHttp
from app.tenancy.repository import Forbidden
from app.workspace_secrets import FakeSecretStore
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/notify/channels"
PUBLIC = "93.184.216.34"
SLACK = "https://hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"
TEAMS = "https://prod-12.westeurope.logic.azure.com:443/workflows/0123456789abcdef0123456789abcdef/triggers/manual/paths/invoke?api-version=2016-06-01&sig=ZZZZsignatureZZZZ"
TG_TOKEN = "123456789:AAH-abcdefghijklmnopqrstuvwxyz012345"
FULL_PHONE = "+919876543210"
BARE_PHONE = "9876543210"
EMAIL = "ravi.kumar@example.test"
DNS = {"hooks.slack.com": [PUBLIC], "api.telegram.org": [PUBLIC], "prod-12.westeurope.logic.azure.com": [PUBLIC]}


def resolver(extra: dict[str, list[str]] | None = None) -> Any:
    table = {**DNS, **(extra or {})}
    return lambda host, port: table.get(host, [])


class Other:
    """The other side: records what it was sent and answers as told."""

    def __init__(self, status: int = 200, body: Any = "ok") -> None:
        self.status, self.body = status, body
        self.sent: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.sent.append({"host": request.headers.get("host"), "path": request.url.path, "ip": request.url.host, "body": request.content.decode("utf-8")})
        if isinstance(self.body, (dict, list)):
            return httpx.Response(self.status, json=self.body)
        return httpx.Response(self.status, text=str(self.body))


class FakeRepo:
    def __init__(self) -> None:
        self.channels: dict[tuple[uuid.UUID, str], dict[str, Any]] = {}
        self.claimable: list[dict[str, Any]] = []
        self.recorded: list[tuple[uuid.UUID, bool, str | None, int | None]] = []
        self.scans = 0
        self.purges = 0
        self.put_calls: list[dict[str, Any]] = []
        self.deny = False

    def channels_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [c for (t, _k), c in sorted(self.channels.items(), key=lambda kv: kv[0][1]) if t == tenant_id]

    def channel_put(self, token: str, tenant_id: uuid.UUID, kind: str, label: str | None, last4: str | None, events: list[str] | None, fields: list[str] | None, language: str | None) -> dict[str, Any]:
        if self.deny:
            raise Forbidden("42501")
        self.put_calls.append({"kind": kind, "last4": last4, "events": events})
        old = self.channels.get((tenant_id, kind))
        row = old or {"kind": kind, "state": "connected", "label": "", "last4": "", "events": [], "fields": ["name", "outcome", "phone_masked"], "language": "en", "test_passed": False,
                      "health": {"status": "never_sent", "reason": None, "last_sent_at": None}, "counts_24h": {"sent": 0, "failed": 0, "rate_limited": 0}}
        row = dict(row)
        if label is not None:
            row["label"] = label
        if last4 is not None:
            row["last4"], row["test_passed"] = last4, False
        if events is not None:
            row["events"] = events
        if fields is not None:
            row["fields"] = fields
        if language is not None:
            row["language"] = language
        self.channels[(tenant_id, kind)] = row
        return row

    def channel_delete(self, token: str, tenant_id: uuid.UUID, kind: str) -> bool:
        return self.channels.pop((tenant_id, kind), None) is not None

    def channel_test_result(self, token: str, tenant_id: uuid.UUID, kind: str, ok: bool, reason: str | None) -> dict[str, Any] | None:
        row = self.channels.get((tenant_id, kind))
        if row is None:
            return None
        row = dict(row)
        if ok:
            row["test_passed"] = True
            row["events"] = row["events"] or ["call_outcome", "low_balance", "missed_call", "new_lead"]
            row["health"] = {"status": "ok", "reason": None, "last_sent_at": datetime.now(UTC).isoformat()}
        else:
            row["health"] = {"status": "problem", "reason": reason, "last_sent_at": None}
        self.channels[(tenant_id, kind)] = row
        return row

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        rows, self.claimable = self.claimable[:limit], self.claimable[limit:]
        return rows

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, reason: str | None, retry_in_s: int | None) -> dict[str, Any]:
        self.recorded.append((delivery_id, ok, reason, retry_in_s))
        return {"state": "sent" if ok else ("retrying" if retry_in_s else "failed")}

    def scan_low_balance(self, worker: str) -> dict[str, Any]:
        self.scans += 1
        return {"queued": 0}

    def purge(self, worker: str) -> dict[str, Any]:
        self.purges += 1
        return {"deliveries": 0}


def world(on: bool = True, store: bool = True, status: int = 200, body: Any = "ok", dns: dict[str, list[str]] | None = None) -> tuple[Any, FakeRepo, FakeSecretStore, Other, NotifyOut | None]:
    repo, secrets, other = FakeRepo(), FakeSecretStore(), Other(status, body)
    clock = [0.0]
    service = NotifyOut(repo, ConnectorVault(secrets) if store else None, GuardedHttp(resolver=resolver(dns), transport=httpx.MockTransport(other)), clock=lambda: clock[0]) if on else None
    client, _ = make_client()
    object.__setattr__(cast(Any, client.app).state.runtime, "notify_out", service)
    client.clock = clock
    return client, repo, secrets, other, service


def put(client: Any, kind: str, body: dict[str, Any], who: str = "a_owner") -> Any:
    return client.put(f"{BASE}/{kind}", json=body, headers=auth(who))


# ============================================================================ the switch and the roles
def test_with_the_switch_off_every_route_answers_404() -> None:
    client, *_ = world(on=False)
    assert client.get(BASE, headers=auth("a_owner")).status_code == 404
    assert put(client, "slack", {"url": SLACK}).status_code == 404
    assert client.post(f"{BASE}/slack/test", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{BASE}/slack/disconnect", headers=auth("a_owner")).status_code == 404


def test_without_the_secret_store_the_routes_answer_503() -> None:
    client, *_ = world(store=False)
    assert put(client, "slack", {"url": SLACK}).status_code == 503
    assert put(client, "slack", {"url": SLACK}).json()["error"]["code"] == "notify_out_unavailable"


def test_every_member_reads_only_owner_and_admin_change() -> None:
    client, *_ = world()
    for who in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert client.get(BASE, headers=auth(who)).status_code == 200
    for who in ("a_sales", "a_viewer"):
        assert put(client, "slack", {"url": SLACK}, who).status_code == 403
        assert client.post(f"{BASE}/slack/test", headers=auth(who)).status_code == 403
        assert client.post(f"{BASE}/slack/disconnect", headers=auth(who)).status_code == 403
    assert put(client, "slack", {"url": SLACK}, "a_admin").status_code == 200
    assert client.get(BASE, headers=auth("b_owner")).status_code == 404   # another workspace: the one 404


def test_the_list_shows_three_channels_the_choices_and_how_to_connect() -> None:
    client, *_ = world()
    body = client.get(BASE, headers=auth("a_viewer")).json()
    assert [i["kind"] for i in body["items"]] == ["slack", "telegram", "teams"] and {i["state"] for i in body["items"]} == {"not_connected"}
    assert [e["id"] for e in body["events"]] == ["new_lead", "missed_call", "call_outcome", "low_balance"]
    assert {f["id"] for f in body["fields"] if f["default"]} == {"name", "phone_masked", "outcome"} and not any(f["default"] for f in body["fields"] if f["id"] == "reason")
    assert {k["id"]: [f["key"] for f in k["fields"]] for k in body["kinds"]} == {"slack": ["url"], "telegram": ["token", "chat_id"], "teams": ["url"]}
    assert body["limits"] == {"per_minute": 20, "per_hour": 300, "lead_messages_per_minute": 5}


# ============================================================================ connecting
def test_connect_each_channel_the_secret_goes_to_the_vault_and_never_comes_back(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, repo, secrets, _o, _s = world()
    answers = [
        put(client, "slack", {"url": SLACK, "label": "#leads"}),
        put(client, "telegram", {"token": TG_TOKEN, "chat_id": "-1001234567890"}),
        put(client, "teams", {"url": TEAMS, "label": "Sales"}),
    ]
    assert [a.status_code for a in answers] == [200, 200, 200]
    listed = json.dumps(client.get(BASE, headers=auth("a_owner")).json()["items"])   # the card's hints name the vendor; the channels never do
    for a in answers:
        for secret in (SLACK, TEAMS, TG_TOKEN, "-1001234567890", "sig=", "abcdefghijklmnopqrstuvwx", "hooks.slack.com", "logic.azure.com"):
            assert secret not in a.text and secret not in listed
    assert json.loads(secrets.secrets[secret_name(TENANT_A.id, "slack")][-1]) == {"url": SLACK}
    assert json.loads(secrets.secrets[secret_name(TENANT_A.id, "telegram")][-1]) == {"token": TG_TOKEN, "chat_id": "-1001234567890"}
    assert answers[0].json()["channel"]["last4"] == "uvwx" and answers[0].json()["channel"]["events"] == [], "no event is on before a Test passes"
    assert all(SLACK not in r.getMessage() and TG_TOKEN not in r.getMessage() and "sig=" not in r.getMessage() for r in caplog.records)
    assert len(repo.put_calls) == 3


@pytest.mark.parametrize(("kind", "body", "reason"), [
    ("slack", {"url": "http://hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "slack_url"),
    ("slack", {"url": "https://hooks.slack.com.evil.example/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "slack_url"),
    ("slack", {"url": "https://evil.example/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "slack_url"),
    ("slack", {"url": "https://127.0.0.1/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "slack_url"),
    ("slack", {"url": "https://user:pw@hooks.slack.com/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "slack_url"),
    ("slack", {"label": "x"}, "secret_required"),
    ("telegram", {"token": "not-a-token", "chat_id": "1"}, "telegram_token"),
    ("telegram", {"token": TG_TOKEN, "chat_id": "not a chat"}, "telegram_chat"),
    ("telegram", {"token": TG_TOKEN}, "secret_required"),
    ("teams", {"url": "https://outlook.office.com/webhook/abc"}, "teams_legacy"),
    ("teams", {"url": "https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def/ghi"}, "teams_legacy"),
    ("teams", {"url": "https://169.254.169.254/workflows"}, "teams_url"),
    ("teams", {"url": "https://logic.azure.com.evil.example/workflows/x"}, "teams_url"),
    ("teams", {"url": "http://prod-12.westeurope.logic.azure.com/workflows/x"}, "teams_url"),
    ("teams", {"url": "https://evil.example/workflows/x"}, "teams_url"),
])
def test_what_is_not_the_vendors_own_address_is_refused(kind: str, body: dict[str, str], reason: str) -> None:
    client, repo, secrets, _o, _s = world()
    r = put(client, kind, body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "channel_invalid" and r.json()["error"]["reason"] == reason
    assert not repo.channels and not secrets.secrets, "nothing is stored for a refused address"


def test_an_unknown_kind_is_404_and_a_wrong_choice_is_422() -> None:
    client, *_ = world()
    assert put(client, "sms", {"url": SLACK}).status_code == 404
    assert put(client, "slack", {"url": SLACK, "events": ["everything"]}).status_code == 422
    assert put(client, "slack", {"url": SLACK, "fields": ["phone"]}).status_code == 422
    assert put(client, "slack", {"url": SLACK, "extra": 1}).status_code == 422


def test_choices_change_without_the_secret_and_a_new_secret_needs_a_new_test() -> None:
    client, repo, secrets, _o, _s = world()
    put(client, "slack", {"url": SLACK})
    client.post(f"{BASE}/slack/test", headers=auth("a_owner"))
    assert repo.channels[(TENANT_A.id, "slack")]["test_passed"] is True
    r = put(client, "slack", {"events": ["new_lead"], "fields": ["name", "reason"], "language": "te"})
    assert r.status_code == 200 and r.json()["channel"]["events"] == ["new_lead"] and r.json()["channel"]["fields"] == ["name", "reason"] and r.json()["channel"]["test_passed"] is True
    assert len(secrets.secrets[secret_name(TENANT_A.id, "slack")]) == 1, "the stored secret was not touched"
    other = "https://hooks.slack.com/services/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"
    assert put(client, "slack", {"url": other}).json()["channel"]["test_passed"] is False


def test_a_telegram_chat_can_change_alone_and_keeps_the_token() -> None:
    client, _r, secrets, _o, _s = world()
    put(client, "telegram", {"token": TG_TOKEN, "chat_id": "111"})
    assert put(client, "telegram", {"chat_id": "@salesroom"}).status_code == 200
    assert json.loads(secrets.secrets[secret_name(TENANT_A.id, "telegram")][-1]) == {"token": TG_TOKEN, "chat_id": "@salesroom"}


def test_a_refused_database_write_leaves_no_secret_behind() -> None:
    client, repo, secrets, _o, _s = world()
    repo.deny = True
    assert put(client, "slack", {"url": SLACK}).status_code == 403
    assert not secrets.secrets.get(secret_name(TENANT_A.id, "slack"))


# ============================================================================ the Test message
def test_the_test_message_is_one_fixed_line_to_slack() -> None:
    client, repo, _s, other, _svc = world()
    put(client, "slack", {"url": SLACK})
    r = client.post(f"{BASE}/slack/test", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["reason"] is None
    assert len(other.sent) == 1 and other.sent[0]["host"] == "hooks.slack.com" and other.sent[0]["path"].startswith("/services/T0AAAAAAA/")
    assert json.loads(other.sent[0]["body"]) == {"text": messages.test_text("en")}
    assert r.json()["channel"]["test_passed"] is True and r.json()["channel"]["events"] == ["call_outcome", "low_balance", "missed_call", "new_lead"], "a pass switches the four events on"
    assert repo.channels[(TENANT_A.id, "slack")]["test_passed"]


def test_the_test_message_to_telegram_and_teams_has_each_vendors_shape(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, _r, _s, other, _svc = world(body={"ok": True, "result": {"message_id": 5}})
    put(client, "telegram", {"token": TG_TOKEN, "chat_id": "-1001234567890"})
    put(client, "teams", {"url": TEAMS})
    assert client.post(f"{BASE}/telegram/test", headers=auth("a_owner")).json()["ok"] is True
    tg = other.sent[0]
    assert tg["host"] == "api.telegram.org" and tg["path"] == f"/bot{TG_TOKEN}/sendMessage"
    assert json.loads(tg["body"]) == {"chat_id": "-1001234567890", "text": messages.test_text("en"), "disable_web_page_preview": True}
    client.clock[0] += 60
    assert client.post(f"{BASE}/teams/test", headers=auth("a_owner")).json()["ok"] is True
    card = json.loads(other.sent[1]["body"])
    assert other.sent[1]["host"] == "prod-12.westeurope.logic.azure.com" and card["type"] == "message"
    assert card["attachments"][0]["contentType"] == "application/vnd.microsoft.card.adaptive" and card["attachments"][0]["content"]["body"][0]["text"] == messages.test_text("en")
    assert all(TG_TOKEN not in r.getMessage() and "sig=" not in r.getMessage() and "-1001234567890" not in r.getMessage() for r in caplog.records)


def test_a_failed_test_shows_a_closed_reason_and_never_the_vendors_text() -> None:
    client, repo, _s, _o, _svc = world(status=404, body="no_service")
    put(client, "slack", {"url": SLACK})
    r = client.post(f"{BASE}/slack/test", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["ok"] is False and r.json()["reason"] == "bad_address" and "no_service" not in r.text
    assert repo.channels[(TENANT_A.id, "slack")]["health"] == {"status": "problem", "reason": "bad_address", "last_sent_at": None}


def test_the_test_button_is_paced_per_channel() -> None:
    client, *_ = world()
    put(client, "slack", {"url": SLACK})
    assert client.post(f"{BASE}/slack/test", headers=auth("a_owner")).status_code == 200
    again = client.post(f"{BASE}/slack/test", headers=auth("a_owner"))
    assert again.status_code == 429 and again.json()["error"]["code"] == "asked_too_soon"
    client.clock[0] += 11
    assert client.post(f"{BASE}/slack/test", headers=auth("a_owner")).status_code == 200


def test_testing_a_channel_that_is_not_connected_is_404_and_a_lost_secret_is_a_closed_reason() -> None:
    client, _r, secrets, _o, _s = world()
    assert client.post(f"{BASE}/slack/test", headers=auth("a_owner")).status_code == 404
    put(client, "slack", {"url": SLACK})
    secrets.secrets.clear()
    assert client.post(f"{BASE}/slack/test", headers=auth("a_owner")).json()["reason"] == "no_secret"


@pytest.mark.parametrize(("status", "kind", "reason"), [
    (400, "slack", "rejected"), (403, "slack", "bad_address"), (404, "slack", "bad_address"), (410, "slack", "bad_address"), (429, "slack", "rate_limited"), (500, "slack", "server"), (503, "slack", "server"),
    (302, "slack", "redirect"), (400, "telegram", "bad_address"), (401, "telegram", "bad_address"), (403, "telegram", "rejected"), (429, "telegram", "rate_limited"),
    (401, "teams", "bad_address"), (400, "teams", "rejected"), (429, "teams", "rate_limited"),
])
def test_the_vendors_answers_become_closed_words(status: int, kind: str, reason: str) -> None:
    other = Other(status, {"ok": False, "description": "Bad Request: chat not found"})
    http = GuardedHttp(resolver=resolver(), transport=httpx.MockTransport(other))
    secret = {"slack": {"url": SLACK}, "telegram": {"token": TG_TOKEN, "chat_id": "1"}, "teams": {"url": TEAMS}}[kind]
    out = vendors.send(http, kind, secret, "hello")
    assert (out.ok, out.reason) == (False, reason)


def test_a_telegram_200_that_says_not_ok_is_not_a_success() -> None:
    http = GuardedHttp(resolver=resolver(), transport=httpx.MockTransport(Other(200, {"ok": False})))
    assert vendors.send(http, "telegram", {"token": TG_TOKEN, "chat_id": "1"}, "hi") == vendors.SendOutcome(False, "rejected")


# ============================================================================ the SSRF guard
def test_a_secret_that_was_tampered_with_cannot_reach_another_host_or_a_private_address() -> None:
    other = Other()
    http = GuardedHttp(resolver=resolver({"evil.example": [PUBLIC], "hooks.slack.com": ["10.0.0.5"]}), transport=httpx.MockTransport(other))
    assert vendors.send(http, "slack", {"url": "https://evil.example/services/T0AAAAAAA/B0BBBBBBB/abcdefghijklmnopqrstuvwx"}, "x").reason == "blocked"
    assert vendors.send(http, "slack", {"url": SLACK}, "x").reason == "blocked", "a name that points at a private address"
    assert vendors.send(http, "teams", {"url": "https://169.254.169.254/workflows"}, "x").reason == "blocked"
    assert vendors.send(http, "teams", {"url": "http://prod-12.westeurope.logic.azure.com/x"}, "x").reason == "blocked"
    assert vendors.send(http, "telegram", {"token": "1/../../x", "chat_id": "1"}, "x").reason == "blocked"
    assert other.sent == [], "nothing left this server"


def test_a_redirect_is_never_followed() -> None:
    other = Other(302, "")
    http = GuardedHttp(resolver=resolver(), transport=httpx.MockTransport(other))
    assert vendors.send(http, "slack", {"url": SLACK}, "x").reason == "redirect" and len(other.sent) == 1


# ============================================================================ what a message says
def test_the_phone_in_a_message_is_always_masked_and_a_leaked_one_is_dropped() -> None:
    row = {"name": f"Ravi {BARE_PHONE}", "phone_masked": FULL_PHONE, "reason": f"Call me on {BARE_PHONE} or at {EMAIL} about the red saree", "outcome": "positive", "category": "interested"}
    clean = messages.safe_data(row)
    assert "phone_masked" not in clean, "a full number is not a masked one"
    text = messages.build_text("call_outcome", row)
    assert BARE_PHONE not in text and FULL_PHONE not in text and EMAIL not in text and "example.test" not in text
    assert text == "Call result: Ravi - Interested (Call me on or at about the red saree)"
    ok = messages.build_text("call_outcome", {**row, "phone_masked": "+91 987XXXXXXX", "reason": None})
    assert ok == "Call result: Ravi, +91 987XXXXXXX - Interested"
    assert messages.build_text("missed_call", {"phone_masked": "XXXXXXX4321"}) == "Missed call: Unknown caller, XXXXXXX4321"


def test_the_default_fields_are_name_masked_phone_and_outcome_and_nothing_else_gets_in() -> None:
    assert messages.build_text("new_lead", {"name": "Asha", "phone_masked": "+91 900XXXXXXX", "reason": "private words", "email": EMAIL, "city": "Pune", "transcript": "hello", "amount": 5000}) == "New lead: Asha, +91 900XXXXXXX"
    assert messages.build_text("new_lead", {}) == "New lead"
    assert messages.build_text("low_balance", {"name": "Asha"}) == messages.PHRASES["en"]["low_balance"]
    assert messages.build_text("new_lead_summary", {}, more=12) == "and 12 more new leads"
    assert messages.build_text("new_lead", {"name": "<!channel> & <https://evil.example|click>"}, "en") == "New lead: <!channel> & <https://evil.example|click>", "the text is plain; each vendor's escaping is applied when it is sent"
    assert vendors.send is not None and messages.slack_escape("<!channel> & x") == "&lt;!channel&gt; &amp; x"


def test_every_language_has_every_phrase() -> None:
    en = set(messages.PHRASES["en"])
    for language in ("te", "hi", "kn"):
        assert set(messages.PHRASES[language]) == en, language
        assert "{n}" in messages.PHRASES[language]["summary"]
    assert all(messages.build_text("call_outcome", {"outcome": "negative", "category": c}, lang) for c in messages.CATEGORIES for lang in messages.LANGUAGES)


def test_slack_gets_the_text_escaped_so_a_name_cannot_mention_the_channel() -> None:
    other = Other()
    http = GuardedHttp(resolver=resolver(), transport=httpx.MockTransport(other))
    vendors.send(http, "slack", {"url": SLACK}, "New lead: <!channel> & co")
    assert json.loads(other.sent[0]["body"]) == {"text": "New lead: &lt;!channel&gt; &amp; co"}


# ============================================================================ the worker pass
TENANT = TENANT_A.id


def _row(n: int = 1, kind: str = "slack", event: str = "new_lead", data: dict[str, Any] | None = None, attempts: int = 0, channel: str | None = None, more: int = 0, language: str = "en") -> dict[str, Any]:
    return {"id": str(uuid.UUID(int=0x9000 + n)), "tenant_id": str(TENANT), "channel_id": channel or str(uuid.UUID(int=0x7000)), "kind": kind, "event": event, "attempts": attempts, "language": language,
            "more": more, "created_at": "2026-11-25T08:00:00+00:00", "data": data or {}}


def runner_world(status: int = 200, body: Any = None) -> tuple[NotifyRunner, FakeRepo, FakeSecretStore, Other, list[float], list[float]]:
    repo, secrets, other = FakeRepo(), FakeSecretStore(), Other(status, {"ok": True} if body is None else body)
    vault = ConnectorVault(secrets)
    vault.put(TENANT, "slack", {"url": SLACK})
    vault.put(TENANT, "telegram", {"token": TG_TOKEN, "chat_id": "5"})
    vault.put(TENANT, "teams", {"url": TEAMS})
    now, slept = [1000.0], []

    def sleep(s: float) -> None:
        slept.append(s)
        now[0] += s

    runner = NotifyRunner(repo, vault, GuardedHttp(resolver=resolver(), transport=httpx.MockTransport(other)), monotonic=lambda: now[0], sleep=sleep)
    return runner, repo, secrets, other, now, slept


def test_the_worker_sends_each_claimed_message_with_only_the_allowed_fields(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    runner, repo, _s, other, _n, _sl = runner_world()
    leak = {"name": "Ravi Kumar", "phone_masked": "+91 987XXXXXXX", "email": EMAIL, "phone": FULL_PHONE, "reason": f"mail {EMAIL} or {BARE_PHONE}", "transcript": "a long talk"}
    repo.claimable = [_row(1, data=leak), _row(2, kind="teams", event="missed_call", data={"phone_masked": "XXXXXXX4321"}, channel=str(uuid.UUID(int=0x7001))),
                      _row(3, kind="telegram", event="call_outcome", data={**leak, "outcome": "negative", "category": "not_interested"}, channel=str(uuid.UUID(int=0x7002))), _row(4, kind="slack", event="low_balance", channel=str(uuid.UUID(int=0x7003)))]
    assert runner.run("worker-token") == 4
    assert [r[1:] for r in repo.recorded] == [(True, None, None)] * 4
    bodies = "\n".join(s["body"] for s in other.sent)
    for banned in (FULL_PHONE, BARE_PHONE, EMAIL, "example.test", "transcript", "a long talk", "ravi.kumar"):
        assert banned not in bodies and banned not in caplog.text, banned
    assert "Ravi Kumar, +91 987XXXXXXX" in bodies and "XXXXXXX4321" in bodies and "Not interested" in bodies and messages.PHRASES["en"]["low_balance"] in bodies
    assert all(TG_TOKEN not in r.getMessage() and SLACK not in r.getMessage() and "sig=" not in r.getMessage() for r in caplog.records)
    assert repo.scans == 1 and repo.purges == 1


@pytest.mark.parametrize(("attempts", "retry"), [(0, 60), (1, 300), (2, 1800), (3, None)])
def test_a_server_error_is_tried_again_after_1_5_and_30_minutes_then_it_has_failed(attempts: int, retry: int | None) -> None:
    runner, repo, *_ = runner_world(status=503)
    repo.claimable = [_row(1, attempts=attempts)]
    runner.run("t")
    assert repo.recorded[0][1:] == (False, "server", retry)


def test_a_dead_address_is_never_retried_and_a_rate_limit_waits_at_least_the_vendors_time() -> None:
    runner, repo, *_ = runner_world(status=404)
    repo.claimable = [_row(1)]
    runner.run("t")
    assert repo.recorded[0][1:] == (False, "bad_address", None)
    assert vendors.retry_delay(1, "rate_limited") == 60 and vendors.retry_delay(1, "blocked") is None and vendors.retry_delay(0, "timeout") is None


def test_a_message_whose_secret_is_gone_fails_as_no_secret() -> None:
    runner, repo, secrets, other, *_ = runner_world()
    secrets.secrets.clear()
    repo.claimable = [_row(1)]
    runner.run("t")
    assert repo.recorded[0][1:] == (False, "no_secret", None) and other.sent == []


def test_one_crash_does_not_stop_the_others_and_a_refused_token_is_raised() -> None:
    from app.tenancy.repository import TokenRejected

    runner, repo, _s, other, *_ = runner_world()
    bad = _row(1)
    bad["tenant_id"] = "not-a-uuid"
    repo.claimable = [bad, _row(2, channel=str(uuid.UUID(int=0x7777)))]
    assert runner.run("t") == 1 and len(other.sent) == 1

    class Rejecting(FakeRepo):
        def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
            raise TokenRejected("x")

    runner._repo = Rejecting()  # noqa: SLF001
    with pytest.raises(TokenRejected):
        runner.run("t")


def test_messages_to_one_channel_are_paced_a_second_apart_for_slack() -> None:
    runner, repo, _s, _o, _n, slept = runner_world()
    repo.claimable = [_row(1), _row(2), _row(3, channel=str(uuid.UUID(int=0x7001)))]
    runner.run("t")
    assert slept == [1.0], "the second message to the same channel waits; another channel does not"


def test_the_low_balance_scan_and_the_clean_up_run_at_most_every_ten_minutes_and_an_hour() -> None:
    runner, repo, _s, _o, now, _sl = runner_world()
    runner.run("t")
    runner.run("t")
    assert (repo.scans, repo.purges) == (1, 1)
    now[0] += 601
    runner.run("t")
    assert (repo.scans, repo.purges) == (2, 1)
    now[0] += 3600
    runner.run("t")
    assert (repo.scans, repo.purges) == (3, 2)


def test_a_summary_message_says_how_many_more_leads_came_in() -> None:
    runner, repo, _s, other, *_ = runner_world()
    repo.claimable = [_row(1, event="new_lead_summary", more=12)]
    runner.run("t")
    assert json.loads(other.sent[0]["body"]) == {"text": "and 12 more new leads"}


def test_the_message_is_in_the_channels_language() -> None:
    runner, repo, _s, other, *_ = runner_world()
    repo.claimable = [_row(1, event="low_balance", language="hi")]
    runner.run("t")
    assert messages.PHRASES["hi"]["low_balance"] in json.loads(other.sent[0]["body"])["text"]


# ============================================================================ disconnect
def test_disconnect_removes_the_channel_and_its_secret() -> None:
    client, repo, secrets, _o, _s = world()
    put(client, "slack", {"url": SLACK})
    r = client.post(f"{BASE}/slack/disconnect", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"disconnected": True}
    assert not repo.channels and not secrets.secrets.get(secret_name(TENANT_A.id, "slack"))
    assert client.post(f"{BASE}/slack/disconnect", headers=auth("a_owner")).status_code == 404
    assert client.get(BASE, headers=auth("a_owner")).json()["items"][0]["state"] == "not_connected"


def test_the_api_has_no_delete_verb_for_channels() -> None:
    client, *_ = world()
    assert client.delete(f"{BASE}/slack", headers=auth("a_owner")).status_code == 405


def test_apierror_is_the_one_error_shape() -> None:
    assert isinstance(ApiError(503, "notify_out_unavailable", "x"), Exception)
