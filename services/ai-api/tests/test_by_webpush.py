"""Job BY: web-push. RFC 8291's own worked example reproduced byte for byte, a round trip through an independent decryptor, the VAPID header, the sender's answers, and the worker's runner (who is told what,
when, and what is reported). No network: the push service is an httpx mock."""

from __future__ import annotations

import hashlib
import hmac
import json
import struct
import uuid
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.notifications import webpush
from app.notifications.runner import PushRunner, build_payload
from app.notifications.webpush import Subscription, VapidKeys, WebPushSender, b64d, b64e, encrypt
from tests.by_fakes import FakeNotifications

# RFC 8291 appendix A
RFC_AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
RFC_UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw"
RFC_BODY = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"


def test_the_rfc_8291_worked_example_is_reproduced_byte_for_byte() -> None:
    key = ec.derive_private_key(int.from_bytes(b64d(RFC_AS_PRIVATE), "big"), ec.SECP256R1())
    body = encrypt(b"When I grow up, I want to be a watermelon", b64d(RFC_UA_PUBLIC), b64d(RFC_AUTH), as_private=key, salt=b64d(RFC_SALT))
    assert b64e(body) == RFC_BODY


def decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    """The browser's side, written from RFC 8291 section 3.4 independently of `encrypt`."""
    salt, record_size, id_len = body[:16], struct.unpack(">I", body[16:20])[0], body[20]
    as_public, ciphertext = body[21 : 21 + id_len], body[21 + id_len :]
    assert record_size == 4096 and id_len == 65
    ua_public = ua_private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    shared = ua_private.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_public))
    prk_key = hmac.new(auth_secret, shared, hashlib.sha256).digest()
    ikm = hmac.new(prk_key, b"WebPush: info\x00" + ua_public + as_public + b"\x01", hashlib.sha256).digest()
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = hmac.new(prk, b"Content-Encoding: aes128gcm\x00\x01", hashlib.sha256).digest()[:16]
    nonce = hmac.new(prk, b"Content-Encoding: nonce\x00\x01", hashlib.sha256).digest()[:12]
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    assert plain.endswith(b"\x02")
    return plain[:-1]


def browser() -> tuple[ec.EllipticCurvePrivateKey, bytes, str, str]:
    private = ec.generate_private_key(ec.SECP256R1())
    public = private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    auth = uuid.uuid4().bytes
    return private, auth, b64e(public), b64e(auth)


def test_a_fresh_encryption_round_trips_and_never_repeats() -> None:
    private, auth, p256dh, _ = browser()
    first = encrypt(b"Needs you: 2", b64d(p256dh), auth)
    second = encrypt(b"Needs you: 2", b64d(p256dh), auth)
    assert decrypt(first, private, auth) == decrypt(second, private, auth) == b"Needs you: 2"
    assert first != second, "a new salt and a new key every time"
    assert "Needs you" not in first.decode("latin-1")


def test_the_limits_of_the_format_are_enforced() -> None:
    _, auth, p256dh, _ = browser()
    encrypt(b"x" * webpush.MAX_PLAINTEXT, b64d(p256dh), auth)
    with pytest.raises(ValueError):
        encrypt(b"x" * (webpush.MAX_PLAINTEXT + 1), b64d(p256dh), auth)
    with pytest.raises(ValueError):
        encrypt(b"x", b"\x04" + b"\x00" * 10, auth)
    with pytest.raises(ValueError):
        encrypt(b"x", b64d(p256dh), b"short")


def vapid() -> VapidKeys:
    return VapidKeys.parse(b64e(uuid.uuid4().bytes + uuid.uuid4().bytes), "mailto:owner@example.test")


def test_the_vapid_header_carries_a_signed_token_for_the_push_services_origin() -> None:
    keys = vapid()
    header = keys.authorization("https://fcm.googleapis.com/fcm/send/abc", now=1_760_000_000)
    assert header.startswith("vapid t=") and header.endswith(f", k={keys.public_b64}")
    token = header[len("vapid t=") : header.index(", k=")]
    public = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), b64d(keys.public_b64))
    claims = jwt.decode(token, public, algorithms=["ES256"], audience="https://fcm.googleapis.com", options={"verify_exp": False})
    assert claims["sub"] == "mailto:owner@example.test" and claims["aud"] == "https://fcm.googleapis.com" and 0 < claims["exp"] - 1_760_000_000 <= 24 * 3600


def test_vapid_keys_are_checked_at_start() -> None:
    raw = b64e(b"\x01" * 32)
    keys = VapidKeys.parse(raw, "https://example.test/contact")
    assert VapidKeys.parse(raw, "mailto:a@example.test", keys.public_b64).public_b64 == keys.public_b64
    with pytest.raises(ValueError):
        VapidKeys.parse(raw, "owner@example.test")
    with pytest.raises(ValueError):
        VapidKeys.parse("tooshort", "mailto:a@example.test")
    with pytest.raises(ValueError):
        VapidKeys.parse(raw, "mailto:a@example.test", b64e(b"\x04" + b"\x01" * 64))
    assert "key" not in repr(keys).lower() or "private" not in repr(keys).lower(), "the private key is never in a repr"
    assert b64e(b"\x01" * 32) not in repr(keys)


def test_a_vapid_private_key_in_pem_form_is_accepted() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    assert VapidKeys.parse(pem, "mailto:a@example.test").public_b64


def sender_with(handler: Any) -> WebPushSender:
    return WebPushSender(vapid(), client=httpx.Client(transport=httpx.MockTransport(handler)))


def subscription() -> tuple[ec.EllipticCurvePrivateKey, bytes, Subscription]:
    private, auth, p256dh, auth_b64 = browser()
    return private, auth, Subscription(str(uuid.uuid4()), "https://push.example.test/send/abc", p256dh, auth_b64)


def test_the_sender_posts_an_encrypted_body_with_the_standard_headers() -> None:
    private, auth, sub = subscription()
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(201)

    result = sender_with(handler).send(sub, b'{"hello":"world"}')
    (request,) = seen
    assert result.outcome == "ok" and request.url == sub.endpoint
    assert request.headers["content-encoding"] == "aes128gcm" and request.headers["ttl"] == "3600" and request.headers["authorization"].startswith("vapid t=")
    assert decrypt(request.content, private, auth) == b'{"hello":"world"}'


@pytest.mark.parametrize(("status", "outcome"), [(201, "ok"), (200, "ok"), (404, "gone"), (410, "gone"), (429, "failed"), (500, "failed"), (401, "failed"), (400, "failed")])
def test_the_push_services_answers_become_outcomes(status: int, outcome: str) -> None:
    _, _, sub = subscription()
    assert sender_with(lambda r: httpx.Response(status)).send(sub, b"x").outcome == outcome


def test_a_network_failure_is_a_failure_and_logs_no_endpoint(caplog: pytest.LogCaptureFixture) -> None:
    _, _, sub = subscription()

    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with caplog.at_level("DEBUG"):
        assert sender_with(down).send(sub, b"x").outcome == "failed"
    assert "push.example.test" not in caplog.text and "abc" not in caplog.text


def test_a_broken_subscription_key_is_a_failure_not_a_crash() -> None:
    sub = Subscription(str(uuid.uuid4()), "https://push.example.test/x", "AAAA", "AAAA")
    assert sender_with(lambda r: httpx.Response(201)).send(sub, b"x").outcome == "failed"


# ------------------------------------------------------------------------------------------------------------------------ the runner
T = "33333333-3333-4333-8333-333333333333"
U = "44444444-4444-4444-8444-444444444444"
ITEM = {"kind": "outbox_approval", "id": "55555555-5555-4555-8555-555555555555"}


def member(subs: list[Subscription], items: list[dict[str, str]] | None = None) -> dict[str, Any]:
    return {"tenant_id": T, "user_id": U, "items": items if items is not None else [ITEM],
            "subscriptions": [{"id": s.id, "endpoint": s.endpoint, "p256dh": s.p256dh, "auth": s.auth} for s in subs]}  # fmt: skip


def test_the_payload_is_a_fixed_sentence_and_a_count_never_a_name_or_amount() -> None:
    one = json.loads(build_payload(T, [ITEM]))
    assert one["body"] == "A message is waiting for your approval." and one["count"] == 1 and one["kinds"] == {"outbox_approval": 1} and one["tenant_id"] == T and one["title"] == "Needs you"
    many = json.loads(build_payload(T, [ITEM, {"kind": "call_approval", "id": "x"}, {"kind": "call_approval", "id": "y"}]))
    assert many["body"] == "3 things need you." and many["kinds"] == {"outbox_approval": 1, "call_approval": 2}
    assert set(one) == {"v", "tenant_id", "title", "body", "count", "kinds"}


def test_the_runner_sends_to_every_browser_reports_each_and_marks_the_items_told() -> None:
    p1, a1, s1 = subscription()
    p2, a2, s2 = subscription()
    repo = FakeNotifications()
    repo.pending_rows = [member([s1, s2])]
    got: list[bytes] = []

    def accept(request: httpx.Request) -> httpx.Response:
        got.append(request.content)
        return httpx.Response(201)

    result = PushRunner(repo, sender_with(accept)).run("worker-token")
    assert (result.members, result.sent, result.gone, result.failed) == (1, 2, 0, 0)
    assert repo.reports == [(s1.id, "ok"), (s2.id, "ok")] and set(repo.tokens) == {"worker-token"}
    assert len(repo.marked) == 1 and repo.marked[0][2] == [ITEM]
    assert json.loads(decrypt(got[0], p1, a1))["count"] == 1 and json.loads(decrypt(got[1], p2, a2))["body"].startswith("A message")


def test_a_forgotten_browser_is_reported_gone_and_nothing_is_marked_if_nothing_was_delivered() -> None:
    _, _, s1 = subscription()
    repo = FakeNotifications()
    repo.pending_rows = [member([s1])]
    result = PushRunner(repo, sender_with(lambda r: httpx.Response(410))).run("t")
    assert (result.sent, result.gone, result.failed) == (0, 1, 0) and repo.reports == [(s1.id, "gone")] and repo.marked == []


def test_one_good_browser_is_enough_to_count_the_items_told() -> None:
    _, _, s1 = subscription()
    _, _, s2 = subscription()
    repo = FakeNotifications()
    repo.pending_rows = [member([s1, s2])]
    answers = iter([500, 201])
    result = PushRunner(repo, sender_with(lambda r: httpx.Response(next(answers)))).run("t")
    assert (result.sent, result.failed) == (1, 1) and repo.reports == [(s1.id, "failed"), (s2.id, "ok")] and len(repo.marked) == 1


def test_a_member_with_nothing_new_is_skipped_and_a_quiet_pass_logs_nothing(caplog: pytest.LogCaptureFixture) -> None:
    repo = FakeNotifications()
    repo.pending_rows = [member([], items=[])]
    with caplog.at_level("INFO"):
        result = PushRunner(repo, sender_with(lambda r: httpx.Response(201))).run("t")
    assert result.idle() and "push pass" not in caplog.text


def test_the_worker_does_the_push_pass_after_its_tick_and_a_crash_does_not_fail_the_tick() -> None:
    from app.outbox.adapter import LocalFakeAdapter
    from app.scheduler.worker import Worker
    from tests.scheduler_fakes import FakeScheduler
    from tests.test_scheduler_tick import FakeSession

    repo = FakeNotifications()
    runner = PushRunner(repo, sender_with(lambda r: httpx.Response(201)))
    assert Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, push=runner).tick_once() is not None
    assert [c[0] for c in repo.calls] == ["pending"]
    repo.fail_step = "pending"
    assert Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, push=runner).tick_once() is not None, "a failing push pass is logged, the tick is still a tick"
