"""Outbound webhooks (docs/contracts/webhooks-out.md): signing, the SSRF guard, the retry schedule, the guarded sender, the worker pass, and the routes (Owner and Admin only, the secret shown once, the
kill switch). The fake repository answers as migration 20261231992000's functions do (pgTAP 275 pins the database side). No test reaches the network: DNS and the receiver are fakes."""

# ruff: noqa: E501, S104   (S104: 0.0.0.0 is an address we refuse, not one we bind)

from __future__ import annotations

import ipaddress
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from app.tenancy.repository import Forbidden
from app.webhooks_out import signing, ssrf
from app.webhooks_out.retry import BACKOFF_S, MAX_ATTEMPTS, retry_delay
from app.webhooks_out.runner import WebhookRunner, body_bytes
from app.webhooks_out.sender import MAX_BODY, Sender
from app.webhooks_out.service import WebhooksOut, secret_name
from app.workspace_secrets import FakeSecretStore
from tests.aw_fakes import _uid
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/developer/webhooks"
WORKER = "worker-token"
PUBLIC = "93.184.216.34"


def dns(mapping: dict[str, list[str]] | None = None) -> ssrf.Resolver:
    table = {"hooks.example.com": [PUBLIC], **(mapping or {})}
    return lambda host, port: table.get(host, [])


# ============================================================================ signing
def test_the_signature_is_the_documented_hmac_and_a_receiver_can_check_it() -> None:
    secret = signing.new_secret()
    assert secret.startswith("whsec_") and len(secret) == 38 and signing.last4(secret) == secret[-4:]
    assert secret != signing.new_secret()
    body = b'{"id":"evt_1"}'
    value = signing.header("whsec_x", 1_700_000_000, body)
    assert value.startswith("t=1700000000,v1=") and len(value) == len("t=1700000000,v1=") + 64
    import hashlib
    import hmac

    assert value.split("v1=")[1] == hmac.new(b"whsec_x", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert signing.verify("whsec_x", value, body, now=1_700_000_100)


def test_a_wrong_secret_a_changed_body_an_old_stamp_or_a_malformed_header_fail() -> None:
    body = b'{"a":1}'
    value = signing.header("whsec_x", 1_700_000_000, body)
    assert not signing.verify("whsec_y", value, body, now=1_700_000_000)
    assert not signing.verify("whsec_x", value, body + b" ", now=1_700_000_000)
    assert not signing.verify("whsec_x", value, body, now=1_700_000_000 + 301)
    assert signing.verify("whsec_x", value, body, now=1_700_000_000 + 300)
    for bad in ("", "t=1,v1=zz", "v1=" + "a" * 64, f"t=1700000000,v1={'A' * 64}", value + ",v0=x"):
        assert not signing.verify("whsec_x", bad, body, now=1_700_000_000)


# ============================================================================ the retry schedule
def test_the_backoff_is_1m_5m_30m_2h_6h_then_a_dead_letter() -> None:
    assert BACKOFF_S == (60, 300, 1800, 7200, 21600) and MAX_ATTEMPTS == 6
    assert [retry_delay(n, "call.completed") for n in range(1, 8)] == [60, 300, 1800, 7200, 21600, None, None]
    assert retry_delay(0, "call.completed") is None
    assert retry_delay(1, "test.ping") is None, "a test event is never retried"


# ============================================================================ the SSRF guard
@pytest.mark.parametrize("url", [
    "http://hooks.example.com/x", "ftp://hooks.example.com/x", "//hooks.example.com/x", "hooks.example.com/x", "https:hooks.example.com",
])
def test_only_https_is_accepted(url: str) -> None:
    with pytest.raises(ssrf.UnsafeUrl) as caught:
        ssrf.check_url(url)
    assert caught.value.reason in ("scheme", "host", "length")


@pytest.mark.parametrize("url", [
    "https://127.0.0.1/x", "https://localhost/x", "https://LOCALHOST./x", "https://10.0.0.5/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://[::ffff:127.0.0.1]/x",
    "https://2130706433/x", "https://0x7f.1/x", "https://0177.0.0.1/x", "https://metadata.google.internal/computeMetadata/v1/", "https://printer.local/x", "https://db.internal/x",
    "https://nodots/x", "https://user:pass@hooks.example.com/x", "https://hooks.example.com@evil.example.org/x", "https://hooks.example.com:80/x", "https://hooks.example.com:22/x",
    "https://hooks.example.com/x#frag", "https://hooks .example.com/", "https://hooks.example.com:99999/x", "https://" + "a" * 300 + ".example.com/x", "https://ünicode.example.com/x",
])
def test_addresses_that_aim_at_our_own_network_are_refused_before_any_lookup(url: str) -> None:
    with pytest.raises(ssrf.UnsafeUrl):
        ssrf.check_url(url)


@pytest.mark.parametrize("url", ["https://hooks.example.com/x", "https://hooks.example.com", "https://hooks.example.com:443/a/b?c=d", "https://hooks.example.com:8443/x", "https://n8n.my-shop.in/webhook/abc-123"])
def test_good_addresses_pass(url: str) -> None:
    target = ssrf.check_url(url)
    assert target.host.endswith((".com", ".in")) and target.port in (443, 8443) and target.path.startswith("/")


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "240.0.0.1", "255.255.255.255", "192.0.0.1", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "ff02::1",
])
def test_non_public_addresses_are_refused(address: str) -> None:
    assert not ssrf.is_public_ip(ipaddress.ip_address(address))


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_pass(address: str) -> None:
    assert ssrf.is_public_ip(ipaddress.ip_address(address))


def test_a_name_that_points_at_a_private_address_is_refused_after_the_lookup() -> None:
    resolver = dns({"evil.example.com": ["10.0.0.7"], "mixed.example.com": [PUBLIC, "169.254.169.254"], "ghost.example.com": [], "v6.example.com": ["::1"]})
    for host, reason in (("evil.example.com", "private"), ("mixed.example.com", "private"), ("ghost.example.com", "dns"), ("v6.example.com", "private")):
        with pytest.raises(ssrf.UnsafeUrl) as caught:
            ssrf.validate(f"https://{host}/x", resolver)
        assert caught.value.reason == reason
    assert ssrf.validate("https://hooks.example.com/x", resolver).host == "hooks.example.com"


# ============================================================================ the guarded sender
class Receiver:
    """A receiver behind httpx's mock transport: records what arrived and answers what it is told."""

    def __init__(self, status: int = 200, *, raises: Exception | None = None, location: str | None = None) -> None:
        self.status, self.raises, self.location = status, raises, location
        self.seen: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        if self.raises is not None:
            raise self.raises
        return httpx.Response(self.status, headers={"Location": self.location} if self.location else {}, text="the other side's words must never come back")


def sender(receiver: Receiver, mapping: dict[str, list[str]] | None = None) -> Sender:
    return Sender(resolver=dns(mapping), transport=httpx.MockTransport(receiver))


def test_the_sender_connects_to_the_checked_address_and_keeps_the_hosts_name() -> None:
    receiver = Receiver(200)
    result = sender(receiver).post("https://hooks.example.com/in?k=1", b"{}", {"Stack19-Event": "lead.created"})
    assert result.ok and result.status == 200 and result.error is None
    request = receiver.seen[0]
    assert request.url.host == PUBLIC and request.url.path == "/in" and request.url.params["k"] == "1", "it connects to the address it checked"
    assert request.headers["host"] == "hooks.example.com" and request.extensions["sni_hostname"] == "hooks.example.com"
    assert request.headers["stack19-event"] == "lead.created" and request.content == b"{}"


@pytest.mark.parametrize(("status", "ok", "error"), [(200, True, None), (204, True, None), (301, False, "redirect"), (302, False, "redirect"), (308, False, "redirect"), (400, False, "status"), (410, False, "status"), (500, False, "status"), (503, False, "status")])
def test_only_a_2xx_is_delivered_and_a_redirect_is_never_followed(status: int, ok: bool, error: str | None) -> None:
    receiver = Receiver(status, location="https://127.0.0.1/admin")
    result = sender(receiver).post("https://hooks.example.com/x", b"{}", {})
    assert (result.ok, result.error, result.status) == (ok, error, status)
    assert len(receiver.seen) == 1, "no second request: a redirect (even to a private address) is not followed"


def test_failures_are_closed_words_never_the_other_sides_text() -> None:
    for exc, word in ((httpx.ConnectTimeout("t"), "timeout"), (httpx.ReadTimeout("t"), "timeout"), (httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"), "tls"),
                      (httpx.ConnectError("connection refused to 1.2.3.4"), "refused"), (httpx.RemoteProtocolError("bad"), "refused")):
        result = sender(Receiver(raises=exc)).post("https://hooks.example.com/x", b"{}", {})
        assert (result.ok, result.error, result.status) == (False, word, None)
        assert "1.2.3.4" not in repr(result)


def test_a_private_name_is_blocked_without_a_request() -> None:
    receiver = Receiver(200)
    s = sender(receiver, {"evil.example.com": ["10.0.0.7"], "ghost.example.com": []})
    assert s.post("https://evil.example.com/x", b"{}", {}).error == "blocked"
    assert s.post("https://ghost.example.com/x", b"{}", {}).error == "dns"
    assert s.post("https://127.0.0.1/x", b"{}", {}).error == "blocked"
    assert s.post("http://hooks.example.com/x", b"{}", {}).error == "blocked"
    assert receiver.seen == []


def test_a_body_over_the_limit_is_not_sent() -> None:
    receiver = Receiver(200)
    assert sender(receiver).post("https://hooks.example.com/x", b"x" * (MAX_BODY + 1), {}).error == "too_large"
    assert receiver.seen == []


def test_the_second_address_is_tried_when_the_first_refuses_and_an_ipv6_one_is_bracketed() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if request.url.host == PUBLIC:
            raise httpx.ConnectError("refused")
        return httpx.Response(200)

    s = Sender(resolver=dns({"two.example.com": [PUBLIC, "2606:4700:4700::1111"]}), transport=httpx.MockTransport(handler))
    assert s.post("https://two.example.com/x", b"{}", {}).ok and calls == [PUBLIC, "2606:4700:4700::1111"]


# ============================================================================ the worker pass
class FakeRepo:
    """The migration's functions in memory: a person's calls (Owner or Admin) and the worker's."""

    def __init__(self) -> None:
        self.endpoints: dict[uuid.UUID, dict[str, Any]] = {}
        self.deliveries: list[dict[str, Any]] = []
        self.recorded: list[tuple[uuid.UUID, bool, int | None, str | None, int | None]] = []
        self.purged = 0

    @staticmethod
    def _manager(token: str) -> None:
        if _uid(token) not in ("a_owner", "a_admin"):
            raise Forbidden("42501")

    def _show(self, e: dict[str, Any]) -> dict[str, Any]:
        return {k: e[k] for k in ("id", "url", "events", "send_transcript", "active", "secret_last4", "secret_version", "created_at")} | {"health": {"status": "failing" if e.get("failing") else "ok"}}

    def endpoints_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._manager(token)
        return [self._show(e) for e in self.endpoints.values() if e["tenant"] == tenant_id]

    def endpoint_create(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str, events: list[str], send_transcript: bool, last4: str) -> dict[str, Any] | None:
        self._manager(token)
        if sum(1 for e in self.endpoints.values() if e["tenant"] == tenant_id) >= 5:
            return None
        self.endpoints[endpoint_id] = {"id": str(endpoint_id), "tenant": tenant_id, "url": url, "events": events, "send_transcript": send_transcript, "active": True, "secret_last4": last4, "secret_version": 1,
                                       "created_at": datetime.now(UTC).isoformat()}
        return self._show(self.endpoints[endpoint_id])

    def endpoint_update(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, url: str | None, events: list[str] | None, active: bool | None, send_transcript: bool | None) -> dict[str, Any] | None:
        self._manager(token)
        e = self.endpoints.get(endpoint_id)
        if e is None or e["tenant"] != tenant_id:
            return None
        e.update({k: v for k, v in (("url", url), ("events", events), ("active", active), ("send_transcript", send_transcript)) if v is not None})
        return self._show(e)

    def endpoint_rotate(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID, last4: str) -> dict[str, Any] | None:
        self._manager(token)
        e = self.endpoints.get(endpoint_id)
        if e is None or e["tenant"] != tenant_id:
            return None
        e["secret_version"] += 1
        e["secret_last4"] = last4
        return self._show(e)

    def endpoint_delete(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> bool:
        self._manager(token)
        e = self.endpoints.get(endpoint_id)
        if e is None or e["tenant"] != tenant_id:
            return False
        del self.endpoints[endpoint_id]
        return True

    def endpoint_test(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID) -> dict[str, Any] | None:
        self._manager(token)
        e = self.endpoints.get(endpoint_id)
        if e is None or e["tenant"] != tenant_id:
            return None
        did = str(uuid.uuid4())
        self.deliveries.append({"id": did, "tenant_id": str(tenant_id), "endpoint_id": str(endpoint_id), "event": "test.ping", "event_id": str(uuid.uuid4()), "attempts": 0, "created_at": datetime.now(UTC).isoformat(),
                                "url": e["url"], "secret_version": e["secret_version"], "data": {"message": "This is a test event from Stack19."}, "status": "pending"})
        return {"delivery_id": did}

    def deliveries_list(self, token: str, tenant_id: uuid.UUID, endpoint_id: uuid.UUID | None, before: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        self._manager(token)
        rows = [d for d in self.deliveries if d["tenant_id"] == str(tenant_id) and (endpoint_id is None or d["endpoint_id"] == str(endpoint_id))]
        rows.sort(key=lambda d: (d["created_at"], d["id"]), reverse=True)
        return [{k: d.get(k) for k in ("id", "endpoint_id", "event", "event_id", "status", "attempts", "created_at")} | {"last_status_code": None, "last_error": None} for d in rows[:limit]]

    def claim(self, worker: str, limit: int) -> list[dict[str, Any]]:
        assert worker == WORKER
        out = [d for d in self.deliveries if d["status"] in ("pending", "retrying")][:limit]
        for d in out:
            d["status"] = "claimed"
        return out

    def record(self, worker: str, delivery_id: uuid.UUID, ok: bool, status: int | None, error: str | None, retry_in_s: int | None) -> dict[str, Any]:
        assert worker == WORKER
        self.recorded.append((delivery_id, ok, status, error, retry_in_s))
        return {"state": "delivered" if ok else ("retrying" if retry_in_s else "dead")}

    def purge(self, worker: str) -> dict[str, Any]:
        self.purged += 1
        return {"deliveries": 0}

    def queue(self, event: str = "lead.created", *, attempts: int = 0, data: dict[str, Any] | None = None, transcript: bool = False) -> dict[str, Any]:
        eid = next(iter(self.endpoints))
        e = self.endpoints[eid]
        row = {"id": str(uuid.uuid4()), "tenant_id": str(e["tenant"]), "endpoint_id": str(eid), "event": event, "event_id": str(uuid.uuid4()), "attempts": attempts, "created_at": "2026-11-25T10:00:00+00:00",
               "url": e["url"], "secret_version": e["secret_version"], "data": data if data is not None else {"lead": {"id": str(uuid.uuid4()), "status": "new"}}, "status": "pending"}
        self.deliveries.append(row)
        return row


def runner_world(receiver: Receiver | None = None, mapping: dict[str, list[str]] | None = None) -> tuple[WebhookRunner, FakeRepo, FakeSecretStore, Receiver, list[float]]:
    repo, store, receiver = FakeRepo(), FakeSecretStore(), receiver or Receiver(200)
    eid = uuid.uuid4()
    repo.endpoints[eid] = {"id": str(eid), "tenant": TENANT_A.id, "url": "https://hooks.example.com/in", "events": ["lead.created"], "send_transcript": False, "active": True, "secret_last4": "abcd",
                           "secret_version": 1, "created_at": "x"}
    store.put(secret_name(TENANT_A.id, eid), "whsec_" + "k" * 32)
    now = [1_700_000_000.0]
    return WebhookRunner(repo, store, sender(receiver, mapping), clock=lambda: now[0], monotonic=lambda: now[0]), repo, store, receiver, now


def test_a_delivery_is_signed_with_the_endpoints_secret_and_recorded() -> None:
    runner, repo, store, receiver, _ = runner_world()
    row = repo.queue()
    assert runner.run(WORKER) == 1
    request = receiver.seen[0]
    secret = "whsec_" + "k" * 32
    assert signing.verify(secret, request.headers["stack19-signature"], request.content, now=1_700_000_000)
    body = json.loads(request.content)
    assert body["id"] == "evt_" + row["event_id"].replace("-", "") and body["type"] == "lead.created" and body["data"] == row["data"]
    assert request.headers["stack19-event-id"] == body["id"] and request.headers["stack19-event"] == "lead.created" and request.headers["stack19-delivery"] == row["id"]
    assert request.headers["content-type"] == "application/json"
    assert repo.recorded == [(uuid.UUID(row["id"]), True, 200, None, None)]
    assert secret not in repr(runner) and secret not in str(repo.recorded)


def test_failures_walk_the_backoff_and_the_sixth_is_a_dead_letter() -> None:
    runner, repo, _, _, _ = runner_world(Receiver(500))
    for attempts in range(6):
        repo.queue(attempts=attempts)
    runner.run(WORKER)
    assert [r[4] for r in repo.recorded] == [60, 300, 1800, 7200, 21600, None]
    assert all(r[1] is False and r[2] == 500 and r[3] == "status" for r in repo.recorded)


def test_a_test_event_is_never_retried_and_a_private_address_is_blocked_and_counted() -> None:
    runner, repo, _, receiver, _ = runner_world(Receiver(500))
    repo.queue("test.ping", data={"message": "hi"})
    runner.run(WORKER)
    assert repo.recorded[-1][3:] == ("status", None)
    runner2, repo2, _, receiver2, _ = runner_world(Receiver(200), {"hooks.example.com": ["10.0.0.7"]})
    repo2.queue()
    runner2.run(WORKER)
    assert receiver2.seen == [] and repo2.recorded[0][1:] == (False, None, "blocked", 60)


def test_a_missing_secret_waits_and_a_rotated_one_takes_effect_at_once() -> None:
    runner, repo, store, receiver, now = runner_world()
    eid = next(iter(repo.endpoints))
    store.delete(secret_name(TENANT_A.id, eid))
    repo.queue()
    runner.run(WORKER)
    assert repo.recorded[-1][3:] == ("no_secret", 60) and receiver.seen == []
    store.put(secret_name(TENANT_A.id, eid), "whsec_" + "n" * 32)
    repo.endpoints[eid]["secret_version"] = 2
    repo.queue()
    runner.run(WORKER)
    assert signing.verify("whsec_" + "n" * 32, receiver.seen[0].headers["stack19-signature"], receiver.seen[0].content, now=int(now[0])), "the new version is read at once, the cached old one is not used"


def test_what_is_gone_is_closed_without_sending_and_a_crash_does_not_stop_the_rest() -> None:
    runner, repo, _, receiver, _ = runner_world()
    repo.queue(data={"gone": True})
    assert runner.run(WORKER) == 1 and receiver.seen == [] and repo.recorded[0][1] is True
    crash = Receiver(raises=RuntimeError("boom"))
    runner2, repo2, _, _, _ = runner_world(crash)
    repo2.queue()
    repo2.queue()
    assert runner2.run(WORKER) == 0 and repo2.recorded == [], "an unexpected error is logged and nothing is recorded: the lease runs out and the delivery is tried again"
    assert len(crash.seen) == 2, "both were tried: one crash did not stop the other"


def test_a_big_transcript_is_left_out_and_said_so_and_a_huge_body_is_dead_at_once() -> None:
    big = {"call": {"id": "c", "transcript": [{"speaker": "caller", "text": "x" * 1000}] * 400}}
    row = {"event_id": str(uuid.uuid4()), "event": "call.completed", "created_at": "2026-11-25T10:00:00+00:00", "data": big}
    raw = body_bytes(row)
    assert raw is not None and len(raw) <= MAX_BODY
    body = json.loads(raw)
    assert body["data"]["call"]["transcript"] is None and body["data"]["truncated"] == ["transcript"]
    row["data"] = {"call": {"id": "c", "summary": "y" * (MAX_BODY + 10)}}
    assert body_bytes(row) is None
    runner, repo, _, _, _ = runner_world()
    queued = repo.queue("call.completed", data={"call": {"summary": "y" * (MAX_BODY + 10)}})
    runner.run(WORKER)
    assert repo.recorded[0] == (uuid.UUID(queued["id"]), False, None, "too_large", None)


def test_the_purge_runs_at_most_once_an_hour() -> None:
    runner, repo, _, _, now = runner_world()
    runner.run(WORKER)
    runner.run(WORKER)
    assert repo.purged == 1
    now[0] += 3601
    runner.run(WORKER)
    assert repo.purged == 2


# ============================================================================ the routes
def world(on: bool = True, store: bool = True) -> tuple[Any, FakeRepo, FakeSecretStore]:
    repo, secrets_store = FakeRepo(), FakeSecretStore()
    service = WebhooksOut(repo, secrets_store if store else None, resolver=dns({"evil.example.com": ["10.0.0.7"], "ghost.example.com": []})) if on else None
    client, _ = make_client(webhooks_out=service)
    return client, repo, secrets_store


def make(client: Any, **extra: Any) -> dict[str, Any]:
    got = client.post(BASE, json={"url": "https://hooks.example.com/in", "events": ["lead.created", "call.completed"], **extra}, headers=auth("a_owner"))
    assert got.status_code == 201, got.text
    return dict(got.json())


def test_the_owner_makes_an_endpoint_and_sees_the_secret_once() -> None:
    client, repo, store = world()
    made = make(client)
    secret, hook = made["secret"], made["webhook"]
    assert secret.startswith("whsec_") and hook["secret_last4"] == secret[-4:] and hook["events"] == ["call.completed", "lead.created"] and hook["send_transcript"] is False
    assert store.access(secret_name(TENANT_A.id, uuid.UUID(hook["id"]))) == secret, "the secret is in the secret store"
    assert secret not in json.dumps(list(repo.endpoints.values()), default=str), "and not in the database"
    listed = client.get(BASE, headers=auth("a_owner")).json()["items"]
    assert len(listed) == 1 and secret not in json.dumps(listed) and "secret" not in listed[0]


def test_an_admin_may_and_sales_and_viewers_and_other_workspaces_may_not() -> None:
    client, _, _ = world()
    body = {"url": "https://hooks.example.com/in", "events": ["lead.created"]}
    assert client.post(BASE, json=body, headers=auth("a_admin")).status_code == 201
    for user in ("a_sales", "a_viewer", "b_owner", "outsider"):
        assert client.post(BASE, json=body, headers=auth(user)).status_code in (403, 404), user
        assert client.get(BASE, headers=auth(user)).status_code in (403, 404), user
    assert client.get(BASE).status_code == 401


def test_bad_addresses_and_events_are_refused_with_a_plain_reason() -> None:
    client, repo, store = world()
    cases = {"http://hooks.example.com/in": "scheme", "https://127.0.0.1/in": "host", "https://localhost/in": "host", "https://169.254.169.254/x": "host", "https://evil.example.com/in": "private",
             "https://ghost.example.com/in": "dns", "https://u:p@hooks.example.com/in": "userinfo", "https://hooks.example.com:22/in": "port", "https://hooks.example.com/" + "a" * 600: "length"}
    for url, reason in cases.items():
        got = client.post(BASE, json={"url": url, "events": ["lead.created"]}, headers=auth("a_owner"))
        assert got.status_code == 422 and got.json()["error"]["code"] == "webhook_url_invalid" and got.json()["error"]["reason"] == reason, (url, got.text)
    assert client.post(BASE, json={"url": "https://hooks.example.com/in", "events": ["lead.deleted"]}, headers=auth("a_owner")).status_code == 422
    assert client.post(BASE, json={"url": "https://hooks.example.com/in", "events": []}, headers=auth("a_owner")).status_code == 422
    assert client.post(BASE, json={"url": "https://hooks.example.com/in", "events": ["lead.created"], "secret": "mine"}, headers=auth("a_owner")).status_code == 422
    assert repo.endpoints == {} and store.secrets == {}, "nothing was made, no secret was written"


def test_five_endpoints_at_most_and_the_extra_secret_is_removed() -> None:
    client, repo, store = world()
    for _ in range(5):
        make(client)
    over = client.post(BASE, json={"url": "https://hooks.example.com/in", "events": ["lead.created"]}, headers=auth("a_owner"))
    assert over.status_code == 409 and over.json()["error"]["code"] == "too_many_webhooks"
    assert len(store.secrets) == 5 and len(repo.endpoints) == 5


def test_rotating_gives_a_new_secret_and_the_old_one_is_gone() -> None:
    client, _, store = world()
    made = make(client)
    hid = made["webhook"]["id"]
    rotated = client.post(f"{BASE}/{hid}/rotate-secret", headers=auth("a_owner")).json()
    assert rotated["secret"] != made["secret"] and rotated["webhook"]["secret_version"] == 2 and rotated["webhook"]["secret_last4"] == rotated["secret"][-4:]
    assert store.access(secret_name(TENANT_A.id, uuid.UUID(hid))) == rotated["secret"]
    assert client.post(f"{BASE}/{uuid.uuid4()}/rotate-secret", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{BASE}/nope/rotate-secret", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{BASE}/{hid}/rotate-secret", headers=auth("a_sales")).status_code == 403


def test_update_checks_the_new_address_and_delete_removes_the_secret() -> None:
    client, _, store = world()
    hid = make(client)["webhook"]["id"]
    ok = client.patch(f"{BASE}/{hid}", json={"events": ["job.outcome"], "active": False, "send_transcript": True}, headers=auth("a_owner")).json()["webhook"]
    assert ok["events"] == ["job.outcome"] and ok["active"] is False and ok["send_transcript"] is True
    bad = client.patch(f"{BASE}/{hid}", json={"url": "https://evil.example.com/in"}, headers=auth("a_owner"))
    assert bad.status_code == 422 and bad.json()["error"]["reason"] == "private"
    assert client.patch(f"{BASE}/{uuid.uuid4()}", json={"active": True}, headers=auth("a_owner")).status_code == 404
    assert client.delete(f"{BASE}/{hid}", headers=auth("a_sales")).status_code == 403
    assert client.delete(f"{BASE}/{hid}", headers=auth("a_owner")).json() == {"deleted": True}
    assert store.secrets == {} and client.get(BASE, headers=auth("a_owner")).json()["items"] == []
    assert client.delete(f"{BASE}/{hid}", headers=auth("a_owner")).status_code == 404


def test_a_test_event_is_queued_and_the_log_shows_it_without_a_body() -> None:
    client, repo, _ = world()
    hid = make(client)["webhook"]["id"]
    queued = client.post(f"{BASE}/{hid}/test", headers=auth("a_owner"))
    assert queued.status_code == 202 and uuid.UUID(queued.json()["delivery_id"])
    assert repo.deliveries[0]["event"] == "test.ping"
    log = client.get(f"{BASE}/{hid}/deliveries", headers=auth("a_admin")).json()
    assert len(log["items"]) == 1 and log["next_before"] is None and "data" not in log["items"][0] and "url" not in log["items"][0]
    assert client.get(f"{BASE}/{uuid.uuid4()}/deliveries", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{BASE}/{hid}/deliveries?before=junk", headers=auth("a_owner")).status_code == 400
    assert client.post(f"{BASE}/{hid}/test", headers=auth("a_sales")).status_code == 403
    assert client.post(f"{BASE}/{uuid.uuid4()}/test", headers=auth("a_owner")).status_code == 404


def test_the_log_pages() -> None:
    client, repo, _ = world()
    hid = make(client)["webhook"]["id"]
    for _ in range(5):
        client.post(f"{BASE}/{hid}/test", headers=auth("a_owner"))
    first = client.get(f"{BASE}/{hid}/deliveries?limit=2", headers=auth("a_owner")).json()
    assert len(first["items"]) == 2 and first["next_before"]
    assert len(repo.deliveries) == 5


def test_the_events_are_listed_in_plain_words() -> None:
    client, _, _ = world()
    items = client.get(f"{BASE}/events", headers=auth("a_owner")).json()["items"]
    assert [i["event"] for i in items] == ["call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome"] and all(i["description"] for i in items)


def test_off_means_not_there_and_no_secret_store_means_unavailable() -> None:
    client, _, _ = world(on=False)
    owner = auth("a_owner")
    body = {"url": "https://hooks.example.com/in", "events": ["lead.created"]}
    for status in (client.get(BASE, headers=owner).status_code, client.post(BASE, json=body, headers=owner).status_code, client.get(f"{BASE}/events", headers=owner).status_code,
                   client.post(f"{BASE}/{uuid.uuid4()}/test", headers=owner).status_code):
        assert status == 404
    client2, repo2, _ = world(store=False)
    assert client2.get(BASE, headers=auth("a_owner")).status_code == 200
    got = client2.post(BASE, json={"url": "https://hooks.example.com/in", "events": ["lead.created"]}, headers=auth("a_owner"))
    assert got.status_code == 503 and got.json()["error"]["code"] == "webhooks_out_unavailable" and repo2.endpoints == {}


def test_the_secret_and_the_address_are_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, _, _ = world()
    made = make(client, url="https://hooks.example.com/in?token=hunter2")
    client.post(f"{BASE}/{made['webhook']['id']}/rotate-secret", headers=auth("a_owner"))
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert made["secret"] not in logged and "hunter2" not in logged and "whsec_" not in logged
