"""Inbound calls on the Exotel sandbox, as the deployment configures them (job phone-calls part 5). Kept apart from app/main.py, like the other wirings."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import logging
import uuid
from contextlib import suppress
from typing import Any

from app.billing.call_charge import CallCharger
from app.config import ConfigurationError, Settings
from app.ops.usage import TIMEOUT_S as USAGE_TIMEOUT_S
from app.ops.usage import PostgrestUsageRecorder
from app.rpc_base import RpcClient
from app.scheduler.session import PrincipalSession
from app.telephony.inbound import ExotelCalls, trial_rule
from app.telephony.inbound_routes import InboundService
from app.telephony.inbound_store import InboundStore
from app.telephony.line_limits import WorkspaceLines
from app.telephony.opening_store import OpeningStore
from app.telephony.plivo_api import PlivoApi
from app.telephony.plivo_outbound import PlivoOutbound, PostgrestOutboundRepo
from app.telephony.plivo_routes import PlivoConfig, SubaccountTokens
from app.telephony.settings import gate_settings, phone_llm_choice
from app.telephony.voicelink_api import VoicelinkApi, VoicelinkCaller
from app.telephony.voicelink_routes import VoicelinkConfig
from app.voice.budget import RpcVoiceBudget
from app.workspace_secrets import GcpSecretStore


def build_phone_inbound(settings: Settings, rest_url: str, supabase_url: str, anon_key: str, live: Any = None) -> InboundService | None:
    """Inbound calls on the Exotel sandbox (job phone-calls part 5). None unless TELEPHONY_MODE is
    sandbox or live AND the stream secret, the public address and the scheduler account are set.
    Exotel's own key (to confirm each call) is optional here: without it every call is refused."""

    gs = gate_settings(settings)
    secret = settings.exotel_stream_secret.get_secret_value() if settings.exotel_stream_secret else ""
    password = settings.scheduler_password.get_secret_value() if settings.scheduler_password else ""
    base = (settings.public_base_url or "").strip()
    plivo_token = settings.plivo_auth_token.get_secret_value() if settings.plivo_auth_token else ""
    vl_token = settings.voicelink_ws_token.get_secret_value() if settings.voicelink_ws_token else ""   # VoiceLink's bot address token: the route is off without it
    # a deployment can answer Exotel (needs its stream secret), Plivo (needs its Auth Token), or both
    missing = [n for n, v in (("EXOTEL_STREAM_SECRET or PLIVO_AUTH_TOKEN or VOICELINK_WS_TOKEN", len(secret) >= 32 or len(plivo_token) >= 16 or len(vl_token) >= 32), ("PUBLIC_BASE_URL", base), ("SCHEDULER_EMAIL", settings.scheduler_email), ("SCHEDULER_PASSWORD", password)) if not v]
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
    # EXTRA_LINES: each workspace has its own number of calls at once (its lines); the deployment's TELEPHONY_MAX_CONCURRENT stays the hard cap above them
    limits = WorkspaceLines(RpcClient(rest_url, anon_key), principal.token) if getattr(settings, "extra_lines", False) and live is not None else None
    per_workspace: dict[str, Any] = {"lines": limits, "active_for_tenant": live.count_for_tenant} if limits is not None else {}
    vl_login = bool(settings.voicelink_username and settings.voicelink_username.get_secret_value() and settings.voicelink_password and settings.voicelink_password.get_secret_value())
    choice = (settings.telephony_provider or "").strip().lower()
    use_voicelink = choice == "voicelink" or (choice == "" and vl_login and not (settings.plivo_auth_id and len(plivo_token) >= 16))   # VoiceLink is the provider whose login is given (owner, 24 Nov 2026), unless TELEPHONY_PROVIDER says otherwise
    outbound_repo = PostgrestOutboundRepo(RpcClient(rest_url, anon_key), provider="voicelink" if use_voicelink else "plivo", wallet_enforced=bool(getattr(settings, "billing_charge_calls", False)), kyc_enforced=bool(getattr(settings, "kyc_per_client", False)))
    tokens = None   # the Auth Token of a subaccount's line: read from Secret Manager by the line's account_ref (WORKSPACE_SECRETS=gcp); without it only the main account's lines are believed
    if (settings.workspace_secrets or "off").strip().lower() == "gcp" and settings.workspace_secrets_project:
        with suppress(ValueError):
            tokens = SubaccountTokens(GcpSecretStore(settings.workspace_secrets_project))
    placer = None
    if use_voicelink:
        if gs.outbound and vl_login and len(vl_token) >= 32:   # outbound calls: TELEPHONY_OUTBOUND=true AND the VoiceLink login and the bot's address token (the gate still decides every call)
            api = VoicelinkApi(settings.voicelink_username.get_secret_value() if settings.voicelink_username else "", settings.voicelink_password.get_secret_value() if settings.voicelink_password else "", base_url=settings.voicelink_api_base)
            placer = PlivoOutbound(api=VoicelinkCaller(api, public_base=base, ws_token=lambda: vl_token), repo=outbound_repo, gate_settings=gs, public_base=base, max_call_s=max(30, min(int(settings.telephony_max_call_s), 300)),
                                   id_key=hashlib.sha256(("test-number|" + vl_token).encode()).digest(), provider="voicelink", **per_workspace)
    elif gs.outbound and len(plivo_token) >= 16 and settings.plivo_auth_id:   # outbound calls: TELEPHONY_OUTBOUND=true AND the Plivo Auth ID and Auth Token (the gate still decides every call)
        def api_for(line: dict[str, Any]) -> PlivoApi | None:
            sub_id, sub_token = line.get("external_ref"), tokens(line) if tokens is not None else None
            return PlivoApi(str(sub_id), sub_token) if sub_id and sub_token else None

        placer = PlivoOutbound(api=PlivoApi(settings.plivo_auth_id, plivo_token), repo=outbound_repo, gate_settings=gs, public_base=base, max_call_s=max(30, min(int(settings.telephony_max_call_s), 300)), api_for=api_for,
                              id_key=hashlib.sha256(("test-number|" + plivo_token).encode()).digest(), **per_workspace)
    return InboundService(
        secret=secret.encode("utf-8") if len(secret) >= 32 else b"", public_base=base, gate_settings=gs, store=InboundStore(RpcClient(rest_url, anon_key), principal, wallet_enforced=bool(getattr(settings, "billing_charge_calls", False)), kyc_enforced=bool(getattr(settings, "kyc_per_client", False)), workspace_lines=limits), calls=calls,
        charge=CallCharger(RpcClient(rest_url, anon_key), principal.token) if getattr(settings, "billing_charge_calls", False) else None,
        cost_paise_per_minute=settings.telephony_cost_paise_per_minute, cost_pulse_s=settings.telephony_cost_pulse_s, cost_paise_per_minute_inbound=settings.telephony_cost_paise_per_minute_inbound, language=settings.telephony_inbound_language if settings.telephony_inbound_language in ("en", "te", "hi", "kn", "ta", "ml", "mr") else "en",
        llm_choice=phone_llm_choice(settings)[0], first_token_s=phone_llm_choice(settings)[1], business=settings.telephony_inbound_business, recording_notice=settings.voicelink_recording_expected, monitor_allowed=settings.takeover_allowed,
        max_call_s=max(30, min(int(settings.telephony_max_call_s), 300)),
        english_lines=True, call_summaries=True, employees_on=bool(getattr(settings, "employees", False)),
        url_format="text" if settings.exotel_stream_url_format == "text" else "json",
        our_sid=settings.exotel_sid or None,
        budget=RpcVoiceBudget(RpcClient(rest_url, anon_key), principal.token),
        opening_store=OpeningStore(f"{supabase_url}/storage/v1", anon_key, principal.token),
        plivo=PlivoConfig(auth_token=plivo_token, public_base=base, token_for=tokens) if len(plivo_token) >= 16 else None,
        voicelink=VoicelinkConfig(ws_token=vl_token, public_base=base) if len(vl_token) >= 32 else None,
        usage=PostgrestUsageRecorder(RpcClient(rest_url, anon_key, timeout=USAGE_TIMEOUT_S), principal),   # the provider usage ledger, as the same scheduler account
        outbound=placer, outbound_repo=outbound_repo,
        trial=trial_rule(settings.exotel_trial_number, settings.exotel_trial_caller, settings.exotel_sid, settings.exotel_trial_app_id,
                         max_calls_per_day=settings.exotel_trial_calls_per_day, max_call_s=settings.exotel_trial_max_call_s) if gs.mode == "sandbox" else None,
    )


def build_tasks_dialer(settings: Any, phone: Any, tone_for: Any = None, say_ai_for: Any = None, employee_for: Any = None) -> Any:
    """The dialer of approved Lead Desk tasks. `plivo` only when the phone service can place outbound calls (TELEPHONY_OUTBOUND, Plivo Auth ID and Token); otherwise the fake, loudly. Anything else is a mistake."""
    from app.tasks.dialer import FakeDialer

    choice = (getattr(settings, "tasks_dialer", "") or "").strip().lower()
    if choice in ("", "fake"):
        return FakeDialer()
    if choice not in ("plivo", "voicelink"):   # both name the same dialer: the phone service's placer (whichever provider it was built for)
        raise ConfigurationError("TASKS_DIALER must be empty, 'fake', 'plivo' or 'voicelink'")
    placer = getattr(phone, "outbound", None)
    repo = getattr(phone, "outbound_repo", None)
    if placer is None or repo is None:
        logging.getLogger("app.telephony.plivo_tasks").warning("TASKS_DIALER=plivo but outbound calls are not available here (TELEPHONY_OUTBOUND, Plivo Auth ID and Token): the fake dialer stays")
        return FakeDialer()
    from app.telephony.plivo_tasks import PlivoTaskDialer

    return PlivoTaskDialer(placer, repo, max_wait_s=float(max(30, min(int(settings.telephony_max_call_s), 300)) + 50), tone_for=tone_for, say_ai_for=say_ai_for, employee_for=employee_for)


class NamedCallDialer:
    """The dialer of ONE person the Owner named themselves (owner, 14 Nov 2026: "Yashwanth Reddy ki call cheyyi" -> yes -> a REAL Plivo call on staging, the same pipeline as "Place a test call").
    A phone on the deployment's sandbox list is rung for real by the Lead Desk's Plivo dialer (the gate still decides: calling hours, the AI opening, one call at a time); any other number keeps the
    deployment's own dialer (the simulated one while TASKS_DIALER is empty), so nothing else changes and no number outside the list is ever rung."""

    name = "plivo-named"

    def __init__(self, real: Any, fallback: Any, on_list: Any) -> None:
        self._real, self._fallback, self._on_list = real, fallback, on_list

    def call(self, **kwargs: Any) -> Any:
        phone = str(kwargs.get("phone") or "")
        return (self._real if phone and self._on_list(phone) else self._fallback).call(**kwargs)


def build_named_dialer(settings: Any, phone: Any, fallback: Any, tone_for: Any = None, say_ai_for: Any = None, employee_for: Any = None) -> Any:
    """The dialer for a plan whose one person the Owner named; None when this deployment cannot place outbound calls (then the plan runs on the ordinary dialer)."""
    placer = getattr(phone, "outbound", None)
    repo = getattr(phone, "outbound_repo", None)
    if placer is None or repo is None or not hasattr(placer, "on_sandbox"):
        return None
    from app.telephony.plivo_tasks import PlivoTaskDialer

    real = PlivoTaskDialer(placer, repo, max_wait_s=float(max(30, min(int(settings.telephony_max_call_s), 300)) + 50), tone_for=tone_for, say_ai_for=say_ai_for, employee_for=employee_for)
    return NamedCallDialer(real, fallback, placer.on_sandbox)


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


def call_greeting_lookup(rest_url: str, anon_key: str) -> Any:
    """For a Lead Desk call: does the greeting say "AI assistant"? The workspace's saved setting `say_ai_when_greeting` (default OFF: the name only) with the override of the JOB the call belongs to (`say_ai_by_job`), read as the member, else as the phone server's own account. An unreadable setting is OFF."""
    from app.opening import greeting
    from app.talk_training.repository import PostgrestTalkTraining

    trainings = PostgrestTalkTraining(rest_url, anon_key)

    def lookup(token: str, tenant_id: uuid.UUID, job: str | None = None) -> bool:
        try:
            row = trainings.get(token, tenant_id)
            doc = row.get("doc") if isinstance(row, dict) and isinstance(row.get("doc"), dict) else None
        except Exception:   # noqa: BLE001 - not a member: the call door of the phone server's account
            try:
                doc = trainings.for_call(token, tenant_id)
            except Exception:   # noqa: BLE001 - an unreadable setting is the default
                doc = None
        return greeting.resolved_for_job(doc, job)

    return lookup
