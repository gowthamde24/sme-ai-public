"""The stores' webhook signatures. Both are HMAC-SHA256 over the RAW body, base64 in a header:
  Shopify      header X-Shopify-Hmac-SHA256, key = the app's client secret (https://shopify.dev/docs/apps/build/webhooks/subscribe/https)
  WooCommerce  header X-WC-Webhook-Signature, key = the webhook's secret (woocommerce/includes/class-wc-webhook.php generate_signature)
A missing, malformed or wrong signature is simply False; the comparison is constant time."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import hmac


def _digest(secret: str, raw: bytes) -> str:
    return base64.b64encode(hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()).decode("ascii")


def signature_ok(secret: str | None, raw: bytes, header: str | None) -> bool:
    if not secret or not header or len(header) > 200:
        return False
    return hmac.compare_digest(_digest(secret, raw).encode("ascii"), header.strip().encode("utf-8", "ignore"))


def sign(secret: str, raw: bytes) -> str:
    """What a store would send (the tests and the Test button's self-check use it)."""
    return _digest(secret, raw)
