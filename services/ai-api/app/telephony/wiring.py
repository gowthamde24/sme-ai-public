"""Inbound calls on the Exotel sandbox, as the deployment configures them (job phone-calls part 5). Kept apart from app/main.py, like the other wirings."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import uuid
from contextlib import suppress
from typing import Any

from app.config import ConfigurationError, Settings
from app.rpc_base import RpcClient
from app.scheduler.session import PrincipalSession
from app.telephony.inbound import ExotelCalls, trial_rule
from app.telephony.inbound_routes import InboundService
from app.telephony.inbound_store import InboundStore
from app.telephony.opening_store import OpeningStore
from app.telephony.plivo_api import PlivoApi
from app.telephony.plivo_outbound import PlivoOutbound, PostgrestOutboundRepo
from app.telephony.plivo_routes import PlivoConfig, SubaccountTokens
from app.telephony.settings import gate_settings
from app.voice.budget import RpcVoiceBudget
from app.workspace_secrets import GcpSecretStore


def build_phone_inbound(settings: Settings, rest_url: str, supabase_url: str, anon_key: str) -> InboundService | None:
    """Inbound calls on the Exotel sandbox (job phone-calls part 5). None unless TELEPHONY_MODE is
    sandbox or live AND the stream secret, the public address and the scheduler account are set.
    Exotel's own key (to confirm each call) is optional here: without it every call is refused."""

    gs = gate_settings(settings)
    secret = settings.exotel_stream_secret.get_secret_value() if settings.exotel_stream_secret else ""
    password = settings.scheduler_password.get_secret_value() if settings.scheduler_password else ""
    base = (settings.public_base_url or "").strip()
    plivo_token = settings.plivo_auth_token.get_secret_value() if settings.plivo_auth_token else ""
    # a deployment can answer Exotel (needs its stream secret), Plivo (needs its Auth Token), or both
    missing = [n for n, v in (("EXOTEL_STREAM_SECRET or PLIVO_AUTH_TOKEN", len(secret) >= 32 or len(plivo_token) >= 16), ("PUBLIC_BASE_URL", base), ("SCHEDULER_EMAIL", settings.scheduler_email), ("SCHEDULER_PASSWORD", password)) if not v]
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
    outbound_repo = PostgrestOutboundRepo(RpcClient(rest_url, anon_key))
    tokens = None   # the Auth Token of a subaccount's line: read from Secret Manager by the line's account_ref (WORKSPACE_SECRETS=gcp); without it only the main account's lines are believed
    if (settings.workspace_secrets or "off").strip().lower() == "gcp" and settings.workspace_secrets_project:
        with suppress(ValueError):
            tokens = SubaccountTokens(GcpSecretStore(settings.workspace_secrets_project))
    placer = None
    if gs.outbound and len(plivo_token) >= 16 and settings.plivo_auth_id:   # outbound calls: TELEPHONY_OUTBOUND=true AND the Plivo Auth ID and Auth Token (the gate still decides every call)
        def api_for(line: dict[str, Any]) -> PlivoApi | None:
            sub_id, sub_token = line.get("external_ref"), tokens(line) if tokens is not None else None
            return PlivoApi(str(sub_id), sub_token) if sub_id and sub_token else None

        placer = PlivoOutbound(api=PlivoApi(settings.plivo_auth_id, plivo_token), repo=outbound_repo, gate_settings=gs, public_base=base, max_call_s=max(30, min(int(settings.telephony_max_call_s), 300)), api_for=api_for,
                              id_key=hashlib.sha256(("test-number|" + plivo_token).encode()).digest())
    return InboundService(
        secret=secret.encode("utf-8") if len(secret) >= 32 else b"", public_base=base, gate_settings=gs, store=InboundStore(RpcClient(rest_url, anon_key), principal), calls=calls,
        cost_paise_per_minute=settings.telephony_cost_paise_per_minute, cost_pulse_s=settings.telephony_cost_pulse_s, language=settings.telephony_inbound_language if settings.telephony_inbound_language in ("en", "te", "hi", "kn", "ta", "ml", "mr") else "en",
        llm_choice=settings.telephony_llm, business=settings.telephony_inbound_business,
        max_call_s=max(30, min(int(settings.telephony_max_call_s), 300)),
        english_lines=True, call_summaries=True,
        url_format="text" if settings.exotel_stream_url_format == "text" else "json",
        our_sid=settings.exotel_sid or None,
        budget=RpcVoiceBudget(RpcClient(rest_url, anon_key), principal.token),
        opening_store=OpeningStore(f"{supabase_url}/storage/v1", anon_key, principal.token),
        plivo=PlivoConfig(auth_token=plivo_token, public_base=base, token_for=tokens) if len(plivo_token) >= 16 else None,
        outbound=placer, outbound_repo=outbound_repo,
        trial=trial_rule(settings.exotel_trial_number, settings.exotel_trial_caller, settings.exotel_sid, settings.exotel_trial_app_id,
                         max_calls_per_day=settings.exotel_trial_calls_per_day, max_call_s=settings.exotel_trial_max_call_s) if gs.mode == "sandbox" else None,
    )


def build_tasks_dialer(settings: Any, phone: Any, tone_for: Any = None) -> Any:
    """The dialer of approved Lead Desk tasks. `plivo` only when the phone service can place outbound calls (TELEPHONY_OUTBOUND, Plivo Auth ID and Token); otherwise the fake, loudly. Anything else is a mistake."""
    from app.tasks.dialer import FakeDialer

    choice = (getattr(settings, "tasks_dialer", "") or "").strip().lower()
    if choice in ("", "fake"):
        return FakeDialer()
    if choice != "plivo":
        raise ConfigurationError("TASKS_DIALER must be empty, 'fake' or 'plivo'")
    placer = getattr(phone, "outbound", None)
    repo = getattr(phone, "outbound_repo", None)
    if placer is None or repo is None:
        logging.getLogger("app.telephony.plivo_tasks").warning("TASKS_DIALER=plivo but outbound calls are not available here (TELEPHONY_OUTBOUND, Plivo Auth ID and Token): the fake dialer stays")
        return FakeDialer()
    from app.telephony.plivo_tasks import PlivoTaskDialer

    return PlivoTaskDialer(placer, repo, max_wait_s=float(max(30, min(int(settings.telephony_max_call_s), 300)) + 50), tone_for=tone_for)


def call_tone_lookup(rest_url: str, anon_key: str, packs_dir: str | None) -> Any:
    """For a Lead Desk call: the tone of calls to customers. The Owner's SAVED tone (the panel "How your assistant speaks"), else the old "How to address customers" mapped, else the business type's default (the database says
    which pack; packages/packs/call_tones.json says the tone): a school workspace is respectful, the rest friendly."""
    from pathlib import Path

    from app.packs.registry import PackRegistry, default_directory
    from app.packs.repository import PostgrestPacksRepository
    from app.talk_training.repository import PostgrestTalkTraining
    from app.telephony import tone as tone_mod

    repo = PostgrestPacksRepository(rest_url, anon_key)
    trainings = PostgrestTalkTraining(rest_url, anon_key)
    registry = PackRegistry(Path(packs_dir) if packs_dir else default_directory())

    def lookup(token: str, tenant_id: uuid.UUID) -> str:
        pack_default = registry.call_tone(str(repo.workspace_pack(token, tenant_id).get("pack_id") or "") or None)
        try:
            row = trainings.get(token, tenant_id)
            doc = row.get("doc") if isinstance(row, dict) and isinstance(row.get("doc"), dict) else None
        except Exception:   # noqa: BLE001 - an unreadable setting is the business type's default
            doc = None
        return tone_mod.effective_tone(doc, pack_default)[0]

    return lookup
