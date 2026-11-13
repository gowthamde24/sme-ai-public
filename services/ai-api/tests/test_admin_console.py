"""Admin console API, phase 1: the flag, the shapes, the coded refusals as API errors, paging, validation, and the shop owner's switch. The rules themselves (staff row, second factor, 30-minute session, reasons, masking, audit) are pgTAP 197."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.admin.service import (
    AccessRequiredError,
    AdminService,
    NotStaffError,
    OwnerOkRequiredError,
    ReasonRequiredError,
    SecondFactorRequiredError,
    SessionEndedError,
)
from tests.fakes import TENANT_A, auth, make_client

NOW = datetime(2026, 11, 13, 10, 0, tzinfo=UTC)
T1, T2 = uuid.UUID(int=1), uuid.UUID(int=2)


def row(tid: uuid.UUID, name: str, balance: int = 155000) -> dict[str, Any]:
    return {"tenant_id": str(tid), "name": name, "demo": False, "business_type": "textiles", "plan": "sales_assistant", "balance_paise": balance, "status": "live",
            "signup_at": NOW.isoformat(), "last_activity_at": NOW.isoformat()}


class FakeAdmin:
    def __init__(self, fail: Exception | None = None) -> None:
        self.fail = fail
        self.calls: list[tuple[str, Any]] = []
        self.require_ok = False

    def _go(self, name: str, arg: Any = None) -> None:
        self.calls.append((name, arg))
        if self.fail:
            raise self.fail

    def me(self, token: str) -> dict[str, Any]:
        self._go("me")
        return {"staff_id": str(uuid.UUID(int=9)), "name": "Sia Support", "role": "support", "second_factor": True, "session_idle_limit_minutes": 30}

    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None) -> dict[str, Any]:
        self._go("businesses", (q, limit, after))
        items = [row(T1, "Neelambari Silks (demo)"), row(T2, "Sri Lakshmi Sarees", 0)]
        if after is None and limit == 1:
            return {"items": items[:1], "next": {"after_name": "neelambari silks (demo)", "after_id": str(T1)}}
        return {"items": items[1:] if after else items, "next": None}

    def open_access(self, token: str, tenant_id: uuid.UUID, scope: str, reason_code: str, reason_text: str | None) -> dict[str, Any]:
        self._go("open_access", (tenant_id, scope, reason_code, reason_text))
        return {"access_id": str(uuid.UUID(int=77)), "tenant_id": str(tenant_id), "scope": scope, "expires_at": NOW.isoformat()}

    def business(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID) -> dict[str, Any]:
        self._go("business", (tenant_id, access_id))
        return {"business": row(tenant_id, "Neelambari Silks (demo)"), "setup": {"business_name": True, "phone_number": False, "voice_saved": True, "rules_saved": False},
                "phone_numbers": [], "whatsapp": {"connected": False, "status": None, "display_phone": None, "connected_at": None},
                "numbers_30d": {"calls": 9, "call_minutes": 14.5, "messages_sent": 6, "leads": 19, "quotes": 5, "visits": 4},
                "recent_calls": [{"id": str(uuid.UUID(int=5)), "at": NOW.isoformat(), "direction": "inbound", "state": "completed", "duration_s": 84, "outcome": "answered", "customer": "P•••••• N••••", "customer_phone": "+•• ••••• ••210"}],
                "recent_chats": []}

    def audit(self, token: str, tenant_id: uuid.UUID | None, staff_id: uuid.UUID | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]:
        self._go("audit", (tenant_id, staff_id, limit, before))
        item = {"id": str(uuid.UUID(int=3)), "at": NOW.isoformat(), "staff": {"id": str(uuid.UUID(int=9)), "name": "Sia Support"}, "action": "access", "tenant_id": str(T1), "scope": "profile",
                "reason_code": "support_ticket", "reason_text": None, "target_kind": "business", "target_id": str(T1), "customer_visible": True}
        return {"items": [item], "next": {"before_at": NOW.isoformat(), "before_id": str(uuid.UUID(int=3))} if limit == 1 else None}

    def support_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("support_get")
        return {"require_ok": self.require_ok, "approved_until": None}

    def support_set(self, token: str, tenant_id: uuid.UUID, require_ok: bool) -> dict[str, Any]:
        self._go("support_set", require_ok)
        self.require_ok = require_ok
        return {"require_ok": require_ok, "approved_until": None}

    def support_approve(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("support_approve")
        return {"require_ok": self.require_ok, "approved_until": NOW.isoformat()}


def world(fail: Exception | None = None) -> tuple[Any, FakeAdmin]:
    repo = FakeAdmin(fail)
    client, _ = make_client(admin=AdminService(repo))
    return client, repo


def test_the_console_does_not_exist_unless_the_flag_is_on() -> None:
    client, _ = make_client()
    for path in ("/v1/admin/me", "/v1/admin/businesses", "/v1/admin/audit"):
        assert client.get(path, headers=auth("a_owner")).status_code == 404, path
    assert client.get(f"/v1/tenants/{TENANT_A.id}/support-access", headers=auth("a_owner")).status_code == 404
    assert client.get("/v1/admin/me").status_code == 401   # and a request without a login is refused first


def test_me_and_the_businesses_list_in_rupees_with_paging() -> None:
    client, repo = world()
    assert client.get("/v1/admin/me", headers=auth("a_owner")).json() == {"staff_id": str(uuid.UUID(int=9)), "name": "Sia Support", "role": "support", "second_factor": True, "session_idle_limit_minutes": 30}
    page1 = client.get("/v1/admin/businesses?limit=1", headers=auth("a_owner")).json()
    assert page1["items"][0]["balance_text"] == "₹1,550" and page1["items"][0]["status"] == "live" and page1["items"][0]["plan"] == "sales_assistant" and page1["next_cursor"]
    page2 = client.get(f"/v1/admin/businesses?limit=1&cursor={page1['next_cursor']}", headers=auth("a_owner")).json()
    assert [i["name"] for i in page2["items"]] == ["Sri Lakshmi Sarees"] and page2["items"][0]["balance_text"] == "₹0" and page2["next_cursor"] is None
    assert repo.calls[-1] == ("businesses", (None, 1, ("neelambari silks (demo)", T1)))
    assert client.get("/v1/admin/businesses?cursor=not-a-cursor", headers=auth("a_owner")).json()["error"]["code"] == "bad_cursor"
    assert client.get("/v1/admin/businesses?limit=0", headers=auth("a_owner")).status_code == 422
    assert client.get("/v1/admin/businesses?q=" + "x" * 81, headers=auth("a_owner")).status_code == 422


def test_looking_at_a_business_needs_an_access_with_a_reason() -> None:
    client, repo = world()
    body = {"tenant_id": str(T1), "scope": "profile", "reason_code": "support_ticket", "reason_text": "Customer wrote in about calls"}
    got = client.post("/v1/admin/access", json=body, headers=auth("a_owner"))
    assert got.status_code == 201 and got.json()["scope"] == "profile"
    assert repo.calls[-1] == ("open_access", (T1, "profile", "support_ticket", "Customer wrote in about calls"))
    assert client.post("/v1/admin/access", json={**body, "reason_code": "whim"}, headers=auth("a_owner")).status_code == 422
    assert client.post("/v1/admin/access", json={**body, "reason_text": "ab"}, headers=auth("a_owner")).status_code == 422
    assert client.post("/v1/admin/access", json={**body, "scope": "calls"}, headers=auth("a_owner")).status_code == 422
    assert client.post("/v1/admin/access", json={**body, "extra": 1}, headers=auth("a_owner")).status_code == 422
    assert client.get(f"/v1/admin/businesses/{T1}", headers=auth("a_owner")).status_code == 422   # no access id at all
    d = client.get(f"/v1/admin/businesses/{T1}?access_id={uuid.UUID(int=77)}", headers=auth("a_owner")).json()
    assert d["support_view"] is True and d["business"]["name"] == "Neelambari Silks (demo)" and d["numbers_30d"]["calls"] == 9
    assert d["recent_calls"][0]["customer"] == "P•••••• N••••" and d["recent_calls"][0]["customer_phone"] == "+•• ••••• ••210"
    assert d["setup"]["phone_number"] is False


def test_the_databases_refusals_become_clear_api_errors() -> None:
    cases = [(NotStaffError("SM941"), 403, "not_staff"), (SecondFactorRequiredError("SM942"), 403, "second_factor_required"), (SessionEndedError("SM943"), 401, "session_ended"),
             (AccessRequiredError("SM944"), 403, "access_required"), (OwnerOkRequiredError("SM945"), 409, "owner_ok_required"), (ReasonRequiredError("SM946"), 422, "reason_required")]
    for exc, status, code in cases:
        client, _ = world(exc)
        for method, path, body in (("get", "/v1/admin/me", None), ("get", "/v1/admin/businesses", None), ("post", "/v1/admin/access", {"tenant_id": str(T1), "reason_code": "incident"}),
                                   ("get", f"/v1/admin/businesses/{T1}?access_id={uuid.UUID(int=1)}", None), ("get", "/v1/admin/audit", None)):
            r = client.request(method.upper(), path, json=body, headers=auth("a_owner"))
            assert r.status_code == status and r.json()["error"]["code"] == code, (code, path, r.status_code, r.text)


def test_the_audit_trail_pages_and_never_names_a_customer() -> None:
    client, repo = world()
    first = client.get(f"/v1/admin/audit?tenant_id={T1}&limit=1", headers=auth("a_owner")).json()
    assert first["items"][0]["action"] == "access" and first["items"][0]["customer_visible"] is True and first["next_cursor"]
    client.get(f"/v1/admin/audit?cursor={first['next_cursor']}", headers=auth("a_owner"))
    assert repo.calls[-1][1][3] == (NOW, uuid.UUID(int=3))
    assert set(first["items"][0]) == {"id", "at", "staff", "action", "tenant_id", "scope", "reason_code", "reason_text", "target_kind", "target_id", "customer_visible"}


def test_the_shop_owners_switch_is_the_owners_alone() -> None:
    client, repo = world()
    url = f"/v1/tenants/{TENANT_A.id}/support-access"
    assert client.get(url, headers=auth("a_owner")).json() == {"require_ok": False, "approved_until": None}
    assert client.put(url, json={"require_ok": True}, headers=auth("a_owner")).json()["require_ok"] is True
    assert client.get(url, headers=auth("a_admin")).status_code == 403
    assert client.put(url, json={"require_ok": False}, headers=auth("a_admin")).status_code == 403
    assert client.put(url, json={"require_ok": "maybe"}, headers=auth("a_owner")).status_code == 422
    assert client.post(url + "/approve", headers=auth("a_owner")).json()["approved_until"] is not None
    assert client.post(url + "/approve", headers=auth("a_sales")).status_code == 403
    assert client.get(url).status_code == 401
    assert ("support_set", True) in repo.calls
