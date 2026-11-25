"""Opening sign-up (migration 20261231990700; docs/contracts/signup.md): the routes turn the database's closed answers into plain refusals, hash the phone and the code with the server's key, never put a number, an e-mail or a code in a response (except the staging echo), and are off (404) unless SIGNUP_OPEN. A fake repository stands in for the database; its own rules are in pgTAP 279."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any, cast

import pytest

from app.signup.sender import FakeSender, NoSender
from app.signup.service import SignupService, clean_phone
from tests.fakes import TENANT_A, auth, make_client

KEY = b"k" * 32
URL = "/v1/signup"


class FakeRepo:
    def __init__(self) -> None:
        self.start_out: dict[str, Any] = {"ok": True, "expires_in_s": 600}
        self.verify_out: dict[str, Any] = {"ok": True}
        self.claim_out: dict[str, Any] = {"granted": True, "reason": None, "balance_paise": 10000}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def status(self, token: str) -> dict[str, Any]:
        return {"open": True, "terms_version": "2026-11", "privacy_version": "2026-11", "aup_version": "2026-11", "phone_required": True, "email_confirmed": True, "email_blocked": False, "consent_done": False, "phone_verified": False, "trial_claimed": False}

    def consent(self, token: str, kind: str, version: str) -> dict[str, Any]:
        self.calls.append(("consent", (kind, version)))
        return {"ok": True}

    def phone_start(self, token: str, phone_hash: str, code_hash: str, ip_hash: str | None) -> dict[str, Any]:
        self.calls.append(("start", (phone_hash, code_hash, ip_hash)))
        return self.start_out

    def phone_verify(self, token: str, code_hash: str) -> dict[str, Any]:
        self.calls.append(("verify", (code_hash,)))
        return self.verify_out

    def claim(self, token: str, tenant_id: uuid.UUID, ip_hash: str | None = None) -> dict[str, Any]:
        self.calls.append(("claim", (tenant_id, ip_hash)))
        return self.claim_out


def world(sender: Any = None, *, echo: bool = False) -> tuple[Any, FakeRepo, Any]:
    repo = FakeRepo()
    sender = sender if sender is not None else FakeSender(echo=echo)
    client, _ = make_client(signup=SignupService(cast(Any, repo), KEY, sender, echo_code=echo))
    return client, repo, sender


def test_it_is_off_unless_the_service_exists() -> None:
    client, _ = make_client()
    assert client.get(f"{URL}/status", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{URL}/phone/start", json={"phone": "9848012345"}, headers=auth("a_owner")).status_code == 404


def test_a_stranger_is_refused() -> None:
    client, _, _ = world()
    assert client.get(f"{URL}/status").status_code == 401


def test_status_and_consent() -> None:
    client, repo, _ = world()
    assert client.get(f"{URL}/status", headers=auth("a_owner")).json()["terms_version"] == "2026-11"
    assert client.post(f"{URL}/consent", json={"kind": "terms", "version": "2026-11"}, headers=auth("a_owner")).json() == {"ok": True}
    assert repo.calls == [("consent", ("terms", "2026-11"))]
    assert client.post(f"{URL}/consent", json={"kind": "aup", "version": "2026-11"}, headers=auth("a_owner")).json() == {"ok": True}
    assert client.post(f"{URL}/consent", json={"kind": "cookies", "version": "2026-11"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/consent", json={"kind": "terms", "version": "bad version!"}, headers=auth("a_owner")).status_code == 422


def test_the_code_is_sent_and_only_hashes_reach_the_database() -> None:
    client, repo, sender = world()
    r = client.post(f"{URL}/phone/start", json={"phone": "98480 12345"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"ok": True, "expires_in_s": 600}
    (code,) = sender.last.values()
    assert list(sender.last) == ["+919848012345"] and len(code) == 6 and code.isdigit()
    phone_hash, code_hash, ip_hash = repo.calls[0][1]
    for h in (phone_hash, code_hash):
        assert len(h) == 64 and all(c in "0123456789abcdef" for c in h)
    assert "9848012345" not in str(repo.calls) and code not in str(repo.calls)
    assert ip_hash is None or len(ip_hash) == 32
    assert code not in r.text and "9848012345" not in r.text


def test_a_bad_phone_is_refused_before_anything_is_sent() -> None:
    client, repo, sender = world()
    for bad in ("12345", "abcdefghij", "+0098480123456", "12345678901234567890"):
        r = client.post(f"{URL}/phone/start", json={"phone": bad}, headers=auth("a_owner"))
        assert r.status_code == 422, bad
    assert repo.calls == [] and sender.last == {}


def test_the_phone_is_cleaned_to_one_shape() -> None:
    assert clean_phone("98480 12345") == "+919848012345"
    assert clean_phone("+91 98480-12345") == "+919848012345"
    assert clean_phone("919848012345") == "+919848012345"
    assert clean_phone("+14155550123") == "+14155550123"
    assert clean_phone("5848012345") is None and clean_phone("+00 9848012345") is None and clean_phone("") is None


@pytest.mark.parametrize(
    ("out", "status", "code"),
    [
        ({"ok": False, "reason": "closed"}, 409, "signup_closed"),
        ({"ok": False, "reason": "email_unconfirmed"}, 409, "email_unconfirmed"),
        ({"ok": False, "reason": "email_blocked"}, 422, "email_not_allowed"),
        ({"ok": False, "reason": "rate"}, 429, "rate_limited"),
        ({"ok": False, "reason": "phone_taken"}, 409, "phone_taken"),
    ],
)
def test_start_refusals_are_plain_and_nothing_is_sent(out: dict[str, Any], status: int, code: str) -> None:
    client, repo, sender = world()
    repo.start_out = out
    r = client.post(f"{URL}/phone/start", json={"phone": "9848012345"}, headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    assert sender.last == {}
    if code == "rate_limited":
        assert r.headers["retry-after"] == "3600"


def test_no_sender_means_a_plain_503() -> None:
    client, _, _ = world(NoSender())
    r = client.post(f"{URL}/phone/start", json={"phone": "9848012345"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "phone_code_unavailable"


def test_the_echo_returns_the_code_only_when_asked_for() -> None:
    client, _, sender = world(echo=True)
    r = client.post(f"{URL}/phone/start", json={"phone": "9848012345"}, headers=auth("a_owner"))
    assert r.json()["debug_code"] == next(iter(sender.last.values()))


def test_verify_sends_the_hash_of_this_persons_code() -> None:
    client, repo, sender = world()
    client.post(f"{URL}/phone/start", json={"phone": "9848012345"}, headers=auth("a_owner"))
    (code,) = sender.last.values()
    start_code_hash = repo.calls[0][1][1]
    assert client.post(f"{URL}/phone/verify", json={"code": code}, headers=auth("a_owner")).json() == {"ok": True}
    assert repo.calls[1] == ("verify", (start_code_hash,))
    # the same digits from someone else do not hash the same
    client.post(f"{URL}/phone/verify", json={"code": code}, headers=auth("b_owner"))
    assert repo.calls[2][1][0] != start_code_hash
    assert client.post(f"{URL}/phone/verify", json={"code": "12345"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{URL}/phone/verify", json={"code": "abcdef"}, headers=auth("a_owner")).status_code == 422


@pytest.mark.parametrize(
    ("out", "status", "code"),
    [
        ({"ok": False, "reason": "wrong_code", "tries_left": 3}, 422, "code_wrong"),
        ({"ok": False, "reason": "expired"}, 422, "code_expired"),
        ({"ok": False, "reason": "no_code"}, 422, "code_missing"),
        ({"ok": False, "reason": "too_many_tries"}, 429, "code_locked"),
        ({"ok": False, "reason": "phone_taken"}, 409, "phone_taken"),
    ],
)
def test_verify_refusals(out: dict[str, Any], status: int, code: str) -> None:
    client, repo, _ = world()
    repo.verify_out = out
    r = client.post(f"{URL}/phone/verify", json={"code": "123456"}, headers=auth("a_owner"))
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    if "tries_left" in out:
        assert r.json()["error"]["tries_left"] == 3


def test_the_trial_claim_is_the_owners_and_answers_with_words_not_errors() -> None:
    client, repo, _ = world()
    url = f"/v1/tenants/{TENANT_A.id}/billing/trial-claim"
    assert client.post(url, headers=auth("a_admin")).status_code == 403
    assert client.post(url, headers=auth("b_owner")).status_code in (403, 404)
    ok = client.post(url, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json() == {"granted": True, "reason": None, "balance_paise": 10000}
    repo.claim_out = {"granted": False, "reason": "phone_not_verified", "balance_paise": None}
    no = client.post(url, headers=auth("a_owner"))
    assert no.status_code == 200 and no.json()["granted"] is False and no.json()["reason"] == "phone_not_verified"


def test_the_startup_refuses_the_echo_in_production_and_a_missing_key() -> None:
    from app.config import Settings
    from app.main import _signup_service

    class Cfg:
        rest_url = "http://x"
        anon_key = "k"

    base: dict[str, Any] = {"signup_open": True, "suppression_hmac_key": "x" * 32}
    assert _signup_service(Settings(**{**base, "signup_open": False}), cast(Any, Cfg())) is None
    with pytest.raises(RuntimeError):
        _signup_service(Settings(signup_open=True), cast(Any, Cfg()))
    with pytest.raises(RuntimeError):
        _signup_service(Settings(**base, signup_fake_code_echo=True, signup_phone_sender="fake", admin_environment="production"), cast(Any, Cfg()))
    with pytest.raises(RuntimeError):
        _signup_service(Settings(**base, signup_fake_code_echo=True), cast(Any, Cfg()))
    assert _signup_service(Settings(**base, signup_fake_code_echo=True, signup_phone_sender="fake", admin_environment="staging"), cast(Any, Cfg())) is not None


def test_the_whatsapp_sender_posts_an_authentication_template_and_keeps_the_code_out_of_errors() -> None:
    from app.signup.sender import PhoneCodeUnavailable, WhatsAppCodeSender
    from app.whatsapp.graph import GraphResult

    seen: list[tuple[str, str, dict[str, Any]]] = []

    class Graph:
        ok = True

        def post_message(self, number_id: str, token: str, payload: dict[str, Any]) -> GraphResult:
            seen.append((number_id, token, payload))
            return GraphResult(self.ok, 200 if self.ok else 400)

    graph = Graph()
    sender = WhatsAppCodeSender(graph, "111", "tok", "stack19_signup_code")
    sender.send("+919848012345", "123456")
    number_id, token, payload = seen[0]
    assert (number_id, token) == ("111", "tok") and payload["to"] == "919848012345" and payload["type"] == "template"
    template = payload["template"]
    assert template["name"] == "stack19_signup_code" and template["components"][0]["parameters"][0]["text"] == "123456"
    assert template["components"][1]["sub_type"] == "url"
    graph.ok = False
    with pytest.raises(PhoneCodeUnavailable) as err:
        sender.send("+919848012345", "123456")
    assert "123456" not in str(err.value) and "9848012345" not in str(err.value)
