"""Builds WorkspaceSecrets from settings (app/workspace_secrets.py). A mode that is named without what it needs stops the API at start."""

# ruff: noqa: E501

from __future__ import annotations

from app.config import ConfigurationError, Settings
from app.workspace_secrets import FakeSecretStore, GcpSecretStore, SecretStore, WorkspaceSecrets


def build_workspace_secrets(settings: Settings, rest_url: str, anon_key: str) -> WorkspaceSecrets | None:
    mode = (settings.workspace_secrets or "off").strip().lower()
    if mode == "off":
        return None
    key = settings.suppression_hmac_key.get_secret_value().encode("utf-8") if settings.suppression_hmac_key else b""
    store: SecretStore
    if mode == "fake":
        store = FakeSecretStore()
        key = key or b"local-fingerprint-key"
    elif mode == "gcp":
        if not key:
            raise ConfigurationError("WORKSPACE_SECRETS=gcp needs SUPPRESSION_HMAC_KEY (the fingerprint's key)")
        try:
            store = GcpSecretStore(settings.workspace_secrets_project or "")
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from None
    else:
        raise ConfigurationError("WORKSPACE_SECRETS must be off, fake or gcp")
    return WorkspaceSecrets(rest_url, anon_key, store, key)
