"""Shopify and WooCommerce (docs/contracts/commerce-notify.md section B): signatures, the readers of the stores' payloads, the guarded calls to the stores (fake transport, fake DNS: no test reaches a network),
connecting with the store's own credentials, orders and abandoned checkouts becoming leads through the REAL lead intake (consent, duplicates), order-status facts for the phone assistant, the catalogue preview and
save, and the switch. The database side is proved by supabase/tests/database/ (pgTAP, written; run in CI)."""

# ruff: noqa: E501, S105, S106

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.commerce import catalogue, events, facts, stores, verify
from app.commerce.service import CONSENT_TEXT, Commerce, address_hash
from app.connector_vault import ConnectorVault
from app.lead_sources.service import LeadSourcesService
from app.outbound_http import GuardedHttp
from app.telephony import fact_pack
from app.workspace_secrets import FakeSecretStore
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}/commerce"
PUBLIC_IP = "93.184.216.34"
BASE = "https://api.example.test"
SHOP = "demo-shop.myshopify.com"
SITE = "https://shop.example.test"
NOW = datetime.now(UTC)


# ============================================================================ the stores, as fakes
class FakeStores:
    """Answers for both stores by Host header. Records what we asked (paths only: never a key)."""

    def __init__(self) -> None:
        self.asked: list[str] = []
        self.webhook_topics: list[str] = []
        self.woo_hooks: list[dict[str, Any]] = []
        self.shopify_ok = True
        self.woo_ok = True
        self.registration_refused = False
        self.products_pages: list[list[dict[str, Any]]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        host = request.headers["host"]
        path = request.url.path
        self.asked.append(f"{request.method} {host}{path}")
        if host == SHOP:
            if path == "/admin/oauth/access_token":
                return httpx.Response(200, json={"access_token": "tok-from-exchange", "scope": "read_orders", "expires_in": 86399}) if self.shopify_ok else httpx.Response(400, json={})
            if request.headers.get("x-shopify-access-token") not in ("shpat_demo_token_1234", "tok-from-exchange") or not self.shopify_ok:
                return httpx.Response(401, json={})
            body = json.loads(request.content or b"{}")
            query = body.get("query", "")
            if "webhookSubscriptionCreate" in query:
                if self.registration_refused:
                    return httpx.Response(200, json={"data": {"webhookSubscriptionCreate": {"webhookSubscription": None, "userErrors": [{"field": ["topic"], "message": "Access denied"}]}}})
                self.webhook_topics.append(body["variables"]["topic"])
                return httpx.Response(200, json={"data": {"webhookSubscriptionCreate": {"webhookSubscription": {"id": "gid://x/1"}, "userErrors": []}}})
            if "products(" in query:
                page = self.products_pages.pop(0) if self.products_pages else []
                return httpx.Response(200, json={"data": {"products": {"pageInfo": {"hasNextPage": bool(self.products_pages), "endCursor": "c1"}, "nodes": page}}})
            return httpx.Response(200, json={"data": {"shop": {"name": "Demo"}}})
        if host == "shop.example.test":
            if not self.woo_ok or not request.headers.get("authorization", "").startswith("Basic "):
                return httpx.Response(401, json={})
            if path.endswith("/webhooks") and request.method == "GET":
                return httpx.Response(200, json=self.woo_hooks)
            if path.endswith("/webhooks") and request.method == "POST":
                if self.registration_refused:
                    return httpx.Response(403, json={})
                made = json.loads(request.content)
                self.woo_hooks.append(made)
                return httpx.Response(201, json={"id": len(self.woo_hooks)})
            if path.endswith("/products"):
                return httpx.Response(200, json=self.products_pages.pop(0) if self.products_pages else [])
        return httpx.Response(404, json={})


def http_for(fake: FakeStores) -> GuardedHttp:
    return GuardedHttp(resolver=lambda host, port: [PUBLIC_IP], transport=httpx.MockTransport(fake))


# ============================================================================ a repository that answers as migration 992340's functions do
class FakeCommerceRepo:
    def __init__(self) -> None:
        self.conns: dict[uuid.UUID, dict[str, Any]] = {}
        self.orders: dict[tuple[str, str], dict[str, Any]] = {}
        self.checkouts: dict[str, dict[str, Any]] = {}
        self.purged = 0

    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [dict(c, counts={"orders_30d": 0, "cod_30d": 0, "carts_waiting": 0}) for c in self.conns.values() if c["state"] != "disconnected"]

    def connect(self, token, tenant_id, connection_id, kind, label, token_hash, last4, lead_source_id):  # type: ignore[no-untyped-def]
        old = next((c for c in self.conns.values() if c["kind"] == kind), None)
        cid = uuid.UUID(old["id"]) if old else connection_id
        self.conns[cid] = {"id": str(cid), "tenant_id": str(tenant_id), "kind": kind, "store_label": label, "token_hash": token_hash, "secret_last4": last4, "lead_source_id": str(lead_source_id), "state": "connected", "problem": None,
                           "webhooks_registered": False, "last_event_at": None, "settings": (old or {}).get("settings", {}), "created_at": NOW.isoformat()}
        return dict(self.conns[cid])

    def settings_set(self, token, tenant_id, connection_id, settings):  # type: ignore[no-untyped-def]
        c = self.conns.get(connection_id)
        if c is None:
            return None
        c["settings"] = {**c["settings"], **settings}
        return dict(c)

    def mark(self, token, tenant_id, connection_id, state, problem, webhooks):  # type: ignore[no-untyped-def]
        c = self.conns.get(connection_id)
        if c is None:
            return None
        c.update(state=state, problem=None if state == "connected" else problem)
        if webhooks is not None:
            c["webhooks_registered"] = webhooks
        return dict(c)

    def disconnect(self, token, tenant_id, connection_id):  # type: ignore[no-untyped-def]
        c = self.conns.get(connection_id)
        if c is None or c["state"] == "disconnected":
            return False
        c["state"], c["token_hash"] = "disconnected", "x" * 64
        return True

    def by_token(self, worker, token_hash):  # type: ignore[no-untyped-def]
        c = next((c for c in self.conns.values() if c["token_hash"] == token_hash and c["state"] != "disconnected"), None)
        return None if c is None else {k: c[k] for k in ("id", "tenant_id", "kind", "state", "store_label", "lead_source_id", "settings")}

    def order_upsert(self, worker, tenant_id, connection_id, o):  # type: ignore[no-untyped-def]
        key = (str(connection_id), o.external_id)
        new = key not in self.orders
        row = self.orders.setdefault(key, {"lead_sent": False, "phone": o.phone, "number": o.number, "payment": o.payment, "paise": o.total_paise, "items": o.items, "tenant": str(tenant_id), "placed_at": o.placed_at.isoformat()})
        row.update(status=o.status, tracking=o.tracking or row.get("tracking", ""))
        if o.checkout_ref in self.checkouts:
            self.checkouts[o.checkout_ref].update(status="recovered", phone=None, name=None)
        return {"created": new, "lead_sent": row["lead_sent"], "status": o.status}

    def order_lead_sent(self, worker, tenant_id, connection_id, external_id):  # type: ignore[no-untyped-def]
        self.orders[(str(connection_id), external_id)]["lead_sent"] = True
        return True

    def checkout_upsert(self, worker, tenant_id, connection_id, c, wait_min):  # type: ignore[no-untyped-def]
        if c.completed:
            if c.external_id in self.checkouts:
                self.checkouts[c.external_id].update(status="recovered", phone=None, name=None)
            return {"status": "recovered"}
        self.checkouts[c.external_id] = {"id": str(uuid.uuid4()), "tenant_id": str(tenant_id), "connection_id": str(connection_id), "external_id": c.external_id, "phone": c.phone, "name": c.name, "total_paise": c.total_paise,
                                         "items": c.items, "status": "pending", "wait": wait_min, "created_at": NOW.isoformat()}
        return {"status": "pending"}

    def checkouts_claim(self, worker, limit):  # type: ignore[no-untyped-def]
        out = []
        for c in self.checkouts.values():
            if c["status"] == "pending":
                conn = self.conns[uuid.UUID(c["connection_id"])]
                out.append({**c, "kind": conn["kind"], "lead_source_id": conn["lead_source_id"], "abandoned": conn["settings"].get("abandoned", False), "settings": conn["settings"]})
        return out[:limit]

    def checkout_finish(self, worker, checkout_id, result):  # type: ignore[no-untyped-def]
        for c in self.checkouts.values():
            if c["id"] == str(checkout_id):
                if result == "retry":
                    return True
                c.update(status=result, phone=None, name=None)
                return True
        return False

    def order_facts(self, worker: str, tenant_id: uuid.UUID, phone: str) -> list[dict[str, Any]]:
        return [{"number": o["number"], "status": o["status"], "payment": o["payment"], "paise": o["paise"], "items": o["items"], "tracking": o.get("tracking", "")} for o in self.orders.values() if o["phone"] == phone]

    def purge(self, worker):  # type: ignore[no-untyped-def]
        self.purged += 1
        return {"orders": 0, "checkouts": 0}


class FakeLists:
    def __init__(self) -> None:
        self.imported: list[dict[str, Any]] = []
        self.list_json = {"id": str(uuid.uuid4()), "kind": "products", "columns": [
            {"key": "price", "label": "Price", "type": "rupees", "role": "price", "quote_default": True, "choices": []},
            {"key": "availability", "label": "Availability", "type": "choice", "role": "availability", "choices": ["In stock", "Few left", "Made to order", "Out of stock"]},
            {"key": "details", "label": "Details", "type": "text", "role": "description", "choices": []}]}

    def get(self, token, tenant_id, list_id):  # type: ignore[no-untyped-def]
        return self.list_json

    def rows_import(self, token, tenant_id, list_id, rows, label, mapping):  # type: ignore[no-untyped-def]
        self.imported += rows
        return {"created": len(rows), "updated": 0}


class World:
    def __init__(self, *, base: str | None = BASE) -> None:
        self.stores = FakeStores()
        self.repo = FakeCommerceRepo()
        self.secrets = FakeSecretStore()
        self.leads_repo = FakeLeadSourcesRepository()
        self.leads = LeadSourcesService(self.leads_repo, receiver=Receiver(), inbound_domain="leads.example.test", public_base_url=BASE)
        self.lists = FakeLists()
        self.commerce = Commerce(self.repo, ConnectorVault(self.secrets), http_for(self.stores), public_base_url=base, receiver=Receiver())
        self.client, _ = make_client(lead_sources=self.leads, sell_lists=self.lists)
        object.__setattr__(getattr(self.client.app, "state").runtime, "commerce", self.commerce)  # noqa: B009

    def shopify(self, **over: Any) -> Any:
        body = {"id": str(uuid.uuid4()), "shop": SHOP, "client_secret": "shpss_signing_secret", "access_token": "shpat_demo_token_1234", **over}
        return self.client.post(f"{T}/connections/shopify", json=body, headers=auth("a_owner"))

    def woo(self, **over: Any) -> Any:
        body = {"id": str(uuid.uuid4()), "site": SITE, "key": "ck_demo_key_1234", "secret": "cs_demo_secret_5678", **over}
        return self.client.post(f"{T}/connections/woocommerce", json=body, headers=auth("a_owner"))

    def hook(self, kind: str) -> tuple[str, dict[str, Any]]:
        """The address token and the vault value of a connected store."""
        value = ConnectorVault(self.secrets).get(TENANT_A.id, kind) or {}
        return str(value["webhook_token"]), value

    def deliver(self, kind: str, topic: str, payload: dict[str, Any], *, secret_key: str | None = None, sign: bool = True) -> Any:
        token, value = self.hook(kind)
        raw = json.dumps(payload).encode()
        key = value["client_secret"] if kind == "shopify" else value["webhook_secret"]
        headers = {"content-type": "application/json"}
        if sign:
            headers["x-shopify-hmac-sha256" if kind == "shopify" else "x-wc-webhook-signature"] = verify.sign(secret_key or key, raw)
        headers["x-shopify-topic" if kind == "shopify" else "x-wc-webhook-topic"] = topic
        return self.client.post(f"/v1/webhooks/commerce/{kind}/{token}", content=raw, headers=headers)


def shopify_order(**over: Any) -> dict[str, Any]:
    base = {"id": 450789469, "name": "#1001", "order_number": 1001, "created_at": NOW.isoformat(), "currency": "INR", "total_price": "1299.00", "financial_status": "pending", "fulfillment_status": None,
            "payment_gateway_names": ["Cash on Delivery (COD)"], "phone": None, "email": "asha@example.test", "buyer_accepts_marketing": False, "checkout_token": "chk-1",
            "customer": {"first_name": "Asha", "last_name": "Rao", "phone": "+91 90000 00001"}, "shipping_address": {"city": "Hyderabad", "phone": None},
            "line_items": [{"title": "Silk saree", "quantity": 2, "price": "649.50"}], "fulfillments": [], "cancelled_at": None}
    return {**base, **over}


def woo_order(**over: Any) -> dict[str, Any]:
    base = {"id": 727, "number": "727", "status": "processing", "currency": "INR", "total": "999.00", "payment_method": "cod", "payment_method_title": "Cash on delivery", "date_paid": None, "date_created_gmt": NOW.strftime("%Y-%m-%dT%H:%M:%S"),
            "billing": {"first_name": "Ravi", "last_name": "K", "phone": "9000000002", "email": "ravi@example.test", "city": "Pune"}, "shipping": {"phone": ""}, "line_items": [{"name": "Kurta", "quantity": 1}]}
    return {**base, **over}


# ============================================================================ signatures
def test_the_signature_is_base64_hmac_sha256_of_the_raw_body() -> None:
    import base64
    import hashlib
    import hmac

    raw = b'{"id":1}'
    want = base64.b64encode(hmac.new(b"secret-key-1", raw, hashlib.sha256).digest()).decode()
    assert verify.sign("secret-key-1", raw) == want and verify.signature_ok("secret-key-1", raw, want)
    for bad in (None, "", "AAAA", want[:-2] + "xx", want + "=="):
        assert not verify.signature_ok("secret-key-1", raw, bad)
    assert not verify.signature_ok("other-key", raw, want) and not verify.signature_ok(None, raw, want) and not verify.signature_ok("secret-key-1", raw + b" ", want)


# ============================================================================ the readers
def test_a_shopify_cod_order_is_read() -> None:
    o = events.shopify_order(shopify_order())
    assert o is not None and (o.number, o.payment, o.status, o.total_paise, o.phone, o.name) == ("#1001", "cod", "placed", 129900, "+919000000001", "Asha Rao")
    assert o.items == "Silk saree x2" and o.checkout_ref == "chk-1" and o.city == "Hyderabad"


def test_payment_status_and_amounts_follow_the_store() -> None:
    paid = events.shopify_order(shopify_order(payment_gateway_names=["razorpay"], financial_status="paid"))
    assert paid is not None and paid.payment == "prepaid"
    shipped = events.shopify_order(shopify_order(fulfillment_status="fulfilled", fulfillments=[{"tracking_number": "AWB 123", "tracking_company": "Delhivery"}]))
    assert shipped is not None and shipped.status == "shipped" and shipped.tracking == "Delhivery AWB 123"
    delivered = events.shopify_order(shopify_order(fulfillments=[{"shipment_status": "delivered"}]))
    assert delivered is not None and delivered.status == "delivered"
    cancelled = events.shopify_order(shopify_order(cancelled_at=NOW.isoformat()))
    assert cancelled is not None and cancelled.status == "cancelled"
    dollars = events.shopify_order(shopify_order(currency="USD"))
    assert dollars is not None and dollars.total_paise == 0, "an amount in another currency is never turned into rupees"
    custom = events.shopify_order(shopify_order(payment_gateway_names=["Pay at doorstep"]), extra_cod_words=("pay at doorstep",))
    assert custom is not None and custom.payment == "cod"
    assert events.shopify_order({"name": "#1"}) is None and events.shopify_order(shopify_order(id=None)) is None


def test_a_woocommerce_order_and_a_shopify_checkout_are_read() -> None:
    o = events.woo_order(woo_order())
    assert o is not None and (o.number, o.payment, o.status, o.total_paise, o.phone) == ("#727", "cod", "confirmed", 99900, "+919000000002")
    done = events.woo_order(woo_order(status="completed", payment_method="razorpay", payment_method_title="Razorpay", date_paid="2026-11-01T10:00:00"))
    assert done is not None and done.status == "shipped" and done.payment == "prepaid"
    c = events.shopify_checkout({"token": "abc123", "id": 9, "completed_at": None, "phone": "9000000003", "total_price": "500.00", "currency": "INR", "line_items": [{"title": "Dupatta", "quantity": 1}], "customer": {"first_name": "Mina"}, "abandoned_checkout_url": "https://x"})
    assert c is not None and (c.external_id, c.completed, c.phone, c.total_paise, c.name) == ("abc123", False, "+919000000003", 50000, "Mina")


# ============================================================================ the stores' own APIs, guarded
def test_store_addresses_are_checked_before_anything_is_asked() -> None:
    assert stores.shop_domain("My-Shop") == "my-shop.myshopify.com" and stores.shop_domain("https://my-shop.myshopify.com/admin") == "my-shop.myshopify.com"
    for bad in ("evil.example.com", "my-shop.myshopify.com.evil.com", "127.0.0.1", "a b.myshopify.com", ""):
        assert stores.shop_domain(bad) is None, bad
    assert stores.site_url("shop.example.test/") == "https://shop.example.test" and stores.site_url("https://shop.example.test/store") == "https://shop.example.test/store"
    for bad in ("http://shop.example.test", "https://127.0.0.1", "https://localhost", "https://user:pw@shop.example.test", "https://shop.example.test/?x=1", "https://shop.example.test/a b", "https://169.254.169.254"):
        assert stores.site_url(bad) is None, bad


def test_a_store_that_points_at_a_private_address_is_never_called() -> None:
    fake = FakeStores()
    http = GuardedHttp(resolver=lambda host, port: ["10.0.0.5"], transport=httpx.MockTransport(fake))
    assert stores.WooApi(http, "https://shop.example.test", "ck_demo_key_1234", "cs_demo_secret_5678").check() == "unreachable"
    assert fake.asked == []


# ============================================================================ connecting
def test_shopify_connect_with_an_admin_token_registers_the_webhooks_and_keeps_keys_out_of_the_answer() -> None:
    w = World()
    r = w.shopify()
    assert r.status_code == 201, r.text
    card = r.json()
    assert card["state"] == "connected" and card["store_label"] == SHOP and card["webhooks_registered"] is True and card["abandoned_supported"] is True
    assert set(w.stores.webhook_topics) == set(stores.SHOPIFY_TOPICS)
    text = r.text
    assert "shpat_demo_token_1234" not in text and "shpss_signing_secret" not in text and "lead_secret" not in text
    value = ConnectorVault(w.secrets).get(TENANT_A.id, "shopify")
    assert value is not None and value["client_secret"] == "shpss_signing_secret" and value["lead_secret"]
    assert address_hash(value["webhook_token"]) == next(iter(w.repo.conns.values()))["token_hash"] and value["webhook_token"] not in text
    assert card["settings"]["confirm_orders"] == "cod" and card["settings"]["share_status"] is True


def test_shopify_connect_with_a_dev_dashboard_app_exchanges_its_client_credentials() -> None:
    w = World()
    r = w.shopify(access_token=None, client_id="client-id-1")
    assert r.status_code == 201 and r.json()["state"] == "connected"
    assert f"POST {SHOP}/admin/oauth/access_token" in w.stores.asked


def test_shopify_connect_refusals() -> None:
    w = World()
    assert w.shopify(shop="evil.example.com").json()["error"]["code"] == "store_address_invalid"
    assert w.shopify(access_token=None, client_id=None).json()["error"]["code"] == "credentials_invalid"
    assert w.shopify(access_token="shpat_demo_token_1234", client_id="x" * 8).json()["error"]["code"] == "credentials_invalid"
    w.stores.shopify_ok = False
    bad = w.shopify()
    assert bad.status_code == 422 and bad.json()["error"]["reason"] == "bad_credentials" and not w.repo.conns and not w.secrets.secrets
    w.stores.shopify_ok = True
    w.commerce.public_base_url = None
    assert w.shopify().json()["error"]["code"] == "public_address_missing"


def test_woocommerce_connect_registers_two_webhooks_with_a_secret_we_made() -> None:
    w = World()
    r = w.woo()
    assert r.status_code == 201, r.text
    card = r.json()
    assert card["state"] == "connected" and card["store_label"] == "shop.example.test" and card["abandoned_supported"] is False
    value = ConnectorVault(w.secrets).get(TENANT_A.id, "woocommerce")
    assert value is not None and {h["topic"] for h in w.stores.woo_hooks} == set(stores.WOO_TOPICS) and all(h["secret"] == value["webhook_secret"] and h["delivery_url"].startswith(BASE + "/v1/webhooks/commerce/woocommerce/") for h in w.stores.woo_hooks)
    assert "cs_demo_secret_5678" not in r.text and value["webhook_secret"] not in r.text


def test_when_the_store_refuses_the_webhooks_the_card_says_so_and_shows_the_manual_steps() -> None:
    w = World()
    w.stores.registration_refused = True
    card = w.woo().json()
    assert card["state"] == "problem" and card["problem"] == "webhooks_not_registered" and card["manual_setup"]["secret"] and card["manual_setup"]["address"].startswith(BASE)
    w2 = World()
    w2.stores.registration_refused = True
    card2 = w2.shopify().json()
    assert card2["state"] == "problem" and "secret" not in card2["manual_setup"]
    w2.stores.registration_refused = False
    fixed = w2.client.post(f"{T}/connections/{card2['id']}/test", headers=auth("a_owner")).json()
    assert fixed["state"] == "connected" and fixed["webhooks_registered"] is True


def test_roles_the_switch_and_disconnect() -> None:
    w = World()
    card = w.shopify().json()
    assert w.client.get(f"{T}/connections", headers=auth("a_sales")).status_code == 200
    assert w.client.get(f"{T}/connections", headers=auth("outsider")).status_code in (403, 404)
    body = {"id": str(uuid.uuid4()), "shop": SHOP, "client_secret": "shpss_signing_secret", "access_token": "shpat_demo_token_1234"}
    assert w.client.post(f"{T}/connections/shopify", json=body, headers=auth("a_sales")).status_code == 403
    assert w.client.post(f"{T}/connections/{card['id']}/disconnect", headers=auth("a_viewer")).status_code == 403
    token, _ = w.hook("shopify")
    assert w.client.post(f"{T}/connections/{card['id']}/disconnect", headers=auth("a_admin")).json() == {"disconnected": True}
    assert ConnectorVault(w.secrets).get(TENANT_A.id, "shopify") is None
    assert w.client.post(f"/v1/webhooks/commerce/shopify/{token}", content=b"{}").status_code == 404
    off, _ = make_client()
    assert off.get(f"{T}/connections", headers=auth("a_owner")).status_code == 404
    assert off.post(f"/v1/webhooks/commerce/shopify/{'a' * 30}", content=b"{}").status_code == 404


def test_settings_are_a_closed_set() -> None:
    w = World()
    card = w.shopify().json()
    r = w.client.put(f"{T}/connections/{card['id']}/settings", json={"abandoned": True, "abandoned_after_min": 30, "confirm_orders": "all"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["settings"]["abandoned"] is True and r.json()["settings"]["confirm_orders"] == "all"
    for bad in ({}, {"confirm_orders": "sometimes"}, {"abandoned_after_min": 5}, {"nope": 1}, {"cod_words": ["a"]}):
        assert w.client.put(f"{T}/connections/{card['id']}/settings", json=bad, headers=auth("a_owner")).status_code == 422
    assert w.client.put(f"{T}/connections/{uuid.uuid4()}/settings", json={"abandoned": False}, headers=auth("a_owner")).status_code == 404


# ============================================================================ events become leads (the REAL intake)
def test_a_signed_shopify_cod_order_becomes_one_lead_with_the_orders_words_and_no_consent_by_default() -> None:
    w = World()
    w.shopify()
    r = w.deliver("shopify", "orders/create", shopify_order())
    assert r.status_code == 200, r.text
    assert len(w.leads_repo.sent) == 1
    row = w.leads_repo.sent[0]
    assert row["phone"] == "+919000000001" or row["phone"].endswith("9000000001")
    assert "#1001" in row["message"] and "cash on delivery" in row["message"] and "Rs 1,299" in row["message"] and row["external_id"] == "shopify:order:450789469"
    assert "consent" not in row, "no consent is shown unless the owner said the checkout asks for it: the lead is ask-first"
    again = w.deliver("shopify", "orders/create", shopify_order())
    assert again.status_code == 200 and len(w.leads_repo.sent) == 1, "the same delivery twice is one lead"
    assert w.deliver("shopify", "orders/updated", shopify_order(fulfillment_status="fulfilled", fulfillments=[{"tracking_number": "AWB9"}])).status_code == 200
    assert len(w.leads_repo.sent) == 1


def test_consent_is_shown_only_when_the_owner_says_the_checkout_asks_for_it() -> None:
    w = World()
    card = w.shopify().json()
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"checkout_consent": True}, headers=auth("a_owner"))
    w.deliver("shopify", "orders/create", shopify_order())
    row = w.leads_repo.sent[0]
    assert isinstance(row.get("consent"), dict) and row["consent"]["ticked"] is True and row["consent"]["disclaimer"] == CONSENT_TEXT
    assert row["consent"]["given_at"] and datetime.fromisoformat(row["consent"]["given_at"]) <= datetime.now(UTC) + timedelta(minutes=5)


def test_a_prepaid_order_is_not_confirmed_by_default_but_is_when_the_owner_asks_for_all() -> None:
    w = World()
    card = w.shopify().json()
    prepaid = shopify_order(payment_gateway_names=["razorpay"], financial_status="paid")
    w.deliver("shopify", "orders/create", prepaid)
    assert w.leads_repo.sent == []
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"confirm_orders": "all"}, headers=auth("a_owner"))
    w.deliver("shopify", "orders/create", shopify_order(id=2, name="#1002", payment_gateway_names=["razorpay"], financial_status="paid"))
    assert len(w.leads_repo.sent) == 1
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"confirm_orders": "off"}, headers=auth("a_owner"))
    w.deliver("shopify", "orders/create", shopify_order(id=3, name="#1003"))
    assert len(w.leads_repo.sent) == 1


def test_a_cancelled_order_or_one_without_a_number_makes_no_lead() -> None:
    w = World()
    w.shopify()
    w.deliver("shopify", "orders/cancelled", shopify_order(cancelled_at=NOW.isoformat()))
    w.deliver("shopify", "orders/create", shopify_order(id=5, customer={"first_name": "No", "phone": None}))
    assert w.leads_repo.sent == []
    assert any(o["status"] == "cancelled" for o in w.repo.orders.values())


def test_a_woocommerce_cod_order_becomes_a_lead_and_its_ping_is_ignored() -> None:
    w = World()
    w.woo()
    assert w.deliver("woocommerce", "order.created", woo_order()).status_code == 200
    assert len(w.leads_repo.sent) == 1 and "#727" in w.leads_repo.sent[0]["message"]
    token, value = w.hook("woocommerce")
    ping = b"webhook_id=5"
    r = w.client.post(f"/v1/webhooks/commerce/woocommerce/{token}", content=ping, headers={"x-wc-webhook-signature": verify.sign(value["webhook_secret"], ping), "x-wc-webhook-topic": "order.created"})
    assert r.status_code == 200 and len(w.leads_repo.sent) == 1


def test_a_wrong_or_missing_signature_a_foreign_secret_and_an_unknown_address_do_nothing() -> None:
    w = World()
    w.shopify()
    assert w.deliver("shopify", "orders/create", shopify_order(), secret_key="not-the-secret").status_code == 401
    assert w.deliver("shopify", "orders/create", shopify_order(), sign=False).status_code == 401
    token, _ = w.hook("shopify")
    assert w.client.post(f"/v1/webhooks/commerce/shopify/{token[:-1]}x", content=b"{}").status_code == 404
    assert w.client.post(f"/v1/webhooks/commerce/woocommerce/{token}", content=b"{}").status_code == 404, "an address belongs to its own kind"
    assert w.client.post("/v1/webhooks/commerce/magento/" + "a" * 30, content=b"{}").status_code == 404
    assert w.leads_repo.sent == [] and w.repo.orders == {}
    big = w.client.post(f"/v1/webhooks/commerce/shopify/{token}", content=b"x" * (600 * 1024))
    assert big.status_code == 413


def test_a_rate_limited_lead_is_asked_again_by_the_store_and_arrives_once() -> None:
    w = World()
    w.shopify()
    w.leads_repo.rate_after = 0
    assert w.deliver("shopify", "orders/create", shopify_order()).status_code == 503
    w.leads_repo.rate_after = 1000
    assert w.deliver("shopify", "orders/create", shopify_order()).status_code == 200
    assert len(w.leads_repo.sent) == 1 and next(iter(w.repo.orders.values()))["lead_sent"] is True


def test_a_checkout_left_open_becomes_one_call_back_lead_and_a_finished_one_does_not() -> None:
    w = World()
    card = w.shopify().json()
    cart = {"token": "chk-9", "id": 9, "completed_at": None, "phone": "9000000004", "total_price": "700.00", "currency": "INR", "line_items": [{"title": "Dupatta", "quantity": 1}], "customer": {"first_name": "Mina"}}
    assert w.deliver("shopify", "checkouts/update", cart).status_code == 200
    assert w.repo.checkouts == {}, "the owner has not turned the call-back on"
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"abandoned": True, "abandoned_after_min": 30}, headers=auth("a_owner"))
    w.deliver("shopify", "checkouts/update", cart)
    w.deliver("shopify", "checkouts/create", {**cart, "token": "chk-10", "phone": "9000000005"})
    w.deliver("shopify", "checkouts/create", {**cart, "token": "chk-11", "phone": None})
    assert set(w.repo.checkouts) == {"chk-9", "chk-10"} and w.repo.checkouts["chk-9"]["wait"] == 30
    assert w.deliver("shopify", "orders/create", shopify_order(id=77, checkout_token="chk-10", payment_gateway_names=["razorpay"], financial_status="paid")).status_code == 200
    assert w.repo.checkouts["chk-10"]["status"] == "recovered" and w.repo.checkouts["chk-10"]["phone"] is None
    runner_leads = w.commerce.run_checkouts("worker-token", w.leads)
    assert runner_leads == 1 and len(w.leads_repo.sent) == 1
    row = w.leads_repo.sent[0]
    assert "Left a cart" in row["message"] and "Dupatta" in row["message"] and row["external_id"] == "shopify:cart:chk-9" and "consent" not in row
    assert w.repo.checkouts["chk-9"]["status"] == "done" and w.repo.checkouts["chk-9"]["phone"] is None and w.repo.checkouts["chk-9"]["name"] is None
    assert w.commerce.run_checkouts("worker-token", w.leads) == 0


def test_the_worker_pass_purges_once_an_hour_and_skips_a_checkout_the_owner_turned_off() -> None:
    from app.commerce.wiring import CommerceRunner

    w = World()
    card = w.shopify().json()
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"abandoned": True}, headers=auth("a_owner"))
    w.deliver("shopify", "checkouts/create", {"token": "chk-1", "phone": "9000000006", "total_price": "10.00", "currency": "INR", "line_items": []})
    w.client.put(f"{T}/connections/{card['id']}/settings", json={"abandoned": False}, headers=auth("a_owner"))
    clock = [0.0]
    runner = CommerceRunner(w.commerce, w.leads, monotonic=lambda: clock[0])
    assert runner.run("worker-token") == 0 and w.leads_repo.sent == [] and w.repo.checkouts["chk-1"]["status"] == "skipped" and w.repo.purged == 1
    runner.run("worker-token")
    assert w.repo.purged == 1
    clock[0] = 4000.0
    runner.run("worker-token")
    assert w.repo.purged == 2


def test_nothing_personal_or_secret_reaches_the_log(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    w = World()
    w.shopify()
    token, value = w.hook("shopify")
    w.deliver("shopify", "orders/create", shopify_order())
    w.deliver("shopify", "orders/create", shopify_order(), secret_key="wrong")
    w.deliver("shopify", "checkouts/create", {"token": "c", "phone": "9000000009"})
    text = caplog.text
    for secret in (value["client_secret"], value["access_token"], value["lead_secret"], token, "9000000001", "asha@example.test", "Asha"):
        assert secret not in text, secret


# ============================================================================ what the phone assistant may say
def test_order_facts_say_only_what_the_store_says_and_allow_only_the_orders_own_amount() -> None:
    lines, amounts = facts.order_facts([{"number": "#1001", "status": "shipped", "payment": "cod", "paise": 129900, "items": "Silk saree x2", "tracking": "Delhivery AWB 123"}, {"number": "#1000", "status": "cancelled", "payment": "prepaid", "paise": 0, "items": "", "tracking": ""}, {"number": "", "status": "shipped"}, "x"])
    assert len(lines) == 2 and amounts == {129900}
    assert "#1001" in lines[0]["text"] and "cash on delivery" in lines[0]["text"] and "Rs 1,299" in lines[0]["text"] and "sent" in lines[0]["text"] and "Tracking: Delhivery AWB 123" in lines[0]["text"]
    assert "Tracking" not in lines[1]["text"] and "cancelled" in lines[1]["text"] and "Rs" not in lines[1]["text"]
    assert all(line["kind"] == "order" for line in lines)


def test_the_pack_carries_order_facts_and_the_money_guard_allows_the_total() -> None:
    pack = fact_pack.build({"orders": [{"number": "#1001", "status": "shipped", "payment": "cod", "paise": 129900, "items": "Silk saree", "tracking": ""}]})
    assert any(f["kind"] == "order" and "#1001" in f["text"] for f in pack.facts) and 129900 in pack.allowed_paise
    assert fact_pack.build({}).facts == () and fact_pack.build({"orders": []}).facts == ()


def test_order_facts_are_looked_up_for_the_callers_own_number_only() -> None:
    w = World()
    w.shopify()
    w.deliver("shopify", "orders/create", shopify_order())
    assert [r["number"] for r in w.repo.order_facts("w", TENANT_A.id, "+919000000001")] == ["#1001"]
    assert w.repo.order_facts("w", TENANT_A.id, "+919000000099") == []


# ============================================================================ the catalogue: preview, then save
def shopify_products() -> list[dict[str, Any]]:
    return [{"title": "Silk saree", "description": "Pure silk, 6 m", "variants": {"nodes": [{"title": "Default Title", "price": "1299.00", "sku": "S1", "availableForSale": True, "inventoryQuantity": 12}]}},
            {"title": "Kurta", "description": "Cotton", "variants": {"nodes": [{"title": "Small", "price": "499.00", "availableForSale": True, "inventoryQuantity": 2}, {"title": "Large", "price": "549.50", "availableForSale": False, "inventoryQuantity": 0}]}},
            {"title": "", "variants": {"nodes": []}}]


def test_the_catalogue_preview_maps_price_columns_availability_words_and_notes() -> None:
    w = World()
    card = w.shopify().json()
    w.stores.products_pages = [shopify_products()]
    r = w.client.post(f"{T}/connections/{card['id']}/catalogue/preview", json={"list_id": w.lists.list_json["id"]}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    rows = {row["name"]: row["cells"] for row in out["rows"]}
    assert rows["Silk saree"] == {"price": 129900, "availability": "In stock", "details": "Pure silk, 6 m"}
    assert rows["Kurta, Small"]["availability"] == "Few left" and rows["Kurta, Small"]["price"] == 49900
    assert rows["Kurta, Large"] == {"price": 54950, "availability": "Out of stock", "details": "Cotton"}
    assert {"code": "name_missing", "row": 4} in out["notes"] and {"code": "check_currency"} in out["notes"] and out["products_read"] == 3
    assert w.lists.imported == [], "a preview saves nothing"


def test_woocommerce_products_are_one_row_each() -> None:
    rows, notes = catalogue.woo_rows([{"name": "Kurta", "price": "499", "stock_status": "instock", "manage_stock": True, "stock_quantity": 1, "short_description": "<p>Cotton</p>", "type": "simple"}, {"name": "Set", "price": "", "regular_price": "", "stock_status": "outofstock", "type": "variable"}], FakeLists().list_json)
    assert rows[0] == {"name": "Kurta", "cells": {"price": 49900, "availability": "Few left", "details": "Cotton"}}
    assert {"code": "price_missing", "row": 2} in notes and {"code": "variable_products_one_row"} in notes


def test_save_goes_through_the_lists_own_import_and_only_for_this_workspaces_store() -> None:
    w = World()
    card = w.shopify().json()
    rows = [{"name": "Silk saree", "cells": {"price": 129900}}]
    r = w.client.post(f"{T}/connections/{card['id']}/catalogue/save", json={"list_id": w.lists.list_json["id"], "rows": rows}, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json() == {"created": 1, "updated": 0} and w.lists.imported == rows
    assert w.client.post(f"{T}/connections/{uuid.uuid4()}/catalogue/save", json={"list_id": w.lists.list_json["id"], "rows": rows}, headers=auth("a_owner")).status_code == 404
    assert w.client.post(f"{T}/connections/{card['id']}/catalogue/save", json={"list_id": w.lists.list_json["id"], "rows": []}, headers=auth("a_owner")).status_code == 422
    w.lists.list_json["kind"] = "services"
    assert w.client.post(f"{T}/connections/{card['id']}/catalogue/preview", json={"list_id": w.lists.list_json["id"]}, headers=auth("a_owner")).json()["error"]["code"] == "list_not_products"


def test_without_the_secret_store_nothing_can_be_connected() -> None:
    w = World()
    w.commerce.vault = None
    r = w.shopify()
    assert r.status_code == 503 and r.json()["error"]["code"] == "commerce_unavailable" and not w.repo.conns
