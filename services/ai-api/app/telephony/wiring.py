"""Inbound calls on the Exotel sandbox, as the deployment configures them (job phone-calls part 5). Kept apart from app/main.py, like the other wirings."""

# ruff: noqa: E501

from __future__ import annotations

import logging

from app.config import Settings
from app.rpc_base import RpcClient
from app.scheduler.session import PrincipalSession
from app.telephony.inbound import ExotelCalls, trial_rule
from app.telephony.inbound_routes import InboundService
from app.telephony.inbound_store import InboundStore
from app.telephony.settings import gate_settings


def build_phone_inbound(settings: Settings, rest_url: str, supabase_url: str, anon_key: str) -> InboundService | None:
    """Inbound calls on the Exotel sandbox (job phone-calls part 5). None unless TELEPHONY_MODE is
    sandbox or live AND the stream secret, the public address and the scheduler account are set.
    Exotel's own key (to confirm each call) is optional here: without it every call is refused."""

    gs = gate_settings(settings)
    secret = settings.exotel_stream_secret.get_secret_value() if settings.exotel_stream_secret else ""
    password = settings.scheduler_password.get_secret_value() if settings.scheduler_password else ""
    base = (settings.public_base_url or "").strip()
    missing = [n for n, v in (("EXOTEL_STREAM_SECRET", len(secret) >= 32), ("PUBLIC_BASE_URL", base), ("SCHEDULER_EMAIL", settings.scheduler_email), ("SCHEDULER_PASSWORD", password)) if not v]
    if gs.mode == "off":
        return None
    if missing:
        logging.getLogger("app.telephony.inbound").warning("inbound calls stay off: %s missing", ", ".join(missing))
        return None
    token = settings.exotel_api_token.get_secret_value() if settings.exotel_api_token else ""
    calls = None
    if settings.exotel_sid and settings.exotel_api_key and token:
        calls = ExotelCalls(settings.exotel_api_base or f"https://{settings.exotel_subdomain}", settings.exotel_sid, settings.exotel_api_key, token)
    principal = PrincipalSession(f"{supabase_url}/auth/v1", anon_key, str(settings.scheduler_email), password)
    return InboundService(
        secret=secret.encode("utf-8"), public_base=base, gate_settings=gs, store=InboundStore(RpcClient(rest_url, anon_key), principal), calls=calls,
        cost_paise_per_minute=settings.telephony_cost_paise_per_minute, language=settings.telephony_inbound_language if settings.telephony_inbound_language in ("en", "te", "hi", "kn", "ta", "ml") else "en",
        llm_choice=settings.telephony_llm, business=settings.telephony_inbound_business,
        url_format="text" if settings.exotel_stream_url_format == "text" else "json",
        our_sid=settings.exotel_sid or None,
        trial=trial_rule(settings.exotel_trial_number, settings.exotel_trial_caller, settings.exotel_sid, settings.exotel_trial_app_id,
                         max_calls_per_day=settings.exotel_trial_calls_per_day, max_call_s=settings.exotel_trial_max_call_s) if gs.mode == "sandbox" else None,
    )
