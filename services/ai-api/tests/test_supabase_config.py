"""supabase/config.toml: the private `app` schema must never be exposed through PostgREST.

Fast, Docker-free guard. The integration suite checks the same thing against the running stack.
"""

import tomllib
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[3] / "supabase" / "config.toml"


def test_app_schema_is_not_exposed_through_the_api() -> None:
    api = tomllib.loads(CONFIG.read_text())["api"]
    assert "app" not in api["schemas"]
    assert "app" not in api.get("extra_search_path", [])


def test_only_public_is_exposed() -> None:
    assert tomllib.loads(CONFIG.read_text())["api"]["schemas"] == ["public"]


def test_social_sign_up_is_off_in_the_committed_file_and_never_holds_a_literal_secret() -> None:
    """Job CK: Google and Facebook are env-configured and OFF when their keys are missing."""
    external = tomllib.loads(CONFIG.read_text())["auth"]["external"]
    prefix = "SUPABASE_AUTH_EXTERNAL_"
    for provider, id_var, secret_var in (
        ("google", prefix + "GOOGLE_CLIENT_ID", prefix + "GOOGLE_SECRET"),
        ("facebook", prefix + "FACEBOOK_APP_ID", prefix + "FACEBOOK_SECRET"),
    ):
        block = external[provider]
        assert block["enabled"] is False
        assert block["client_id"] == f"env({id_var})" and block["secret"] == f"env({secret_var})"


def test_accounts_are_never_linked_by_hand_and_e_mail_must_be_confirmed() -> None:
    auth = tomllib.loads(CONFIG.read_text())["auth"]
    assert auth["enable_manual_linking"] is False and auth["email"]["enable_confirmations"] is True
