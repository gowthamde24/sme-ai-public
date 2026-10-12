"""Builds the connectors from settings (job BZ). Everything is off by default. A provider that is named without what it needs stops the process at start (a mistake, not a silent fallback), and any connector
needs INTEGRATIONS_TENANT_ID: the credentials belong to the installation, so exactly one workspace may use them."""

from __future__ import annotations

import re
import uuid

import httpx

from app.config import ConfigurationError, Settings
from app.connectors.calls import CallBridge, ExotelBridge, FakeBridge
from app.connectors.indiamart import FixtureLeadSource, IndiaMartPull, LeadSource
from app.connectors.payments import (
    CashfreePayments,
    FakePayments,
    PaymentProvider,
    RazorpayPayments,
)
from app.connectors.phone import normalise
from app.connectors.repository import PostgrestConnectorsRepository
from app.connectors.runtime import Connectors
from app.connectors.texts import LANGUAGES
from app.scheduler.session import PrincipalSession


def _secret(value: object, name: str) -> str:
    text = value.get_secret_value() if value is not None and hasattr(value, "get_secret_value") else value
    if not isinstance(text, str) or not text.strip():
        raise ConfigurationError(f"{name} is required for the provider that was chosen")
    return text.strip()


def build_connectors(settings: Settings, rest_url: str, auth_url: str, anon_key: str) -> Connectors | None:
    names = (settings.indiamart_provider, settings.payments_provider, settings.calls_provider)
    if all(n == "off" for n in names):
        return None
    try:
        tenant = uuid.UUID(settings.integrations_tenant_id or "")
    except ValueError:
        raise ConfigurationError("INTEGRATIONS_TENANT_ID (a workspace id) is required for any connector") from None
    if settings.missed_call_reply_language not in LANGUAGES:
        raise ConfigurationError("MISSED_CALL_REPLY_LANGUAGE must be en, te, hi or kn")
    base = (settings.public_base_url or "").strip().rstrip("/") or None
    if base is not None and not base.startswith("https://") and not (settings.is_development and base.startswith("http://localhost")):
        raise ConfigurationError("PUBLIC_BASE_URL must be an https address")

    leads: LeadSource | None = None
    if settings.indiamart_provider == "fake":
        leads = FixtureLeadSource()
    elif settings.indiamart_provider == "real":
        leads = IndiaMartPull(_secret(settings.indiamart_crm_key, "INDIAMART_CRM_KEY"))
    elif settings.indiamart_provider != "off":
        raise ConfigurationError("INDIAMART_PROVIDER must be off, fake or real")

    payments: PaymentProvider | None = None
    if settings.payments_provider == "fake":
        payments = FakePayments()
    elif settings.payments_provider == "razorpay":
        payments = RazorpayPayments(
            _secret(settings.razorpay_key_id, "RAZORPAY_KEY_ID"), _secret(settings.razorpay_key_secret, "RAZORPAY_KEY_SECRET"), _secret(settings.razorpay_webhook_secret, "RAZORPAY_WEBHOOK_SECRET")
        )
    elif settings.payments_provider == "cashfree":
        if settings.cashfree_env not in ("sandbox", "production"):
            raise ConfigurationError("CASHFREE_ENV must be sandbox or production")
        payments = CashfreePayments(
            _secret(settings.cashfree_client_id, "CASHFREE_CLIENT_ID"),
            _secret(settings.cashfree_client_secret, "CASHFREE_CLIENT_SECRET"),
            production=settings.cashfree_env == "production",
            notify_url=f"{base}/v1/webhooks/cashfree" if base else None,
        )
    elif settings.payments_provider != "off":
        raise ConfigurationError("PAYMENTS_PROVIDER must be off, fake, razorpay or cashfree")

    calls: CallBridge | None = None
    agent: str | None = None
    token: str | None = None
    if settings.calls_provider != "off":
        agent = normalise(settings.exotel_agent_number)
        if settings.calls_provider == "fake":
            agent = agent or "+910000000000"
            calls = FakeBridge()
        elif settings.calls_provider == "exotel":
            if agent is None:
                raise ConfigurationError("EXOTEL_AGENT_NUMBER (the shop's own phone) is required")
            try:
                calls = ExotelBridge(
                    _secret(settings.exotel_sid, "EXOTEL_SID"),
                    _secret(settings.exotel_api_key, "EXOTEL_API_KEY"),
                    _secret(settings.exotel_api_token, "EXOTEL_API_TOKEN"),
                    _secret(settings.exotel_caller_id, "EXOTEL_CALLER_ID"),
                    subdomain=settings.exotel_subdomain,
                )
            except ValueError as exc:
                raise ConfigurationError(str(exc)) from None
        else:
            raise ConfigurationError("CALLS_PROVIDER must be off, fake or exotel")
        token = _secret(settings.exotel_webhook_token, "EXOTEL_WEBHOOK_TOKEN")
        if len(token) < 24 or not re.fullmatch(r"[A-Za-z0-9_-]+", token):
            raise ConfigurationError("EXOTEL_WEBHOOK_TOKEN must be at least 24 letters, digits, - or _")

    receiver: PrincipalSession | None = None
    if settings.scheduler_email and settings.scheduler_password and settings.scheduler_password.get_secret_value():
        receiver = PrincipalSession(auth_url, anon_key, settings.scheduler_email, settings.scheduler_password.get_secret_value(), client=httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)))
    return Connectors(
        repo=PostgrestConnectorsRepository(rest_url, anon_key),
        tenant_id=tenant,
        leads=leads,
        payments=payments,
        calls=calls,
        receiver=receiver,
        agent_number=agent,
        webhook_token=token,
        public_base_url=base,
        reply_language=settings.missed_call_reply_language,
    )
