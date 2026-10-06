"""Outside development the service must refuse to start on missing/unsafe auth configuration."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import ConfigurationError, Settings, build_auth_config
from app.main import create_app

ENV_NAMES = [
    "API_ENV",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_JWT_ISSUER",
    "SUPABASE_JWT_AUDIENCE",
    "SUPABASE_JWKS_URL",
    "SUPABASE_JWT_ALGORITHMS",
    "SUPABASE_JWT_SECRET",
    "SUPPRESSION_HMAC_KEY",
    "SUPPRESSION_HMAC_KEY_VERSION",
    "SUPPRESSION_HMAC_KEY_PREVIOUS",
    "SUPPRESSION_HMAC_KEY_PREVIOUS_VERSION",
]

VALID_PROD: dict[str, Any] = {
    "api_env": "production",
    "supabase_url": "https://project.supabase.example",
    "supabase_anon_key": "public-anon-key",
    "supabase_jwt_issuer": "https://project.supabase.example/auth/v1",
    "supabase_jwt_audience": "authenticated",
    "supabase_jwks_url": "https://project.supabase.example/auth/v1/.well-known/jwks.json",
    "supabase_jwt_algorithms": "ES256",
    # T010 (ADR 0020): required outside development; a synthetic test value, not a secret
    "suppression_hmac_key": "synthetic-test-key-0123456789",
}


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **{**VALID_PROD, **overrides})  # type: ignore[call-arg]


def test_valid_production_config_starts() -> None:
    app = create_app(settings())
    assert app.state.runtime is not None
    assert (
        app.state.runtime.key_ring is not None and app.state.runtime.key_ring.current.version == 1
    )


def test_production_refuses_to_start_without_the_suppression_key() -> None:
    for missing in (None, ""):
        with pytest.raises(ConfigurationError, match="SUPPRESSION_HMAC_KEY"):
            create_app(settings(suppression_hmac_key=missing))


@pytest.mark.parametrize(
    "overrides",
    [
        {"suppression_hmac_key": "short"},  # a typo, not a key
        {"suppression_hmac_key_version": 0},
        {"suppression_hmac_key_version": 33},
        # a previous key needs its own version, which must differ, and the key must differ
        {"suppression_hmac_key_previous": "previous-key-0123456789"},
        {
            "suppression_hmac_key_previous": "previous-key-0123456789",
            "suppression_hmac_key_previous_version": 1,
        },
        {
            "suppression_hmac_key_previous": "synthetic-test-key-0123456789",
            "suppression_hmac_key_previous_version": 2,
        },
        {"suppression_hmac_key_previous": "short", "suppression_hmac_key_previous_version": 2},
    ],
)
def test_an_unacceptable_suppression_key_stops_the_process(overrides: dict[str, Any]) -> None:
    with pytest.raises(ConfigurationError):
        create_app(settings(**overrides))


def test_a_previous_suppression_key_is_accepted_for_a_rotation() -> None:
    app = create_app(
        settings(
            suppression_hmac_key_version=2,
            suppression_hmac_key_previous="previous-key-0123456789",
            suppression_hmac_key_previous_version=1,
        )
    )
    ring = app.state.runtime.key_ring
    assert ring.current.version == 2 and ring.previous is not None and ring.previous.version == 1


def test_development_without_a_suppression_key_starts_unkeyed() -> None:
    app = create_app(settings(api_env="development", suppression_hmac_key=None))
    assert app.state.runtime is not None and app.state.runtime.key_ring is None


def test_no_key_value_is_ever_shown_by_the_settings_or_the_ring() -> None:
    s = settings()
    app = create_app(s)
    for shown in (
        repr(s),
        str(s),
        repr(app.state.runtime.key_ring),
        str(app.state.runtime.key_ring),
    ):
        assert "synthetic-test-key-0123456789" not in shown


def test_the_publishable_name_and_the_legacy_anon_name_are_both_accepted() -> None:
    legacy = settings()  # VALID_PROD sets only the legacy name
    assert build_auth_config(legacy).anon_key == "public-anon-key"
    new = settings(supabase_anon_key=None, supabase_publishable_key="public-publishable-key")
    assert build_auth_config(new).anon_key == "public-publishable-key"
    assert create_app(new).state.runtime is not None


def test_the_publishable_name_wins_when_both_are_set() -> None:
    both = settings(supabase_publishable_key="new-name-key")
    assert build_auth_config(both).anon_key == "new-name-key"


def test_both_names_are_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_ANON_KEY", "from-legacy-env")
    assert Settings(_env_file=None).supabase_anon_key == "from-legacy-env"  # type: ignore[call-arg]
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "from-new-env")
    assert Settings(_env_file=None).supabase_publishable_key == "from-new-env"  # type: ignore[call-arg]


def test_no_key_under_either_name_refuses_to_start_and_names_both() -> None:
    with pytest.raises(ConfigurationError) as caught:
        create_app(settings(supabase_anon_key=None, supabase_publishable_key=None))
    assert "SUPABASE_PUBLISHABLE_KEY" in str(caught.value) and "SUPABASE_ANON_KEY" in str(
        caught.value
    )


@pytest.mark.parametrize(
    "missing",
    [
        "supabase_url",
        "supabase_anon_key",
        "supabase_jwt_issuer",
        "supabase_jwt_audience",
        "supabase_jwks_url",
        "supabase_jwt_algorithms",
    ],
)
def test_production_refuses_to_start_when_any_setting_is_missing(missing: str) -> None:
    with pytest.raises(ConfigurationError, match=missing.upper()):
        create_app(settings(**{missing: None}))


@pytest.mark.parametrize("env", ["production", "prod", "staging", "", "Development", "dev", "test"])
def test_only_exact_development_is_relaxed(env: str) -> None:
    empty = Settings(_env_file=None, api_env=env)  # type: ignore[call-arg]
    assert not empty.is_development
    with pytest.raises(ConfigurationError):
        create_app(empty)


def test_production_requires_https() -> None:
    for field in ("supabase_url", "supabase_jwt_issuer", "supabase_jwks_url"):
        insecure = VALID_PROD[field].replace("https://", "http://")
        with pytest.raises(ConfigurationError, match="https"):
            create_app(settings(**{field: insecure}))


def test_hs256_requires_a_long_enough_secret() -> None:
    with pytest.raises(ConfigurationError, match="SUPABASE_JWT_SECRET"):
        create_app(settings(supabase_jwt_algorithms="HS256"))
    with pytest.raises(ConfigurationError, match="too short"):
        create_app(settings(supabase_jwt_algorithms="HS256", supabase_jwt_secret="short"))
    app = create_app(
        settings(
            supabase_jwt_algorithms="HS256", supabase_jwt_secret="x" * 40, supabase_jwks_url=None
        )
    )
    assert app.state.runtime is not None


@pytest.mark.parametrize("algorithm", ["none", "NONE", "HS512", "RS512", "ES256,none"])
def test_unsupported_algorithms_are_refused(algorithm: str) -> None:
    with pytest.raises(ConfigurationError, match="unsupported"):
        create_app(settings(supabase_jwt_algorithms=algorithm))


def test_hs256_secret_is_ignored_unless_hs256_is_enabled() -> None:
    config = build_auth_config(settings(supabase_jwt_secret="y" * 40))
    assert config.hs256_secret is None


def test_development_fills_gaps_from_the_local_stack() -> None:
    config = build_auth_config(
        Settings(_env_file=None, api_env="development", supabase_anon_key="anon")  # type: ignore[call-arg]
    )
    assert config.supabase_url == "http://127.0.0.1:54321"
    assert config.issuer == "http://127.0.0.1:54321/auth/v1"
    assert config.audience == "authenticated"
    assert config.algorithms == ("ES256",)


def test_development_without_config_boots_but_every_tenant_endpoint_is_503() -> None:
    """Dev convenience must never become 'allow': no config means no data, not open access."""
    app = create_app(Settings(_env_file=None, api_env="development"))  # type: ignore[call-arg]
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    for headers in ({}, {"Authorization": "Bearer anything"}):
        for path in ("/v1/me", "/v1/tenants/00000000-0000-0000-0000-000000000000"):
            response = client.get(path, headers=headers)
            assert response.status_code == 503
            assert response.json()["error"]["code"] == "auth_not_configured"
    assert client.post("/v1/tenants", json={"name": "x", "slug": "xyz"}).status_code == 503
