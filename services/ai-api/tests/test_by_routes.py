"""Job BY: the HTTP side of the team, the shop's basics, the weekly report and the notification feed against in-memory fakes. The role matrix (and the second factor) of every endpoint, WHAT reaches the data
layer with whose token, the fixed sentences of every refusal (no data-layer text), the code shown once and never logged, and that nothing is wired -> 503. The database rules are pgTAP 87 to 89; the real
stack is tests/integration/test_by_web_apis.py."""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

import pytest

from app.integrations.ratelimit import SlidingWindow
from app.notifications.runtime import NotificationsRuntime
from app.notifications.webpush import VapidKeys, b64e
from app.team import errors as e
from app.team import routes as team_routes
from tests.by_fakes import FakeNotifications, FakeTeam, FakeWorkspace
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"
INV = "11111111-1111-4111-8111-111111111111"
USER = "22222222-2222-4222-8222-222222222222"
ROLES = ("a_owner", "a_admin", "a_sales", "a_viewer")


@pytest.fixture(autouse=True)
def _fresh_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(team_routes, "ACCEPT_PER_ADDRESS", SlidingWindow(30, 600))


class World:
    def __init__(self, vapid: bool = True) -> None:
        self.team = FakeTeam()
        self.workspace = FakeWorkspace()
        self.notifications = FakeNotifications()
        keys = VapidKeys.parse(b64e(b"\x07" * 32), "mailto:owner@example.test") if vapid else None
        self.client, _ = make_client(team=self.team, workspace=self.workspace, notifications=NotificationsRuntime(self.notifications, keys))

    def call(self, method: str, path: str, user: str | None, body: Any = None, **claims: Any) -> Any:
        return self.client.request(method, path, json=body, headers=auth(user, **claims) if user else {})


@pytest.fixture
def w() -> World:
    return World()


# ------------------------------------------------------------------------------------------------------------------------ invitations
BODY = {"invitation_id": INV, "role": "sales", "label": "for the new cutter"}


def test_only_owner_and_admin_with_a_second_factor_invite(w: World) -> None:
    for user in ROLES:
        r = w.call("POST", T + "/invitations", user, {**BODY, "invitation_id": str(uuid.uuid4())})
        assert r.status_code == (201 if user in ("a_owner", "a_admin") else 403), user
    assert w.call("POST", T + "/invitations", "a_owner", BODY, aal="aal1").status_code == 403
    assert w.call("POST", T + "/invitations", "outsider", BODY).status_code == 404
    assert w.call("POST", T + "/invitations", None, BODY).status_code == 401
    assert [c[0] for c in w.team.calls] == ["create_invitation", "create_invitation"], "only the two allowed calls reached the data layer"


def test_the_code_comes_once_in_an_uncacheable_answer_and_never_again(w: World) -> None:
    r = w.call("POST", T + "/invitations", "a_owner", BODY)
    assert r.status_code == 201 and r.headers["cache-control"] == "no-store"
    body = r.json()["invitation"]
    assert body["code"] == "7QX2K-M9R4D-0A1B2-C3D4E" and body["status"] == "pending" and body["role"] == "sales"
    again = w.call("POST", T + "/invitations", "a_owner", BODY)
    assert again.status_code == 200 and again.json()["invitation"]["code"] is None and again.json()["invitation"]["replayed"] is True
    listed = w.call("GET", T + "/invitations", "a_admin")
    assert listed.status_code == 200 and "7QX2K" not in listed.text and "code" not in listed.json()["invitations"][0]


def test_the_code_is_never_logged_by_the_api(w: World, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG):
        w.call("POST", T + "/invitations", "a_owner", BODY)
        w.call("POST", "/v1/invitations/accept", "a_sales", {"code": "7QX2K-M9R4D-0A1B2-C3D4E"})
    assert "7QX2K" not in caplog.text and "M9R4D" not in caplog.text


def test_the_body_is_strict_and_owner_is_not_a_role(w: World) -> None:
    for bad in ({**BODY, "role": "owner"}, {**BODY, "role": "janitor"}, {**BODY, "days": 0}, {**BODY, "days": 31}, {**BODY, "days": 7.5}, {**BODY, "label": ""}, {**BODY, "label": "x" * 61}, {**BODY, "extra": 1}, {"role": "sales"}, {**BODY, "invitation_id": "nope"}):
        assert w.call("POST", T + "/invitations", "a_owner", bad).status_code == 422, bad
    assert w.team.calls == []


def test_the_dedicated_refusals_have_their_own_fixed_sentences(w: World) -> None:
    cases = [
        (e.RoleNotAllowedError("SM242"), 403, "role_not_allowed"),
        (e.NoSuchMemberError("SM243"), 404, "not_found"),
        (e.KeepOwnerError("SM244"), 409, "keep_owner"),
        (e.OwnRoleError("SM245"), 409, "own_role"),
        (e.TooManyPendingError("SM246"), 409, "too_many_invitations"),
        (e.AlreadyMemberError("SM247"), 409, "already_member"),
        (e.InvitationNotPendingError("SM248"), 409, "invitation_not_pending"),
    ]
    for error, status, code in cases:
        w.team.fail = error
        r = w.call("POST", T + "/invitations", "a_owner", BODY)
        assert r.status_code == status and r.json()["error"]["code"] == code, code
        assert "SM2" not in r.text
    w.team.fail = None


def test_list_revoke_and_the_team(w: World) -> None:
    w.call("POST", T + "/invitations", "a_owner", BODY)
    assert w.call("GET", T + "/invitations", "a_sales").status_code == 403
    assert w.call("POST", T + f"/invitations/{INV}/revoke", "a_sales").status_code == 403
    assert w.call("POST", T + f"/invitations/{INV}/revoke", "a_owner", aal="aal1").status_code == 403
    assert w.call("POST", T + f"/invitations/{INV}/revoke", "a_admin").json()["invitation"]["status"] == "revoked"
    assert w.call("POST", T + "/invitations/not-a-uuid/revoke", "a_owner").status_code == 404
    assert w.call("POST", T + f"/invitations/{uuid.uuid4()}/revoke", "a_owner").status_code == 404
    for user in ROLES:
        assert w.call("GET", T + "/team", user).status_code == 200, user
    assert w.call("GET", T + "/team", "outsider").status_code == 404


# ------------------------------------------------------------------------------------------------------------------------ accepting
def test_a_signed_in_person_accepts_a_code(w: World) -> None:
    r = w.call("POST", "/v1/invitations/accept", "outsider", {"code": " 7qx2k m9r4d-0a1b2 c3d4e "})
    assert r.status_code == 200 and r.json() == {"status": "joined", "tenant_id": "t1", "tenant_name": "Tenant A", "role": "sales"} and r.headers["cache-control"] == "no-store"
    assert w.team.calls[-1] == ("accept_invitation", " 7qx2k m9r4d-0a1b2 c3d4e "), "the code goes to the database as typed: the database normalises"
    assert w.call("POST", "/v1/invitations/accept", None, {"code": "x"}).status_code == 401


def test_a_wrong_code_is_one_answer_whatever_the_cause(w: World) -> None:
    w.team.accept_answer = {"status": "invalid"}
    r = w.call("POST", "/v1/invitations/accept", "outsider", {"code": "AAAAA-AAAAA-AAAAA-AAAAA"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invitation_invalid"
    w.team.accept_answer = {"status": "locked"}
    r = w.call("POST", "/v1/invitations/accept", "outsider", {"code": "AAAAA-AAAAA-AAAAA-AAAAA"})
    assert r.status_code == 429 and r.json()["error"]["code"] == "invitation_locked"


def test_the_second_factor_and_membership_refusals_pass_through_as_themselves(w: World) -> None:
    from app.tenancy.repository import MfaRequired

    w.team.fail = MfaRequired("SM306")
    assert w.call("POST", "/v1/invitations/accept", "outsider", {"code": "x"}).json()["error"]["code"] == "mfa_required"
    w.team.fail = e.AlreadyMemberError("SM247")
    assert w.call("POST", "/v1/invitations/accept", "outsider", {"code": "x"}).json()["error"]["code"] == "already_member"


def test_the_code_field_is_bounded_and_the_address_is_rate_limited(w: World, monkeypatch: pytest.MonkeyPatch) -> None:
    assert w.call("POST", "/v1/invitations/accept", "outsider", {"code": ""}).status_code == 422
    assert w.call("POST", "/v1/invitations/accept", "outsider", {"code": "x" * 101}).status_code == 422
    assert w.call("POST", "/v1/invitations/accept", "outsider", {"code": "x", "role": "owner"}).status_code == 422
    monkeypatch.setattr(team_routes, "ACCEPT_PER_ADDRESS", SlidingWindow(3, 600))
    codes = [w.call("POST", "/v1/invitations/accept", "outsider", {"code": "x"}).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


# ------------------------------------------------------------------------------------------------------------------------ roles and removal
def test_a_role_change_is_owner_or_admin_with_a_second_factor(w: World) -> None:
    body = {"role": "admin", "reason": "role_changed"}
    for user in ROLES:
        r = w.call("POST", T + f"/members/{USER}/role", user, body)
        assert r.status_code == (200 if user in ("a_owner", "a_admin") else 403), user
    assert w.call("POST", T + f"/members/{USER}/role", "a_owner", body, aal="aal1").status_code == 403
    for bad in ({"role": "owner", "reason": "role_changed"}, {"role": "admin", "reason": "because"}, {"role": "admin", "extra": 1}):
        assert w.call("POST", T + f"/members/{USER}/role", "a_owner", bad).status_code == 422, bad
    assert w.call("POST", T + "/members/nope/role", "a_owner", body).status_code == 404
    assert w.call("POST", T + f"/members/{USER}/role", "a_owner", {"role": "sales"}).status_code == 200, "the reason defaults to role_changed"


def test_removing_and_leaving_use_the_closed_reasons(w: World) -> None:
    r = w.call("POST", T + f"/members/{USER}/remove", "a_owner", {"reason": "no_longer_works_here"})
    assert r.status_code == 200 and r.json()["leads_unassigned"] == 2 and r.json()["removed"] is True
    assert w.call("POST", T + f"/members/{USER}/remove", "a_viewer", {"reason": "left"}).status_code == 200, "any member may call it: the database decides who may remove whom"
    assert w.call("POST", T + f"/members/{USER}/remove", "a_owner", {"reason": "because"}).status_code == 422
    assert w.call("POST", T + f"/members/{USER}/remove", "a_owner", {}).status_code == 422
    assert w.call("POST", T + f"/members/{USER}/remove", "outsider", {"reason": "left"}).status_code == 404
    assert w.team.tokens[0] != "" and all(t.count(".") == 2 for t in w.team.tokens)


# ------------------------------------------------------------------------------------------------------------------------ profile and report
def test_the_profile_is_anyones_to_read_and_the_admins_to_save(w: World) -> None:
    assert w.call("GET", T + "/profile", "a_viewer").json()["missing"] == ["town", "languages"]
    assert w.call("PUT", T + "/profile", "a_sales", {"town": "Guntur"}).status_code == 403
    assert w.call("PUT", T + "/profile", "a_viewer", {"town": "Guntur"}).status_code == 403
    saved = w.call("PUT", T + "/profile", "a_admin", {"town": "Guntur", "languages": ["te", "en"]})
    assert saved.status_code == 200 and saved.json()["setup_complete"] is True and saved.json()["languages"] == ["en", "te"]
    assert w.workspace.calls[-1] == ("save_profile", (None, "Guntur", ["te", "en"]))
    bad_profiles: list[dict[str, Any]] = [{}, {"town": "x"}, {"languages": []}, {"languages": ["fr"]}, {"name": ""}, {"name": "x" * 121}, {"phone": "9"}]
    for bad_profile in bad_profiles:
        assert w.call("PUT", T + "/profile", "a_owner", bad_profile).status_code == 422, bad_profile
    assert w.call("GET", T + "/profile", "outsider").status_code == 404


def test_the_weekly_report_is_owner_and_admin_only(w: World) -> None:
    for user in ROLES:
        assert w.call("GET", T + "/reports/weekly", user).status_code == (200 if user in ("a_owner", "a_admin") else 403), user
    assert w.call("GET", T + "/reports/weekly", "a_owner").json()["current"] is True
    r = w.call("GET", T + "/reports/weekly?week_start=2026-09-28", "a_owner")
    assert r.json()["week_start"] == "2026-09-28" and w.workspace.calls[-1] == ("weekly_report", date(2026, 9, 28))
    assert w.call("GET", T + "/reports/weekly?week_start=soon", "a_owner").status_code == 422


# ------------------------------------------------------------------------------------------------------------------------ notifications
def test_the_feed_shapes_each_item_like_today_and_says_what_is_unread(w: World) -> None:
    for user in ROLES:
        assert w.call("GET", T + "/notifications", user).status_code == 200, user
    r = w.call("GET", T + "/notifications?limit=5", "a_owner").json()
    assert r["total"] == 1 and r["unread_count"] == 1
    item = r["items"][0]
    assert item["kind"] == "outbox_approval" and item["customer"] == "Ravi Silks" and item["unread"] is True and item["target"]["type"] == "outbox_message" and "message" in item["summary"].lower()
    assert w.notifications.calls[-1] == ("feed", 5)
    assert w.call("GET", T + "/notifications?limit=0", "a_owner").status_code == 422
    assert w.call("GET", T + "/notifications?limit=51", "a_owner").status_code == 422
    assert w.call("GET", T + "/notifications", "outsider").status_code == 404
    assert w.call("POST", T + "/notifications/seen", "a_sales").json()["last_seen_at"]


def test_a_browser_subscribes_with_the_standard_json_and_unsubscribes(w: World) -> None:
    sub = {"endpoint": "https://push.example.test/send/abcdefghij", "keys": {"p256dh": "B" * 87, "auth": "a" * 22}}
    assert w.call("POST", "/v1/me/push-subscriptions", None, sub).status_code == 401
    assert w.call("POST", "/v1/me/push-subscriptions", "a_sales", sub).json()["id"]
    assert w.notifications.calls[-1] == ("subscribe", ("https://push.example.test/send/abcdefghij", "B" * 87, "a" * 22))
    for bad in ({**sub, "endpoint": "http://push.example.test/send/abcdefghij"}, {**sub, "endpoint": "https://x"}, {**sub, "keys": {"p256dh": "x", "auth": "a" * 22}}, {"endpoint": sub["endpoint"]}, {**sub, "expirationTime": None}):
        assert w.call("POST", "/v1/me/push-subscriptions", "a_sales", bad).status_code == 422, bad
    assert w.call("POST", "/v1/me/push-subscriptions/remove", "a_sales", {"endpoint": sub["endpoint"]}).json() == {"removed": 1}


def test_push_is_off_until_a_member_switches_it_on(w: World) -> None:
    assert w.call("GET", T + "/notifications/push", "a_owner").json() == {"enabled": False, "subscriptions": 0, "server_ready": True}
    assert w.call("PUT", T + "/notifications/push", "a_owner", {"enabled": True}).json()["enabled"] is True
    assert w.call("PUT", T + "/notifications/push", "a_owner", {"enabled": "yes"}).status_code == 422
    assert w.call("PUT", T + "/notifications/push", "outsider", {"enabled": True}).status_code == 404


def test_the_public_key_is_public_and_says_when_the_server_is_not_ready() -> None:
    ready = World()
    r = ready.call("GET", "/v1/push/public-key", None)
    assert r.status_code == 200 and r.json()["enabled"] is True and len(r.json()["public_key"]) == 87
    off = World(vapid=False)
    assert off.call("GET", "/v1/push/public-key", None).json() == {"enabled": False, "public_key": None}
    assert off.call("GET", T + "/notifications/push", "a_owner").json()["server_ready"] is False
    bare, _ = make_client()
    assert bare.get("/v1/push/public-key").json() == {"enabled": False, "public_key": None}


def test_everything_is_503_when_nothing_is_wired() -> None:
    bare, _ = make_client()
    for path in ("/team", "/profile", "/notifications", "/invitations", "/reports/weekly"):
        assert bare.get(T + path, headers=auth("a_owner")).status_code == 503, path
    assert bare.post("/v1/invitations/accept", json={"code": "x"}, headers=auth("a_owner")).status_code == 503
