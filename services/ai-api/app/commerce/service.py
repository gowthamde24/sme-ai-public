"""What the commerce routes, the stores' webhook receiver and the worker do (docs/contracts/commerce-notify.md section B).

A store event becomes a Stack19 job the safe way: through the ordinary lead intake (LeadSourcesService.receive_form on a webhook source made for this store), so the database decides consent, do-not-call,
calling hours, the daily call limit, the wallet and duplicates exactly as it does for every other lead; the order's words travel in the lead's message and the assistant's first touch (the owner's own rule for
new leads) does the confirming call or WhatsApp. A customer whose consent we cannot show is "ask first": nothing is called. Consent is shown only when the OWNER says (`checkout_consent`) that the store's
checkout tells customers they may be called or messaged about their order, and the evidence is stored as the store's own say-so with the order's time.

Credentials: Shopify (shop, a custom-app Admin API token OR a Dev Dashboard app's client id, and the app's client secret, which also signs its webhooks) and WooCommerce (site, consumer key and secret; we make the
webhook secret). They live in the connector vault (Secret Manager) as one JSON value per workspace and store kind; the database keeps only the store's public name and the last four characters. Nothing here
logs a number, a name, an address, a header or a key."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from app.commerce import catalogue, events, stores, verify
from app.commerce.repository import CommerceRepository
from app.connector_vault import ConnectorVault, tail
from app.errors import ApiError, not_found
from app.outbound_http import GuardedHttp

logger = logging.getLogger("app.commerce")

MAX_WEBHOOK_BYTES = 512 * 1024
DEFAULTS: dict[str, Any] = {"confirm_orders": "cod", "abandoned": False, "abandoned_after_min": 60, "checkout_consent": False, "share_status": True, "cod_words": []}
CONSENT_TEXT = "The shop's checkout asks customers to agree that the shop may call or message them about their order."
SAFE_TOPICS_SHOPIFY = {"orders/create", "orders/updated", "orders/cancelled", "orders/fulfilled", "checkouts/create", "checkouts/update"}
SAFE_TOPICS_WOO = {"order.created", "order.updated"}


class LeadIntake(Protocol):
    def receive_form(self, secret: str, data: dict[str, Any]) -> None: ...


def address_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def effective(settings: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(DEFAULTS)
    out.update({k: v for k, v in (settings or {}).items() if k in DEFAULTS or k in ("checkout_consent_at",)})
    return out


def refused(code: str, text: str, status: int = 409, extra: dict[str, Any] | None = None) -> ApiError:
    return ApiError(status, code, text, extra=extra)


PROBLEM_WORDS = {
    "bad_credentials": "The store did not accept these keys. Check them and try again.",
    "no_permission": "The keys do not allow this. Give the app permission to read orders and products and to manage webhooks.",
    "unreachable": "We could not reach the store. Check the address and that the site is online.",
    "not_found": "We could not find the store's API at that address.",
    "rate_limited": "The store asked us to slow down. Try again in a minute.",
}


class Commerce:
    def __init__(self, repo: CommerceRepository, vault: ConnectorVault | None, http: GuardedHttp, *, public_base_url: str | None, receiver: Any = None) -> None:
        self.repo, self.vault, self.http = repo, vault, http
        self.public_base_url = (public_base_url or "").rstrip("/") or None
        self.receiver = receiver

    # ------------------------------------------------------------------------------------------------------------- helpers
    def _vault(self) -> ConnectorVault:
        if self.vault is None:
            raise ApiError(503, "commerce_unavailable", "Connecting a store is not available right now. Try again in a minute.", retry_after=30)
        return self.vault

    def _address(self, kind: str, token: str) -> str:
        if self.public_base_url is None:
            raise refused("public_address_missing", "Stack19's public address is not set up, so a store cannot send us events yet.", 503)
        return f"{self.public_base_url}/v1/webhooks/commerce/{kind}/{token}"

    def _worker_token(self) -> str:
        if self.receiver is None:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.")
        try:
            return str(self.receiver.token())
        except Exception:   # noqa: BLE001 - the sign-in's own text never leaves
            raise ApiError(503, "webhooks_unavailable", "Not available right now.") from None

    @staticmethod
    def _card(c: dict[str, Any]) -> dict[str, Any]:
        out = dict(c)
        out["settings"] = effective(c.get("settings") if isinstance(c.get("settings"), dict) else {})
        out["abandoned_supported"] = c.get("kind") == "shopify"
        return out

    def _api(self, tenant_id: uuid.UUID, kind: str, label: str) -> tuple[Any, dict[str, Any]] | None:
        value = self._vault().get(tenant_id, kind)
        if value is None:
            return None
        if kind == "shopify":
            return stores.ShopifyApi(self.http, label, access_token=value.get("access_token"), client_id=value.get("client_id"), client_secret=value.get("client_secret")), value
        return stores.WooApi(self.http, str(value.get("site") or ""), str(value.get("key") or ""), str(value.get("secret") or "")), value

    # ------------------------------------------------------------------------------------------------------------- the owner's routes
    def connections(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [self._card(c) for c in self.repo.connections(token, tenant_id)]

    def _lead_secret(self, token: str, tenant_id: uuid.UUID, lead_sources: Any, connection_id: uuid.UUID, label: str) -> tuple[uuid.UUID, str]:
        """A webhook lead source for this store (one per connection); its secret is made here and kept only in the vault. Reconnecting rotates it (the old address stops)."""
        from app.lead_sources.models import SourceCreate

        source_id = uuid.uuid5(connection_id, "commerce-lead-source")
        out, created = lead_sources.source_create(token, tenant_id, SourceCreate(source_id=source_id, kind="webhook", label=f"Online store: {label}"[:60]))
        if not created or not isinstance(out.get("secret"), dict):
            out = lead_sources.source_rotate(token, tenant_id, source_id)
        url = str((out.get("secret") or {}).get("url") or "")
        secret = url.rsplit("/", 1)[-1]
        if not secret:
            raise ApiError(502, "commerce_failed", "That did not work. Try again.")
        return source_id, secret

    def connect_shopify(self, token: str, tenant_id: uuid.UUID, lead_sources: Any, *, connection_id: uuid.UUID, shop: str, client_secret: str, access_token: str | None, client_id: str | None) -> dict[str, Any]:
        domain = stores.shop_domain(shop)
        if domain is None:
            raise refused("store_address_invalid", "Use the store's myshopify.com address, for example my-shop.myshopify.com.", 422, {"fields": ["shop"]})
        if bool(access_token) == bool(client_id):
            raise refused("credentials_invalid", "Give either the Admin API access token or the app's client id, not both and not neither.", 422, {"fields": ["access_token", "client_id"]})
        api = stores.ShopifyApi(self.http, domain, access_token=access_token, client_id=client_id, client_secret=client_secret)
        problem = api.check()
        if problem is not None:
            raise refused("store_refused", PROBLEM_WORDS.get(problem, PROBLEM_WORDS["unreachable"]), 422, {"reason": problem})
        hook = secrets.token_urlsafe(24)
        address = self._address("shopify", hook)
        source_id, lead_secret = self._lead_secret(token, tenant_id, lead_sources, connection_id, domain)
        vault = self._vault()
        vault.put(tenant_id, "shopify", {"shop": domain, "access_token": access_token, "client_id": client_id, "client_secret": client_secret, "webhook_token": hook, "lead_secret": lead_secret})
        try:
            made = self.repo.connect(token, tenant_id, connection_id, "shopify", domain, address_hash(hook), tail(access_token or client_secret), source_id)
        except Exception:
            vault.delete(tenant_id, "shopify")
            raise
        reg = api.register_webhooks(address)
        marked = self.repo.mark(token, tenant_id, uuid.UUID(str(made["id"])), "connected" if reg is None else "problem", None if reg is None else ("webhooks_not_registered" if reg != "no_permission" else "no_permission"), reg is None)
        card = self._card(marked or made)
        if reg is not None:
            card["manual_setup"] = {"address": address, "note": "Add these webhook topics in your store: orders/create, orders/updated, orders/cancelled, orders/fulfilled, checkouts/create, checkouts/update; format JSON."}
        return card

    def connect_woo(self, token: str, tenant_id: uuid.UUID, lead_sources: Any, *, connection_id: uuid.UUID, site: str, key: str, secret: str) -> dict[str, Any]:
        base = stores.site_url(site)
        if base is None:
            raise refused("store_address_invalid", "Use the shop's https address, for example https://shop.example.com.", 422, {"fields": ["site"]})
        label = base.split("://", 1)[1].split("/", 1)[0]
        api = stores.WooApi(self.http, base, key, secret)
        problem = api.check()
        if problem is not None:
            raise refused("store_refused", PROBLEM_WORDS.get(problem, PROBLEM_WORDS["unreachable"]), 422, {"reason": problem})
        hook, hook_secret = secrets.token_urlsafe(24), secrets.token_urlsafe(32)
        address = self._address("woocommerce", hook)
        source_id, lead_secret = self._lead_secret(token, tenant_id, lead_sources, connection_id, label)
        vault = self._vault()
        vault.put(tenant_id, "woocommerce", {"site": base, "key": key, "secret": secret, "webhook_secret": hook_secret, "webhook_token": hook, "lead_secret": lead_secret})
        try:
            made = self.repo.connect(token, tenant_id, connection_id, "woocommerce", label, address_hash(hook), tail(key), source_id)
        except Exception:
            vault.delete(tenant_id, "woocommerce")
            raise
        reg = api.register_webhooks(address, hook_secret)
        marked = self.repo.mark(token, tenant_id, uuid.UUID(str(made["id"])), "connected" if reg is None else "problem", None if reg is None else "webhooks_not_registered", reg is None)
        card = self._card(marked or made)
        if reg is not None:
            card["manual_setup"] = {"address": address, "secret": hook_secret, "note": "In WooCommerce open Settings, Advanced, Webhooks and add Order created and Order updated with this delivery URL and this secret. The secret is shown only now."}
        return card

    def set_settings(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, settings: dict[str, Any]) -> dict[str, Any]:
        got = self.repo.settings_set(token, tenant_id, connection_id, settings)
        if got is None:
            raise not_found()
        return self._card(got)

    def _connection(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> dict[str, Any]:
        for c in self.repo.connections(token, tenant_id):
            if str(c.get("id")) == str(connection_id):
                return c
        raise not_found()

    def test(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> dict[str, Any]:
        """Check the keys and put the webhooks in place again (existing ones are left alone). The card's state follows the result."""
        c = self._connection(token, tenant_id, connection_id)
        got = self._api(tenant_id, str(c["kind"]), str(c["store_label"]))
        if got is None:
            marked = self.repo.mark(token, tenant_id, connection_id, "problem", "bad_credentials", False)
            return self._card(marked or c)
        api, value = got
        problem = api.check()
        if problem is not None:
            marked = self.repo.mark(token, tenant_id, connection_id, "problem", "bad_credentials" if problem == "bad_credentials" else "unreachable" if problem in ("unreachable", "not_found") else "no_permission", False)
            return self._card(marked or c)
        address = self._address(str(c["kind"]), str(value.get("webhook_token")))
        reg = api.register_webhooks(address) if c["kind"] == "shopify" else api.register_webhooks(address, str(value.get("webhook_secret")))
        marked = self.repo.mark(token, tenant_id, connection_id, "connected" if reg is None else "problem", None if reg is None else ("no_permission" if reg == "no_permission" else "webhooks_not_registered"), reg is None)
        return self._card(marked or c)

    def disconnect(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID) -> bool:
        c = self._connection(token, tenant_id, connection_id)
        done = self.repo.disconnect(token, tenant_id, connection_id)
        if done:
            try:
                self._vault().delete(tenant_id, str(c["kind"]))   # the store's webhooks keep pointing at an address that no longer exists: they get a 404 and stop
            except Exception:   # noqa: BLE001 - the connection is already closed in the database; a left-over key is retried by disconnecting again
                logger.warning("commerce: the stored keys could not be removed")
        return done

    # ------------------------------------------------------------------------------------------------------------- catalogue: preview, then save
    def catalogue_preview(self, token: str, tenant_id: uuid.UUID, connection_id: uuid.UUID, list_json: dict[str, Any]) -> dict[str, Any]:
        c = self._connection(token, tenant_id, connection_id)
        got = self._api(tenant_id, str(c["kind"]), str(c["store_label"]))
        if got is None:
            raise refused("store_refused", PROBLEM_WORDS["bad_credentials"], 422, {"reason": "bad_credentials"})
        api, _ = got
        products, problem = api.products()
        if problem is not None and not products:
            raise refused("store_refused", PROBLEM_WORDS.get(problem, PROBLEM_WORDS["unreachable"]), 422, {"reason": problem})
        rows, notes = (catalogue.shopify_rows if c["kind"] == "shopify" else catalogue.woo_rows)(products, list_json)
        if problem is not None:
            notes.append({"code": "partial", "reason": problem})
        return {"rows": rows, "notes": notes, "products_read": len(products)}

    # ------------------------------------------------------------------------------------------------------------- the stores' webhooks (no person signs in: the store's own signature is the check)
    def receive(self, lead_sources: LeadIntake | None, kind: str, address_token: str, headers: dict[str, str], raw: bytes) -> str:
        """`ok`, `ignored` or raises ApiError: 404 unknown address, 401 wrong signature, 503 our side failed (the store retries). Nothing is read from a body before its signature checks out."""
        if kind not in ("shopify", "woocommerce") or not 20 <= len(address_token) <= 64:
            raise not_found()
        worker = self._worker_token()
        conn = self.repo.by_token(worker, address_hash(address_token))
        if conn is None or conn.get("kind") != kind:
            raise not_found()
        tenant_id = uuid.UUID(str(conn["tenant_id"]))
        value = self._vault().get(tenant_id, kind)
        if value is None:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.")
        if kind == "shopify":
            ok = verify.signature_ok(value.get("client_secret"), raw, headers.get("x-shopify-hmac-sha256"))
            topic = headers.get("x-shopify-topic", "")
            known = SAFE_TOPICS_SHOPIFY
        else:
            ok = verify.signature_ok(value.get("webhook_secret"), raw, headers.get("x-wc-webhook-signature"))
            topic = headers.get("x-wc-webhook-topic", "")
            known = SAFE_TOPICS_WOO
        if not ok:
            logger.warning("commerce webhook: signature refused (%s)", kind)
            raise ApiError(401, "unauthorized", "Not authorised.")
        if topic not in known:
            return "ignored"
        try:
            payload = json.loads(raw)
        except ValueError:
            return "ignored"   # WooCommerce's first ping is a form body
        if not isinstance(payload, dict):
            return "ignored"
        settings = effective(conn.get("settings") if isinstance(conn.get("settings"), dict) else {})
        words = tuple(str(w) for w in settings.get("cod_words") or [])
        if topic.startswith("checkouts/"):
            return self._checkout(worker, tenant_id, conn, settings, events.shopify_checkout(payload))
        order = events.shopify_order(payload, extra_cod_words=words) if kind == "shopify" else events.woo_order(payload, extra_cod_words=words)
        return self._order(worker, lead_sources, tenant_id, conn, value, settings, order)

    def _checkout(self, worker: str, tenant_id: uuid.UUID, conn: dict[str, Any], settings: dict[str, Any], ev: events.CheckoutEvent | None) -> str:
        if ev is None or not settings["abandoned"] or (ev.phone is None and not ev.completed):
            return "ignored"
        self.repo.checkout_upsert(worker, tenant_id, uuid.UUID(str(conn["id"])), ev, int(settings["abandoned_after_min"]))
        return "ok"

    def _order(self, worker: str, lead_sources: LeadIntake | None, tenant_id: uuid.UUID, conn: dict[str, Any], value: dict[str, Any], settings: dict[str, Any], ev: events.OrderEvent | None) -> str:
        if ev is None:
            return "ignored"
        cid = uuid.UUID(str(conn["id"]))
        up = self.repo.order_upsert(worker, tenant_id, cid, ev)
        wanted = settings["confirm_orders"] == "all" or (settings["confirm_orders"] == "cod" and ev.payment == "cod")
        fresh = datetime.now(UTC) - ev.placed_at < timedelta(minutes=30)
        if not wanted or ev.phone is None or ev.status in ("cancelled", "returned") or up.get("lead_sent") or not (up.get("created") or fresh):
            return "ok"
        if lead_sources is None:
            raise ApiError(503, "webhooks_unavailable", "Not available right now.")
        verdict = self._send_lead(lead_sources, value, settings, str(conn["kind"]), self._order_row(ev, str(conn["kind"])), ev.placed_at)
        if verdict == "retry":
            raise ApiError(503, "webhooks_unavailable", "Not available right now.", retry_after=60)
        if verdict == "ok":
            self.repo.order_lead_sent(worker, tenant_id, cid, ev.external_id)
        return "ok"

    @staticmethod
    def _order_row(ev: events.OrderEvent, kind: str) -> dict[str, Any]:
        how = "cash on delivery" if ev.payment == "cod" else "paid online" if ev.payment == "prepaid" else "payment not known"
        amount = f", Rs {ev.total_paise // 100:,}" if ev.total_paise else ""
        message = f"Online order {ev.number} ({how}{amount}): {ev.items or 'items not listed'}. Confirm the order and the delivery address with the customer."
        row: dict[str, Any] = {"phone": ev.phone, "message": message[:1000], "external_id": f"{kind}:order:{ev.external_id}"[:200]}
        for field, v in (("name", ev.name), ("email", ev.email), ("city", ev.city)):
            if v:
                row[field] = v
        return row

    @staticmethod
    def _send_lead(lead_sources: LeadIntake, value: dict[str, Any], settings: dict[str, Any], kind: str, row: dict[str, Any], when: datetime) -> str:
        """`ok` (arrived), `retry` (rate limited: try again), `skip` (refused or the source is gone). The lead's consent is shown only when the owner said the checkout asks for it."""
        secret = value.get("lead_secret")
        if not isinstance(secret, str) or not secret:
            return "skip"
        data = dict(row)
        if settings["checkout_consent"]:
            now = datetime.now(UTC)
            data.update({"consent": "yes", "consent_text": CONSENT_TEXT, "consent_at": min(max(when, now - timedelta(days=29)), now).isoformat(), "consent_form": f"{kind} checkout"})
        try:
            lead_sources.receive_form(secret, data)
        except ApiError as err:
            if err.status_code == 429:
                return "retry"
            logger.info("commerce: a lead was not taken (%s)", err.code)
            return "skip"
        return "ok"

    # ------------------------------------------------------------------------------------------------------------- the worker: checkouts whose wait is over
    def run_checkouts(self, worker: str, lead_sources: LeadIntake | None, limit: int = 20) -> int:
        rows = self.repo.checkouts_claim(worker, limit)
        done = 0
        for r in rows:
            cid = uuid.UUID(str(r["id"]))
            try:
                kind = str(r.get("kind"))
                value = self._vault().get(uuid.UUID(str(r["tenant_id"])), kind) if lead_sources is not None else None
                if lead_sources is None or value is None or not r.get("abandoned") or not r.get("phone"):
                    self.repo.checkout_finish(worker, cid, "skipped")
                    continue
                amount = f", Rs {int(r.get('total_paise') or 0) // 100:,}" if int(r.get("total_paise") or 0) else ""
                row: dict[str, Any] = {"phone": r["phone"], "message": f"Left a cart at the online store ({r.get('items') or 'items not listed'}{amount}). Offer to help finish the order.", "external_id": f"{kind}:cart:{r['external_id']}"[:200]}
                if r.get("name"):
                    row["name"] = r["name"]
                settings = effective(r.get("settings") if isinstance(r.get("settings"), dict) else {})
                created = r.get("created_at")
                when = datetime.fromisoformat(str(created).replace("Z", "+00:00")) if created else datetime.now(UTC)
                verdict = self._send_lead(lead_sources, value, settings, kind, row, when)
                self.repo.checkout_finish(worker, cid, "done" if verdict == "ok" else "retry" if verdict == "retry" else "skipped")
                done += verdict == "ok"
            except Exception as exc:   # noqa: BLE001 - one checkout never stops the others; its lease runs out and it is tried again
                logger.error("commerce: a checkout call-back crashed: %s", exc.__class__.__name__)
        return done


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
