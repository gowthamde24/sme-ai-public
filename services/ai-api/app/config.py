import re
from functools import lru_cache

from pydantic import SecretStr
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
    gemini_api_key: SecretStr | None = None
    sarvam_api_key: SecretStr | None = None
    anthropic_base_url: str = "https://api.anthropic.com"
    llm_input_micros_per_mtok: int | None = None
    llm_output_micros_per_mtok: int | None = None
    llm_spend_cap_confirmed: bool = False
    # The "light" model (job AK K2b, ADR 0064): a workspace that has used 100 % of its daily or
    # monthly AI allowance is served by this cheaper model until the window resets (the same
    # provider and key, prices set the same way). Unset = no light model: the main model keeps
    # serving (the hard cap at 300 % still applies). Its prices need a row in agent_model_prices
    # too (operator, runbook).
    llm_light_model: str | None = None
    llm_light_input_micros_per_mtok: int | None = None
    llm_light_output_micros_per_mtok: int | None = None
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
