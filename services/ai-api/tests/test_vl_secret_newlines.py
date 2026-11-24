# ruff: noqa: E501
"""A stray new line in the VoiceLink bot token made every call bad_token (28 Nov 2026: a secret created by `openssl | gcloud` kept the line ending). Three layers now: a generated secret is stored without one, the API strips
edge whitespace from the token and a line ending from the login, and the address script prints neither."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings
from tests.test_prod_setup_scripts import fake_gcloud, run


def test_the_api_strips_whitespace_from_the_bot_token_and_a_line_ending_from_the_login() -> None:
    s = Settings(_env_file=None, voicelink_ws_token="  abc123token\r\n", voicelink_username="Ada Test Lovelace-Example\n", voicelink_password="  pa ss word  \r\n")  # type: ignore[call-arg,arg-type]
    assert s.voicelink_ws_token is not None and s.voicelink_ws_token.get_secret_value() == "abc123token"
    assert s.voicelink_username is not None and s.voicelink_username.get_secret_value() == "Ada Test Lovelace-Example", "inner spaces kept, only the line ending goes"
    assert s.voicelink_password is not None and s.voicelink_password.get_secret_value() == "  pa ss word  ", "edge spaces of a password are its own"


def test_a_generated_secret_is_stored_without_a_line_ending(tmp_path: Path) -> None:
    env, log = fake_gcloud(tmp_path, existing="iam service-accounts describe")
    bin_dir, saved = tmp_path / "bin", tmp_path / "saved"
    saved.mkdir()
    (bin_dir / "gcloud").write_text(
        "#!/bin/sh\n"
        f'echo "$*" >> "{log}"\n'
        'case "$*" in\n'
        f'  *"secrets create"*) cat > "{saved}/$3"; exit 0;;\n'
        '  "projects describe"*) echo 488341211094; exit 0;;\n'
        '  "billing projects describe"*) echo True; exit 0;;\n'
        '  *"iam service-accounts describe"*) exit 0;;\n'
        "esac\n"
        'case "$*" in *describe*) exit 1;; esac\nexit 0\n'
    )
    r = run("prod-secrets-prompt.sh", env, stdin="T1\nT2\nT3\nT4\nT5\n+919000000001\n\n\n\n\n\n\nn\n\n")
    assert r.returncode == 0, r.stderr
    for name in ("sme-voicelink-ws-token", "sme-suppression-hmac-key", "sme-exotel-stream-secret"):
        value = (saved / name).read_text()
        assert len(value) == 64 and value.isalnum(), f"{name}: 64 hex characters and nothing else"
