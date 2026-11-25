"""The two stores' own APIs, through the guarded client (app/outbound_http.py: SSRF guard, no redirects, size and time limits). Every method answers a closed word for what went wrong, never the store's text:
  bad_credentials | no_permission | unreachable | not_found | rate_limited

Shopify (Admin GraphQL, pinned version): https://shopify.dev/docs/api/usage/versioning (2026-10 is the latest stable on 25 Nov 2026), the token and its header X-Shopify-Access-Token:
  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin and, for an app made in the Dev Dashboard, the client credentials grant (a 24 hour token):
  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant . Webhooks: webhookSubscriptionCreate(topic, webhookSubscription: {uri}):
  https://shopify.dev/docs/api/admin-graphql/latest/mutations/webhookSubscriptionCreate . Products: https://shopify.dev/docs/api/admin-graphql/latest/queries/products (Product.title, description,
  status, variants; ProductVariant.title, price, sku, availableForSale, inventoryQuantity).
WooCommerce (REST v3, HTTP Basic with the consumer key and secret over https): https://woocommerce.github.io/woocommerce-rest-api-docs/ ; webhooks: POST /wp-json/wc/v3/webhooks {name, topic, delivery_url,
  secret} (https://developer.woocommerce.com/docs/apis/rest-api/v2/webhooks/ shows the same call on v2)."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import re
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from app.outbound_http import GuardedHttp, HttpResult
from app.webhooks_out import ssrf

SHOP = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$")
API_VERSION = "2026-10"
SHOPIFY_TOPICS = ("ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED", "ORDERS_FULFILLED", "CHECKOUTS_CREATE", "CHECKOUTS_UPDATE")
WOO_TOPICS = ("order.created", "order.updated")
MAX_PRODUCTS = 1000
_SITE_PATH = re.compile(r"^(/[A-Za-z0-9_-]{1,40}){0,3}$")


def shop_domain(raw: str) -> str | None:
    """`my-shop`, `my-shop.myshopify.com` or `https://my-shop.myshopify.com/admin` -> `my-shop.myshopify.com`; anything else (a custom domain, an address of ours) is not a Shopify Admin address."""
    text = (raw or "").strip().lower()
    text = re.sub(r"^https?://", "", text).split("/", 1)[0]
    if "." not in text and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,60}", text):
        text += ".myshopify.com"
    return text if SHOP.fullmatch(text) else None


def site_url(raw: str) -> str | None:
    """A WooCommerce site's address: https only, a real public-looking host name, at most a short folder (a shop in /store). Never a query, a user name or an IP number."""
    text = (raw or "").strip()
    if "://" not in text:
        text = "https://" + text
    try:
        ssrf.check_url(text.rstrip("/") + "/")
        parts = urlsplit(text)
    except (ssrf.UnsafeUrl, ValueError):
        return None
    path = (parts.path or "").rstrip("/")
    if parts.query or parts.fragment or not _SITE_PATH.fullmatch(path):
        return None
    port = f":{parts.port}" if parts.port and parts.port != 443 else ""
    return f"https://{parts.hostname}{port}{path}"


def _word(res: HttpResult) -> str:
    if res.status in (401,):
        return "bad_credentials"
    if res.status == 403:
        return "no_permission"
    if res.status == 404:
        return "not_found"
    if res.status == 429:
        return "rate_limited"
    return "unreachable"


class ShopifyApi:
    def __init__(self, http: GuardedHttp, shop: str, *, access_token: str | None = None, client_id: str | None = None, client_secret: str | None = None, monotonic: Callable[[], float] = time.monotonic) -> None:
        self._http, self._shop = http, shop
        self._token, self._client_id, self._secret, self._mono = access_token, client_id, client_secret, monotonic
        self._expires = float("inf") if access_token else 0.0

    def __repr__(self) -> str:
        return "ShopifyApi(<shop>)"

    def _base(self) -> str:
        return f"https://{self._shop}"

    def _allowed(self, host: str) -> bool:
        return host == self._shop

    def _access(self) -> tuple[str | None, str | None]:
        if self._token and self._mono() < self._expires:
            return self._token, None
        if not (self._client_id and self._secret):
            return None, "bad_credentials"
        res = self._http.post(f"{self._base()}/admin/oauth/access_token", form={"grant_type": "client_credentials", "client_id": self._client_id, "client_secret": self._secret}, allowed_host=self._allowed)
        if not res.ok or not isinstance(res.data, dict) or not isinstance(res.data.get("access_token"), str):
            return None, "bad_credentials" if res.status in (400, 401, 403) else "unreachable"
        expires = res.data.get("expires_in")
        self._token = res.data["access_token"]
        self._expires = self._mono() + (max(60.0, float(expires) - 300.0) if isinstance(expires, (int, float)) else 3600.0)
        return self._token, None

    def graphql(self, query: str, variables: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None]:
        token, err = self._access()
        if token is None:
            return None, err
        res = self._http.post(f"{self._base()}/admin/api/{API_VERSION}/graphql.json", headers={"X-Shopify-Access-Token": token}, json_body={"query": query, "variables": variables or {}}, allowed_host=self._allowed)
        if not res.ok or not isinstance(res.data, dict):
            return None, _word(res) if res.status else "unreachable"
        errors = res.data.get("errors")
        if errors:
            denied = any(isinstance(e, dict) and isinstance(e.get("extensions"), dict) and e["extensions"].get("code") == "ACCESS_DENIED" for e in errors if isinstance(errors, list))
            throttled = any(isinstance(e, dict) and isinstance(e.get("extensions"), dict) and e["extensions"].get("code") == "THROTTLED" for e in errors if isinstance(errors, list))
            return None, "no_permission" if denied else "rate_limited" if throttled else "unreachable"
        data = res.data.get("data")
        return (data, None) if isinstance(data, dict) else (None, "unreachable")

    def check(self) -> str | None:
        """None when the store answers its own name with these credentials, else a closed word."""
        data, err = self.graphql("{ shop { name } }")
        return err if data is None else None

    def register_webhooks(self, address: str, topics: tuple[str, ...] = SHOPIFY_TOPICS) -> str | None:
        """Subscribe each topic to `address`. A subscription that already exists is fine. None when all are in place, else the first closed word."""
        mutation = "mutation($topic: WebhookSubscriptionTopic!, $s: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $s) { webhookSubscription { id } userErrors { field message } } }"
        for topic in topics:
            data, err = self.graphql(mutation, {"topic": topic, "s": {"uri": address}})
            if data is None:
                return err
            made = data.get("webhookSubscriptionCreate")
            problems = made.get("userErrors") if isinstance(made, dict) else None
            if problems:
                text = " ".join(str(p.get("message", "")) for p in problems if isinstance(p, dict)).lower()
                if "taken" in text or "already" in text:
                    continue
                return "no_permission"
        return None

    def products(self, limit: int = MAX_PRODUCTS) -> tuple[list[dict[str, Any]], str | None]:
        query = ("query($after: String) { products(first: 50, after: $after, query: \"status:active\") { pageInfo { hasNextPage endCursor } "
                 "nodes { title description variants(first: 50) { nodes { title price sku availableForSale inventoryQuantity } } } } }")
        out: list[dict[str, Any]] = []
        after: str | None = None
        for _ in range(40):
            data, err = self.graphql(query, {"after": after})
            if data is None:
                return out, err
            block: dict[str, Any] = data["products"] if isinstance(data.get("products"), dict) else {}
            out += [n for n in (block.get("nodes") or []) if isinstance(n, dict)]
            info: dict[str, Any] = block["pageInfo"] if isinstance(block.get("pageInfo"), dict) else {}
            after = info.get("endCursor") if isinstance(info.get("endCursor"), str) else None
            if not info.get("hasNextPage") or not after or len(out) >= limit:
                break
        return out[:limit], None


class WooApi:
    def __init__(self, http: GuardedHttp, base: str, key: str, secret: str) -> None:
        self._http, self._base = http, base.rstrip("/")
        self._auth = "Basic " + base64.b64encode(f"{key}:{secret}".encode()).decode("ascii")
        self._host = urlsplit(base).hostname or ""

    def __repr__(self) -> str:
        return "WooApi(<site>)"

    def _allowed(self, host: str) -> bool:
        return host == self._host

    def _get(self, path: str) -> HttpResult:
        return self._http.get(f"{self._base}/wp-json/wc/v3/{path}", headers={"Authorization": self._auth}, allowed_host=self._allowed)

    def check(self) -> str | None:
        res = self._get("products?per_page=1")
        return None if res.ok else _word(res)

    def register_webhooks(self, address: str, secret: str, topics: tuple[str, ...] = WOO_TOPICS) -> str | None:
        have = self._get("webhooks?per_page=100")
        if not have.ok:
            return _word(have)
        present = {w.get("topic") for w in (have.data or []) if isinstance(w, dict) and w.get("delivery_url") == address} if isinstance(have.data, list) else set()
        for topic in topics:
            if topic in present:
                continue
            res = self._http.post(f"{self._base}/wp-json/wc/v3/webhooks", headers={"Authorization": self._auth}, json_body={"name": f"Stack19 {topic}", "topic": topic, "delivery_url": address, "secret": secret, "status": "active"}, allowed_host=self._allowed)
            if not res.ok:
                return _word(res)
        return None

    def products(self, limit: int = MAX_PRODUCTS) -> tuple[list[dict[str, Any]], str | None]:
        out: list[dict[str, Any]] = []
        for page in range(1, 21):
            res = self._get(f"products?per_page=100&page={page}&status=publish")
            if not res.ok:
                return out, _word(res)
            rows = [p for p in (res.data or []) if isinstance(p, dict)] if isinstance(res.data, list) else []
            out += rows
            if len(rows) < 100 or len(out) >= limit:
                break
        return out[:limit], None
