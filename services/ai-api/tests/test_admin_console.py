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
    return {"tenant_id": str(tid), "name": name, "demo": False, "business_type": "textiles", "plan": "sales_assistant", "plan_name": "Sales Assistant", "town": None, "balance_paise": balance, "status": "live",
            "signup_at": NOW.isoformat(), "last_activity_at": NOW.isoformat()}


class FakeAdmin:
    def __init__(self, fail: Exception | None = None) -> None:
        self.fail = fail
        self.calls: list[tuple[str, Any]] = []
        self.require_ok = False
        self.role = "owner"

    def _go(self, name: str, arg: Any = None) -> None:
        self.calls.append((name, arg))
        if self.fail:
            raise self.fail

    def me(self, token: str) -> dict[str, Any]:
        self._go("me")
        return {"staff_id": str(uuid.UUID(int=9)), "name": "Sia Support", "role": "support", "second_factor": True, "session_idle_limit_minutes": 30}

    def businesses(self, token: str, q: str | None, limit: int, after: tuple[str, uuid.UUID] | None, sort: str = "name") -> dict[str, Any]:
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


    def overview(self, token: str) -> dict[str, Any]:
        self._go("overview")
        ticket = {"id": str(uuid.UUID(int=21)), "tenant_id": str(T1), "business_name": "Sri Venkateswara Sarees", "subject": "Calls not reaching assistant since 10:15", "channel": "phone", "priority": "urgent",
                  "status": "open", "created_at": NOW.isoformat(), "last_message_at": NOW.isoformat(), "waiting_minutes": 12, "assignee": {"id": str(uuid.UUID(int=9)), "name": "Ravi K."}}
        money = self.role in ("owner", "finance")
        return {"generated_at": NOW.isoformat(), "role": self.role, "badges": {"businesses": 128, "support_open": 7, "health_issues": 2, "compliance_open": 3},
                "kpis": {"mrr": {"paise": 24180000, "change_percent": None} if money else None, "active_businesses": {"count": 128, "added_this_week": 9, "on_free_start": 14},
                         "calls_today": {"count": 3412, "connected_percent": 98.6},
                         "gross_margin": {"percent": 41.0, "revenue_paise": 24180000, "cost_paise": 8390000, "costs_recorded_since": NOW.isoformat()} if money else None},
                "support_queue": {"total_open": 7, "items": [ticket]} if self.role in ("owner", "support") else None,
                "health": {"components": [{"key": "api", "label": "API", "state": "healthy", "note": None}, {"key": "voice", "label": "Voice", "state": "unknown", "note": "Latency is not measured yet"}], "issues": 0},
                "businesses": [{**row(T1, "Sri Lakshmi Silks"), "plan_name": "Sales Assistant", "town": "Dharmavaram"}],
                "costs_this_month": {"period_start": NOW.isoformat(), "revenue_paise": 24180000, "cost_paise": 8390000, "margin_paise": 15790000,
                                     "providers": [{"provider": "cartesia", "role": "voice", "cost_paise": 3890000}, {"provider": "sarvam", "role": "speech_to_text", "cost_paise": 1240000}]} if money else None}

    def search(self, token: str, q: str) -> dict[str, Any]:
        self._go("search", q)
        return {"businesses": [row(T1, "Sri Lakshmi Silks")], "invoices": [{"number": "S19-2026-000001", "kind": "topup", "tenant_id": str(T1), "business_name": "Sri Lakshmi Silks", "total_paise": 118000, "issued_at": NOW.isoformat()}], "tickets": []}

    def tickets(self, token: str, status: str, limit: int) -> dict[str, Any]:
        self._go("tickets", (status, limit))
        return {"items": [], "total": 0}

    def ticket_create(self, token: str, tenant_id: uuid.UUID, subject: str, channel: str, priority: str, assignee_id: uuid.UUID | None) -> dict[str, Any]:
        self._go("ticket_create", (tenant_id, subject, channel, priority, assignee_id))
        return {"id": str(uuid.UUID(int=22)), "tenant_id": str(tenant_id), "business_name": "Sri Lakshmi Silks", "subject": subject, "channel": channel, "priority": priority, "status": "open",
                "created_at": NOW.isoformat(), "last_message_at": NOW.isoformat(), "waiting_minutes": 0, "assignee": None}

    def assistant_pause(self, token: str, tenant_id: uuid.UUID, reason_code: str, reason_text: str | None) -> dict[str, Any]:
        self._go("assistant_pause", (tenant_id, reason_code, reason_text))
        return {**row(tenant_id, "Sri Lakshmi Silks"), "status": "paused"}

    def assistant_resume(self, token: str, tenant_id: uuid.UUID, reason_code: str, reason_text: str | None) -> dict[str, Any]:
        self._go("assistant_resume", (tenant_id, reason_code, reason_text))
        return row(tenant_id, "Sri Lakshmi Silks")

    def goodwill_credit(self, token: str, tenant_id: uuid.UUID, amount_paise: int, confirm_paise: int, reason_code: str, reason_text: str, key: str) -> dict[str, Any]:
        self._go("goodwill_credit", (tenant_id, amount_paise, confirm_paise, reason_code, reason_text, key))
        return {"credited_paise": amount_paise, "balance_paise": 155000 + amount_paise, "replayed": False}

    def unmask(self, token: str, tenant_id: uuid.UUID, access_id: uuid.UUID, reason_code: str, reason_text: str) -> dict[str, Any]:
        self._go("unmask", (tenant_id, access_id, reason_code, reason_text))
        return {"recent_calls": [{"id": str(uuid.UUID(int=5)), "customer": "Padmaja Naidu", "customer_phone": "+91 98765 43210"}], "recent_chats": [{"lead_id": str(uuid.UUID(int=6)), "customer": None, "customer_phone": None}]}
    def _thread(self, ticket_id: uuid.UUID, status: str = "open", messages: list[dict[str, Any]] | None = None, assignee: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"id": str(ticket_id), "tenant_id": str(T1), "business_name": "Sri Lakshmi Silks", "subject": "Invoice GST number missing", "channel": "email", "priority": "normal", "status": status,
                "created_at": NOW.isoformat(), "last_message_at": NOW.isoformat(), "waiting_minutes": 0, "assignee": assignee, "messages": messages or []}

    def ticket_get(self, token: str, ticket_id: uuid.UUID) -> dict[str, Any]:
        self._go("ticket_get", ticket_id)
        return self._thread(ticket_id)

    def ticket_reply(self, token: str, ticket_id: uuid.UUID, body: str, kind: str) -> dict[str, Any]:
        self._go("ticket_reply", (ticket_id, body, kind))
        msg = {"id": str(uuid.UUID(int=31)), "kind": kind, "at": NOW.isoformat(), "staff": {"id": str(uuid.UUID(int=9)), "name": "Sia Support"}, "body": body, "delivered": False}
        return self._thread(ticket_id, "waiting" if kind == "reply" else "open", [msg])

    def ticket_status(self, token: str, ticket_id: uuid.UUID, status: str) -> dict[str, Any]:
        self._go("ticket_status", (ticket_id, status))
        return self._thread(ticket_id, status)

    def ticket_assign(self, token: str, ticket_id: uuid.UUID, staff_id: uuid.UUID | None) -> dict[str, Any]:
        self._go("ticket_assign", (ticket_id, staff_id))
        return self._thread(ticket_id, assignee={"id": str(staff_id), "name": "Sia Support"} if staff_id else None)

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


def test_the_overview_is_one_call_with_rupee_text_and_the_environment_tag() -> None:
    repo = FakeAdmin()
    client, _ = make_client(admin=AdminService(repo, "staging"))
    o = client.get("/v1/admin/overview", headers=auth("a_owner")).json()
    assert o["environment"] == {"key": "staging", "label": "Staging · test data"} and o["role"] == "owner"
    assert o["badges"] == {"businesses": 128, "support_open": 7, "health_issues": 2, "compliance_open": 3}
    assert o["kpis"]["mrr"] == {"paise": 24180000, "text": "₹2,41,800", "change_percent": None}
    assert o["kpis"]["active_businesses"] == {"count": 128, "added_this_week": 9, "on_free_start": 14} and o["kpis"]["calls_today"] == {"count": 3412, "connected_percent": 98.6}
    assert o["kpis"]["gross_margin"]["percent"] == 41.0 and o["kpis"]["gross_margin"]["cost_text"] == "₹83,900"
    q = o["support_queue"]
    assert q["total_open"] == 7 and q["items"][0]["priority"] == "urgent" and q["items"][0]["channel"] == "phone" and q["items"][0]["waiting_minutes"] == 12 and q["items"][0]["assignee"]["name"] == "Ravi K."
    assert [c["state"] for c in o["health"]["components"]] == ["healthy", "unknown"]
    assert o["businesses"][0]["plan_name"] == "Sales Assistant" and o["businesses"][0]["town"] == "Dharmavaram" and o["businesses"][0]["balance_text"] == "₹1,550"
    assert o["costs_this_month"]["margin_text"] == "₹1,57,900" and [p["provider"] for p in o["costs_this_month"]["providers"]] == ["cartesia", "sarvam"]
    assert o["costs_this_month"]["providers"][0]["cost_text"] == "₹38,900" and o["costs_this_month"]["providers"][0]["role"] == "voice"


def test_each_role_gets_only_its_parts_of_the_overview() -> None:
    for role, money, queue in (("owner", True, True), ("finance", True, False), ("support", False, True)):
        repo = FakeAdmin()
        repo.role = role
        client, _ = make_client(admin=AdminService(repo))
        o = client.get("/v1/admin/overview", headers=auth("a_owner")).json()
        assert (o["kpis"]["mrr"] is not None) == money and (o["kpis"]["gross_margin"] is not None) == money and (o["costs_this_month"] is not None) == money, role
        assert (o["support_queue"] is not None) == queue, role
        assert o["kpis"]["calls_today"]["count"] == 3412 and o["badges"]["support_open"] == 7   # everyone sees the calls and the sidebar numbers


def test_search_and_the_ticket_routes() -> None:
    client, repo = world()
    s = client.get("/v1/admin/search?q=lakshmi", headers=auth("a_owner")).json()
    assert s["businesses"][0]["name"] == "Sri Lakshmi Silks" and s["invoices"][0]["total_text"] == "₹1,180" and s["tickets"] == []
    assert client.get("/v1/admin/search?q=x", headers=auth("a_owner")).status_code == 422
    assert client.get("/v1/admin/support/tickets", headers=auth("a_owner")).json() == {"items": [], "total": 0}
    assert repo.calls[-1] == ("tickets", ("active", 30))
    assert client.get("/v1/admin/support/tickets?status=weird", headers=auth("a_owner")).status_code == 422
    body = {"tenant_id": str(T1), "subject": "Invoice GST number missing", "channel": "email", "priority": "normal"}
    got = client.post("/v1/admin/support/tickets", json=body, headers=auth("a_owner"))
    assert got.status_code == 201 and got.json()["subject"] == "Invoice GST number missing" and got.json()["assignee"] is None
    for bad in ({**body, "channel": "pigeon"}, {**body, "subject": "ab"}, {**body, "priority": "meh"}, {**body, "extra": 1}):
        assert client.post("/v1/admin/support/tickets", json=bad, headers=auth("a_owner")).status_code == 422
    assert client.get("/v1/admin/businesses?sort=last_activity", headers=auth("a_owner")).status_code == 200
    assert client.get("/v1/admin/businesses?sort=random", headers=auth("a_owner")).status_code == 422
    client2, _ = world(NotStaffError("SM941"))
    for method, path in (("GET", "/v1/admin/overview"), ("GET", "/v1/admin/search?q=ab"), ("GET", "/v1/admin/support/tickets")):
        assert client2.request(method, path, headers=auth("a_owner")).json()["error"]["code"] == "not_staff", path


def test_support_pauses_and_resumes_an_assistant_with_a_reason() -> None:
    client, fake = world()
    repo: Any = fake
    h = auth("a_owner")
    paused = client.post(f"/v1/admin/businesses/{T1}/assistant/pause", json={"reason_code": "incident", "reason_text": "Wrong numbers being called"}, headers=h)
    assert paused.status_code == 200 and paused.json()["status"] == "paused" and repo.calls[-1] == ("assistant_pause", (T1, "incident", "Wrong numbers being called"))
    resumed = client.post(f"/v1/admin/businesses/{T1}/assistant/resume", json={"reason_code": "customer_asked"}, headers=h)
    assert resumed.json()["status"] == "live" and repo.calls[-1] == ("assistant_resume", (T1, "customer_asked", None))
    for bad in ({}, {"reason_code": "whim"}, {"reason_code": "other", "reason_text": "ab"}, {"reason_code": "incident", "extra": 1}):
        assert client.post(f"/v1/admin/businesses/{T1}/assistant/pause", json=bad, headers=h).status_code == 422
    client2, _ = world(ReasonRequiredError("SM946"))
    r = client2.post(f"/v1/admin/businesses/{T1}/assistant/pause", json={"reason_code": "other", "reason_text": "abc"}, headers=h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "reason_required"
    client3, _ = world(NotStaffError("SM941"))
    assert client3.post(f"/v1/admin/businesses/{T1}/assistant/resume", json={"reason_code": "incident"}, headers=h).json()["error"]["code"] == "not_staff"


def test_a_goodwill_credit_is_a_checked_money_action() -> None:
    from app.admin.service import GoodwillLimitError, SecondConfirmRequiredError

    client, fake = world()
    repo: Any = fake
    h = auth("a_owner")
    body = {"amount_paise": 50000, "confirm_paise": 50000, "reason_code": "billing_dispute", "reason_text": "Agreed on the call: missed calls on Monday", "idempotency_key": "click-20261114-0001"}
    got = client.post(f"/v1/admin/businesses/{T1}/goodwill-credit", json=body, headers=h)
    assert got.status_code == 201 and got.json() == {"credited_paise": 50000, "credited_text": "₹500", "balance_paise": 205000, "balance_text": "₹2,050", "replayed": False}
    assert repo.calls[-1] == ("goodwill_credit", (T1, 50000, 50000, "billing_dispute", "Agreed on the call: missed calls on Monday", "click-20261114-0001"))
    for bad in ({**body, "amount_paise": 99}, {**body, "amount_paise": 100_001}, {**body, "reason_text": "ab"}, {**body, "idempotency_key": "short"}, {**body, "reason_code": "whim"}, {**body, "extra": 1},
                {k: v for k, v in body.items() if k != "confirm_paise"}, {k: v for k, v in body.items() if k != "reason_text"}):
        assert client.post(f"/v1/admin/businesses/{T1}/goodwill-credit", json=bad, headers=h).status_code == 422
    for err, status, code in ((SecondConfirmRequiredError("SM948"), 403, "second_confirm_required"), (GoodwillLimitError("SM949"), 409, "goodwill_limit"), (ReasonRequiredError("SM946"), 422, "reason_required")):
        c, _ = world(err)
        r = c.post(f"/v1/admin/businesses/{T1}/goodwill-credit", json=body, headers=h)
        assert (r.status_code, r.json()["error"]["code"]) == (status, code)


def test_unmasking_needs_the_access_and_a_second_reason_in_words() -> None:
    client, fake = world()
    repo: Any = fake
    h = auth("a_owner")
    acc = str(uuid.UUID(int=77))
    body = {"access_id": acc, "reason_code": "incident", "reason_text": "Checking the wrong number the shop reported"}
    got = client.post(f"/v1/admin/businesses/{T1}/unmask", json=body, headers=h)
    assert got.status_code == 200 and got.json()["recent_calls"][0]["customer_phone"] == "+91 98765 43210" and got.json()["recent_chats"][0]["customer"] is None
    assert repo.calls[-1] == ("unmask", (T1, uuid.UUID(acc), "incident", "Checking the wrong number the shop reported"))
    for bad in ({k: v for k, v in body.items() if k != "reason_text"}, {**body, "reason_text": "ab"}, {**body, "reason_code": "whim"}, {k: v for k, v in body.items() if k != "access_id"}, {**body, "extra": 1}):
        assert client.post(f"/v1/admin/businesses/{T1}/unmask", json=bad, headers=h).status_code == 422
    c2, _ = world(AccessRequiredError("SM944"))
    assert c2.post(f"/v1/admin/businesses/{T1}/unmask", json=body, headers=h).json()["error"]["code"] == "access_required"
    c3, _ = world(ReasonRequiredError("SM946"))
    assert c3.post(f"/v1/admin/businesses/{T1}/unmask", json=body, headers=h).json()["error"]["code"] == "reason_required"
def test_the_ticket_thread_routes() -> None:
    client, fake = world()
    repo: Any = fake
    tid = uuid.UUID(int=22)
    h = auth("a_owner")
    got = client.get(f"/v1/admin/support/tickets/{tid}", headers=h)
    assert got.status_code == 200 and got.json()["messages"] == [] and repo.calls[-1] == ("ticket_get", tid)
    sent = client.post(f"/v1/admin/support/tickets/{tid}/reply", json={"body": "We are looking at it."}, headers=h)
    assert sent.status_code == 201 and sent.json()["status"] == "waiting" and sent.json()["messages"][0]["delivered"] is False
    assert repo.calls[-1] == ("ticket_reply", (tid, "We are looking at it.", "reply"))
    note = client.post(f"/v1/admin/support/tickets/{tid}/reply", json={"body": "Call back tomorrow", "kind": "note"}, headers=h)
    assert note.json()["messages"][0]["kind"] == "note" and repo.calls[-1][1][2] == "note"
    for bad in ({"body": ""}, {"body": "x" * 4001}, {"body": "hi", "kind": "shout"}, {"body": "hi", "extra": 1}, {}):
        assert client.post(f"/v1/admin/support/tickets/{tid}/reply", json=bad, headers=h).status_code == 422
    assert client.post(f"/v1/admin/support/tickets/{tid}/status", json={"status": "closed"}, headers=h).json()["status"] == "closed"
    assert client.post(f"/v1/admin/support/tickets/{tid}/status", json={"status": "gone"}, headers=h).status_code == 422
    staff = uuid.UUID(int=9)
    assert client.post(f"/v1/admin/support/tickets/{tid}/assign", json={"staff_id": str(staff)}, headers=h).json()["assignee"]["name"] == "Sia Support"
    assert client.post(f"/v1/admin/support/tickets/{tid}/assign", json={"staff_id": None}, headers=h).json()["assignee"] is None
    assert client.post(f"/v1/admin/support/tickets/{tid}/assign", json={}, headers=h).status_code == 422
    assert client.get("/v1/admin/support/tickets/not-an-id", headers=h).status_code == 422


def test_a_closed_ticket_refuses_a_reply_and_the_other_refusals_keep_their_words() -> None:
    from app.admin.service import TicketClosedError

    tid = uuid.UUID(int=22)
    client, _ = world(TicketClosedError("SM947"))
    r = client.post(f"/v1/admin/support/tickets/{tid}/reply", json={"body": "hello"}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "ticket_closed"
    client2, _ = world(NotStaffError("SM941"))
    for method, path, body in (("GET", f"/v1/admin/support/tickets/{tid}", None), ("POST", f"/v1/admin/support/tickets/{tid}/status", {"status": "open"})):
        assert client2.request(method, path, json=body, headers=auth("a_owner")).json()["error"]["code"] == "not_staff", path
