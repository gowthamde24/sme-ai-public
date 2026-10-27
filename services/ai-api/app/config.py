import re
from datetime import date
from functools import lru_cache
from typing import Any

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Supabase Auth signs access tokens with ES256 (JWKS) by default; legacy projects use HS256.
SUPPORTED_JWT_ALGORITHMS = frozenset({"ES256", "RS256", "HS256"})
ASYMMETRIC_JWT_ALGORITHMS = frozenset({"ES256", "RS256"})
MIN_HS256_SECRET_LENGTH = 32

# The Supabase CLI local stack. Used as a default ONLY when API_ENV is exactly "development".
LOCAL_SUPABASE_URL = "http://127.0.0.1:54321"


_ORIGIN = re.compile(r"https?://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?")


class ConfigurationError(RuntimeError):
    """Required configuration is missing or unsafe. Raised at startup outside development."""


class Settings(BaseSettings):
    """Server-side settings. Secrets live here only, never in browser code.

    There is deliberately no service-role key: the API acts only with the caller's own JWT so
    row-level security always applies.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    api_env: str = "development"
    # Browser origins allowed to call the API, comma separated. NONE by default: the web app calls
    # the API from its SERVER, so the browser needs no CORS access at all. Explicit origins only
    # (scheme://host[:port], no path, no "*"); https outside development.
    api_cors_origins: str = ""
    # Job CB (ADR 0082): hardening and operations.
    rate_limit_enabled: bool = True
    # how many proxies in front of the API may write X-Forwarded-For (0: the header is ignored)
    trusted_proxy_hops: int = 0
    # /metrics answers 404 unless this is set, and then only to `Authorization: Bearer <it>`
    metrics_token: SecretStr | None = None
    # job DT (security): when set, the API answers only requests that carry this secret in
    # X-Stack19-Origin (the Cloudflare Worker adds it), except /health and /ready; unset = no
    # lock (docs/runbooks/origin-lock.md)
    origin_lock_secret: SecretStr | None = None
    # Job DP part 6: error reporting. Unset (the default) = nothing is imported or sent.
    # The DSN is a project address with a public key, set per environment; never logged.
    sentry_dsn: SecretStr | None = None
    sentry_environment: str | None = None
    sentry_release: str | None = None
    log_format: str = "text"  # text | json
    # /docs, /redoc and /openapi.json: on in development, off elsewhere unless this is true
    expose_api_docs: bool = False

    # Supabase (T002). The publishable key (formerly "anon") is public by design: it identifies
    # the project to PostgREST and grants nothing without a user JWT. Use SUPABASE_PUBLISHABLE_KEY;
    # the legacy SUPABASE_ANON_KEY is still accepted (the new name wins when both are set).
    supabase_url: str | None = None
    supabase_publishable_key: str | None = None
    supabase_anon_key: str | None = None
    supabase_jwt_issuer: str | None = None
    supabase_jwt_audience: str | None = None
    supabase_jwks_url: str | None = None
    supabase_jwt_algorithms: str | None = None
    # Legacy HS256 shared secret. Only used if HS256 is explicitly listed in the algorithms.
    supabase_jwt_secret: SecretStr | None = None

    # Agents (T006). OFF unless switched on here; the platform and tenant switches live in the
    # database.
    agents_enabled: bool = False
    # "fake" is a scripted model for development only; it is refused outside development.
    llm_provider: str = "fake"
    # The real adapter (provider "anthropic"). No default model: the owner chooses it. The key
    # comes ONLY from the environment. Prices are per million tokens, in millionths of the
    # billing currency, set by the owner from the provider's price list; the spend cap must be
    # set at the provider and confirmed here before the first real call.
    llm_model: str | None = None
    anthropic_api_key: SecretStr | None = None
    # Other providers behind the same port (job AK / K3). Each is enabled ONLY by its own
    # key and by LLM_PROVIDER naming it; the model, the two prices and the spend-cap
    # confirmation are the same settings as for Anthropic. Keys: environment only.
    openai_api_key: SecretStr | None = None
    # LLM_PROVIDER=openai_compat: an OpenAI-compatible server on THIS machine (Ollama:
    # http://localhost:11434/v1). Refused unless the address is localhost / 127.0.0.1; no key, no
    # spend-cap confirmation, and the prices may be 0 (unset = 0). For free testing only.
    llm_base_url: str | None = None
    # Job AN: with LLM_PROVIDER=openai_compat the address may ALSO be one of three hosted
    # free-tier services (api.groq.com, api.cerebras.ai, openrouter.ai; an exact allow-list in
    # app.agents.llm.openai_compat), in development only, and then LLM_API_KEY is required.
    # Environment only; never logged; never sent to any other address.
    llm_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    sarvam_api_key: SecretStr | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    llm_input_micros_per_mtok: int | None = None
    llm_output_micros_per_mtok: int | None = None
    # Night 3 (ADR 0102): the model per AI job. claude (default) = the main model as LLM_PROVIDER
    # configures it; sarvam = Sarvam's chat model, only for the jobs that allow it
    # (app.agents.llm.jobs). A wrong value, or sarvam on a job that refuses it, stops the process.
    ai_job_ask: str = "claude"
    ai_job_research: str = "claude"
    ai_job_outcome_classify: str = "claude"
    ai_job_followup_plan: str = "claude"
    ai_job_call_turn: str = "claude"
    ai_job_whatsapp_reply: str = "claude"
    sarvam_chat_model: str = "sarvam-105b"
    # Rs 15 in, Rs 60 out per million tokens (sarvam.ai/api-pricing)
    sarvam_chat_input_micros_per_mtok: int = 15_000_000
    sarvam_chat_output_micros_per_mtok: int = 60_000_000
    llm_spend_cap_confirmed: bool = False
    # The "light" model (job AK K2b, ADR 0064): a workspace that has used 100 % of its daily or
    # monthly AI allowance is served by this cheaper model until the window resets (the same
    # provider and key, prices set the same way). Unset = no light model: the main model keeps
    # serving (the hard cap at 300 % still applies). Its prices need a row in agent_model_prices
    # too (operator, runbook).
    llm_light_model: str | None = None
    llm_light_input_micros_per_mtok: int | None = None
    llm_light_output_micros_per_mtok: int | None = None
    # Job AT (ADR 0066): the channel adapter of the outbox. Only "fake" exists (a local stand-in
    # that sends nothing to anyone); anything else stops the process at start.
    outbox_adapter: str = "fake"
    # Job DI (ADR 0092): the billing provider. Only "fake" exists (no network);
    # anything else stops the process at start.
    billing_provider: str = "fake"
    # The app's e-mails (reminders; ADR 0092 addendum, job RESEND): "fake" sends nothing,
    # "resend" uses Resend's HTTP API with RESEND_API_KEY (from Secret Manager). Anything else
    # stops the process at start.
    billing_email_sender: str = "fake"
    resend_api_key: SecretStr | None = None
    # The address app e-mails are sent from, and where a reply goes (addresses live in the
    # environment, never in code). Needed when the sender is "resend".
    mail_from: str | None = None
    mail_reply_to: str | None = None
    # Job DQ (DPDP): where a privacy grievance and a waitlist entry are e-mailed (addresses live in
    # the environment, never in code), and the captcha of the two public doors (none | turnstile)
    privacy_email: str | None = None
    hello_email: str | None = None
    captcha_provider: str = "none"
    captcha_secret: SecretStr | None = None
    # Job AW (ADR 0068): the scheduler worker (`make dev-worker-local`). It signs in as ITS OWN
    # account, which the operator registered in the database (no workspace, no key of any kind).
    # The address and the password come from the environment only, are never logged, and are
    # not used by the API. The interval is in seconds.
    scheduler_email: str | None = None
    scheduler_password: SecretStr | None = None
    scheduler_interval_seconds: int = 60
    # Job BZ (ADR 0080): connectors. Every one is OFF unless named, and bound to ONE workspace
    # (INTEGRATIONS_TENANT_ID): the credentials below belong to the installation, not to a business,
    # so no other workspace may use them. Keys come from the environment only (never logged, never
    # returned, never in the database). The webhooks sign in as the registered worker account above.
    integrations_tenant_id: str | None = None
    # Job CK: packs and sign-up providers. PACKS_DIR is where packages/packs lives (unset: the
    # checkout's, then /srv/packages/packs in the image). A sign-up provider is OFFERED only when
    # its public client id is set here (the id and the SECRET are set in Supabase Auth; the API
    # never holds the secret). Environment only; unset = off.
    packs_dir: str | None = None
    auth_google_client_id: str | None = None
    auth_facebook_app_id: str | None = None
    indiamart_provider: str = "off"  # off | fake | real
    indiamart_crm_key: SecretStr | None = None
    payments_provider: str = "off"  # off | fake | razorpay | cashfree
    razorpay_key_id: str | None = None
    razorpay_key_secret: SecretStr | None = None
    razorpay_webhook_secret: SecretStr | None = None
    cashfree_client_id: str | None = None
    cashfree_client_secret: SecretStr | None = None
    cashfree_env: str = "sandbox"  # sandbox | production
    public_base_url: str | None = None  # https address of this API as providers reach it
    # Job DR / A2: lead sources. Off or unset by default (an unset door answers "not available").
    # The website form, the webhook and a public Google Sheet need no key.
    lead_inbound_domain: str | None = None  # domain of leads+TOKEN@domain; unset: no address
    lead_inbound_secret: SecretStr | None = None  # header of the one global inbound address
    lead_dnd_provider: str = "off"  # off | fake (no real Do-Not-Disturb lookup is chosen yet)
    meta_lead_provider: str = "off"  # off | fake | graph (graph only after Meta's app verification)
    meta_app_secret: SecretStr | None = None
    meta_page_token: SecretStr | None = None
    google_sheets_service_account_email: str | None = None  # shown to share a private sheet with
    calls_provider: str = "off"  # off | fake | exotel
    exotel_sid: str | None = None
    exotel_api_key: str | None = None
    exotel_api_token: SecretStr | None = None
    exotel_subdomain: str = "api.in.exotel.com"
    exotel_caller_id: str | None = None  # the ExoPhone shown to the customer
    exotel_agent_number: str | None = None  # the shop's own phone, rung first
    exotel_webhook_token: SecretStr | None = None  # the secret in the webhook addresses
    missed_call_reply_language: str = "en"
    # Job BD (ADR 0071): voice. OFF unless a provider is named: VOICE_STT_PROVIDER and
    # VOICE_TTS_PROVIDER = off | fake | sarvam | bhashini | google | ai4bharat. Each provider
    # needs its own key(s) from the environment only (never logged, never returned, never in
    # code). Sarvam's key is SARVAM_API_KEY (above).
    voice_stt_provider: str = "off"
    voice_tts_provider: str = "off"
    sarvam_stt_model: str = "saaras:v4"
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_speaker: str | None = None
    # Night 3 (ADR 0101): ONE switch for the whole speech stack. "" = as before (each
    # VOICE_*_PROVIDER decides; off unless named), "fake" = the fake provider everywhere
    # (development and tests only), "sarvam" = Sarvam for speech-to-text, text-to-speech and
    # WhatsApp voice notes (needs SARVAM_API_KEY). A VOICE_STT_PROVIDER / VOICE_TTS_PROVIDER /
    # VOICE_NOTE_TTS_PROVIDER named explicitly still wins over it.
    speech_provider: str = ""
    # Night 4 (ADR 0108): who makes the calls of speed to lead. "" = nobody (calls wait; new leads
    # and hand-off reminders still run), "fake" = a table-driven fake that dials nobody (staging
    # and development, chosen explicitly). No real telephony exists yet.
    outreach_dialer: str = ""
    # Job DJ (ADR 0093): the speech of WhatsApp VOICE NOTES (the worker). auto = Sarvam when
    # SARVAM_API_KEY is set, else VOICE_TTS_PROVIDER when it names one, else the fake provider in
    # development and none elsewhere (the text then goes alone); off | fake (development only) |
    # sarvam (needs the key AND ffmpeg). VOICE_NOTE_FFMPEG: the program that codes OGG/Opus.
    voice_note_tts_provider: str = "auto"
    voice_note_ffmpeg: str = "ffmpeg"
    bhashini_api_key: SecretStr | None = None
    bhashini_asr_service_id: str | None = None
    bhashini_tts_service_id: str | None = None
    google_api_key: SecretStr | None = None
    ai4bharat_stt_url: str | None = None
    ai4bharat_tts_url: str | None = None
    ai4bharat_token: SecretStr | None = None
    agents_max_workers: int = 2
    agents_max_queue: int = 8
    # The Research Agent (T007) reads web pages. Until a real fetcher and a real model are approved
    # (M4), it runs ONLY in development, with the scripted model, on the synthetic fixture sites in
    # this directory (a path; no network). Unset = the research agent cannot start.
    research_fixture_dir: str | None = None
    # Suppression keys (T010, ADR 0020). The key of the HMAC that recognises an erased or opted-out
    # contact when it arrives again. A secret: ONLY from the environment, no default,
    # never logged or returned. Outside development the process refuses to start without it. A
    # rotation sets the new key and keeps the old one as PREVIOUS (matching only).
    suppression_hmac_key: SecretStr | None = None
    suppression_hmac_key_version: int = 1
    suppression_hmac_key_previous: SecretStr | None = None
    suppression_hmac_key_previous_version: int | None = None
    # Job BI (ADR 0073): the versions of the terms and the privacy notice that a person accepts.
    # A new version is a new value here (and the new text on the web); the API refuses to record
    # an acceptance of any other.
    terms_version: str = "2026-10-01"
    privacy_version: str = "2026-10-01"
    # Job BN (ADR 0075): the date a new version binds (empty = at once), and whether a person who
    # has not accepted the binding version is stopped at the workspace routes (403
    # policy_acceptance_required). Off by default: switch it on when the first real version change
    # is published.
    terms_effective_from: date | None = None
    privacy_effective_from: date | None = None
    policy_enforce: bool = False

    @field_validator("terms_effective_from", "privacy_effective_from", mode="before")
    @classmethod
    def _empty_date_is_none(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value

    # Job BR (ADR 0076): WhatsApp (Meta's Cloud API). All of it is off until the owner sets
    # these: OUTBOX_ADAPTER=whatsapp turns real sending on; the webhook answers only with the app
    # secret and the verify token set. Secrets come ONLY from the environment (or the host's
    # secret manager); none is stored in the database, logged or returned.
    whatsapp_api_base: str = "https://graph.facebook.com"
    whatsapp_graph_version: str = "v25.0"
    whatsapp_app_secret: SecretStr | None = None
    whatsapp_verify_token: SecretStr | None = None
    # the access token used for every business unless WHATSAPP_ACCESS_TOKENS names its own
    whatsapp_access_token: SecretStr | None = None
    # a JSON object {"token_ref": "token", ...}; a business's token_ref names its entry
    whatsapp_access_tokens: SecretStr | None = None
    # the account the API signs in as to hand a webhook to the database (registered by the
    # operator; belongs to no workspace)
    channel_agent_email: str | None = None
    channel_agent_password: SecretStr | None = None

    # Job BY (ADR 0077): web-push to the team's browsers. Off until BOTH are set. The private
    # key is a secret: only from the environment, entered hidden, never logged or returned.
    vapid_private_key: SecretStr | None = None
    vapid_subject: str | None = None
    vapid_public_key: str | None = None

    # Job BP (ADR 0078): web research tools for the Main agent and, opt-in, the Research agent.
    # EVERYTHING is off until the owner sets these; keys come only from the environment (entered
    # hidden), are never logged, returned or stored. A provider named without its key stops the
    # process at start.
    web_search_provider: str = "off"  # off | fake | tavily | brave
    tavily_api_key: SecretStr | None = None
    brave_search_api_key: SecretStr | None = None
    places_provider: str = "off"  # off | fake | google
    google_places_api_key: SecretStr | None = None
    places_field_tier: str = "pro"  # pro (name, address, link) | ids (place ids only: free)
    metals_provider: str = "off"  # off | fake | metals_dev
    metals_dev_api_key: SecretStr | None = None
    # reading a page: off | fake (fixture pages, no network) | real (the guarded fetcher:
    # robots.txt, no private addresses, size and time limits)
    web_fetch: str = "off"

    @property
    def cors_origins(self) -> list[str]:
        """The validated list. A wildcard, a path, a trailing slash or (outside development) a
        non-https origin stops the process."""
        origins = [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]
        for origin in origins:
            if not _ORIGIN.fullmatch(origin):
                raise ConfigurationError(
                    "API_CORS_ORIGINS holds an entry that is not an origin "
                    "(scheme://host[:port], no wildcard, no path)"
                )
            if not self.is_development and not origin.startswith("https://"):
                raise ConfigurationError("API_CORS_ORIGINS must be https outside development")
        return origins

    @property
    def is_development(self) -> bool:
        # Exact match: "prod", "production", "staging", "" and typos are all NOT development.
        return self.api_env == "development"


class AuthConfig:
    """Fully resolved, validated auth settings. Immutable once built."""

    def __init__(
        self,
        *,
        supabase_url: str,
        anon_key: str,
        issuer: str,
        audience: str,
        jwks_url: str | None,
        algorithms: tuple[str, ...],
        hs256_secret: str | None,
    ) -> None:
        self.supabase_url = supabase_url
        self.anon_key = anon_key
        self.issuer = issuer
        self.audience = audience
        self.jwks_url = jwks_url
        self.algorithms = algorithms
        self.hs256_secret = hs256_secret

    @property
    def rest_url(self) -> str:
        return f"{self.supabase_url}/rest/v1"


def _csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


def build_auth_config(settings: Settings) -> AuthConfig:
    """Resolve auth settings, or raise ConfigurationError.

    Development fills gaps from the local Supabase stack. Everything else must be explicit:
    missing issuer, audience, key material, or anon key means the process refuses to start.
    """
    dev = settings.is_development
    problems: list[str] = []

    url = (settings.supabase_url or (LOCAL_SUPABASE_URL if dev else "")).rstrip("/")
    if not url:
        problems.append("SUPABASE_URL is required")
    anon_key = settings.supabase_publishable_key or settings.supabase_anon_key or ""
    if not anon_key:
        problems.append("SUPABASE_PUBLISHABLE_KEY (or the legacy SUPABASE_ANON_KEY) is required")

    issuer = settings.supabase_jwt_issuer or (f"{url}/auth/v1" if dev and url else "")
    if not issuer:
        problems.append("SUPABASE_JWT_ISSUER is required")
    audience = settings.supabase_jwt_audience or ("authenticated" if dev else "")
    if not audience:
        problems.append("SUPABASE_JWT_AUDIENCE is required")

    algorithms = _csv(settings.supabase_jwt_algorithms or ("ES256" if dev else ""))
    if not algorithms:
        problems.append("SUPABASE_JWT_ALGORITHMS is required (e.g. ES256)")
    unsupported = [a for a in algorithms if a not in SUPPORTED_JWT_ALGORITHMS]
    if unsupported:
        problems.append(f"unsupported JWT algorithm(s): {', '.join(unsupported)}")

    jwks_url = settings.supabase_jwks_url or (
        f"{issuer}/.well-known/jwks.json" if dev and issuer else None
    )
    if any(a in ASYMMETRIC_JWT_ALGORITHMS for a in algorithms) and not jwks_url:
        problems.append("SUPABASE_JWKS_URL is required for asymmetric algorithms")

    secret = (
        settings.supabase_jwt_secret.get_secret_value() if settings.supabase_jwt_secret else None
    )
    if "HS256" in algorithms:
        if not secret:
            problems.append("SUPABASE_JWT_SECRET is required when HS256 is enabled")
        elif len(secret) < MIN_HS256_SECRET_LENGTH:
            problems.append("SUPABASE_JWT_SECRET is too short")

    if not dev:
        for name, value in (
            ("SUPABASE_URL", url),
            ("SUPABASE_JWT_ISSUER", issuer),
            ("SUPABASE_JWKS_URL", jwks_url or ""),
        ):
            if value and not value.startswith("https://"):
                problems.append(f"{name} must use https outside development")

    if problems:
        raise ConfigurationError("invalid auth configuration: " + "; ".join(problems))

    return AuthConfig(
        supabase_url=url,
        anon_key=anon_key,
        issuer=issuer,
        audience=audience,
        jwks_url=jwks_url,
        algorithms=algorithms,
        hs256_secret=secret if "HS256" in algorithms else None,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
