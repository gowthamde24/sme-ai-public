"""A workspace's own keys (owner decision, 5 Nov 2026): Google Secret Manager, ONE secret per workspace and kind, `sme-ws-<workspace id>-<kind>` (migration 20261231120000).

The key goes from the assistant's secure card straight to POST /assistant/secrets/{request_id}: never through a chat turn, a model, a log, an audit row or an error. The database keeps only WHERE it is
(the secret's name), the last four characters and a fingerprint. Secret Manager is reached over its REST API with the Cloud Run instance's own identity (the metadata server's token): no new library,
no key file. The API's service account may create secrets and write and read only `sme-ws-*` ones (conditional IAM bindings, owner steps).

  WORKSPACE_SECRETS=off (default)   the card says "not yet"; a pull uses the installation's own key as before
  WORKSPACE_SECRETS=fake            in memory (local development and the tests)
  WORKSPACE_SECRETS=gcp             Secret Manager in WORKSPACE_SECRETS_PROJECT (staging: the project of deploy/staging.sh)
"""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import time
import uuid
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient

logger = logging.getLogger("app.workspace_secrets")

KINDS = ("indiamart_key",)
_VALUE = re.compile(r"[A-Za-z0-9._~+/=:-]{8,200}")
_METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"  # noqa: S105 - an address, not a password
_API = "https://secretmanager.googleapis.com/v1"
REGION = "asia-south1"   # the key stays in India, like the database


class SecretStoreError(Exception):
    """Secret Manager refused or could not be reached. The message is a closed word, never the key or the provider's text."""


class SecretStore(Protocol):
    def put(self, name: str, value: str) -> None: ...
    def access(self, name: str) -> str | None: ...


def clean_value(raw: object) -> str | None:
    """The key as pasted: surrounding spaces dropped; 8 to 200 characters of letters, digits and . _ ~ + / = : - . Anything else is refused (and never echoed)."""
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    return value if _VALUE.fullmatch(value) else None


def last4(value: str) -> str:
    tail = re.sub(r"[^A-Za-z0-9]", "", value)[-4:]
    return tail if len(value) >= 12 else ""   # a short key shows nothing: four of eight characters would be half of it


class FakeSecretStore:
    def __init__(self) -> None:
        self.secrets: dict[str, list[str]] = {}

    def put(self, name: str, value: str) -> None:
        self.secrets.setdefault(name, []).append(value)

    def access(self, name: str) -> str | None:
        versions = self.secrets.get(name)
        return versions[-1] if versions else None


class GcpSecretStore:
    """Secret Manager over REST. Creates the secret on first use (one replica, in India), adds a version, and destroys the versions before it, so only the newest key exists."""

    def __init__(self, project: str, *, client: httpx.Client | None = None) -> None:
        if not re.fullmatch(r"[a-z][a-z0-9-]{4,62}", project or ""):
            raise ValueError("WORKSPACE_SECRETS_PROJECT must be a Google Cloud project id")
        self._project = project
        self._client = client or httpx.Client(timeout=httpx.Timeout(15.0, connect=5.0))
        self._token: tuple[str, float] | None = None

    def __repr__(self) -> str:
        return "GcpSecretStore(<project>)"

    def _bearer(self) -> dict[str, str]:
        if self._token is None or self._token[1] - 60 < time.monotonic():
            try:
                r = self._client.get(_METADATA_TOKEN, headers={"Metadata-Flavor": "Google"})
                body = r.json()
                self._token = (str(body["access_token"]), time.monotonic() + float(body.get("expires_in", 300)))
            except (httpx.HTTPError, ValueError, KeyError):
                raise SecretStoreError("no_identity") from None
        return {"Authorization": f"Bearer {self._token[0]}"}

    def _call(self, method: str, url: str, **kw: Any) -> httpx.Response:
        try:
            return self._client.request(method, url, headers=self._bearer(), **kw)
        except httpx.HTTPError:
            raise SecretStoreError("unreachable") from None

    def put(self, name: str, value: str) -> None:
        base = f"{_API}/projects/{self._project}/secrets"
        r = self._call("POST", base, params={"secretId": name}, json={"replication": {"userManaged": {"replicas": [{"location": REGION}]}}, "labels": {"app": "stack19", "kind": "workspace-key"}})
        if r.status_code not in (200, 409):   # 409: it is already there
            logger.warning("workspace secret not created: status=%d", r.status_code)
            raise SecretStoreError("create_refused")
        data = value.encode("utf-8")
        r = self._call("POST", f"{base}/{name}:addVersion", json={"payload": {"data": base64.b64encode(data).decode("ascii")}})
        if r.status_code != 200:
            logger.warning("workspace secret version not added: status=%d", r.status_code)
            raise SecretStoreError("write_refused")
        newest = str(r.json().get("name") or "")
        listed = self._call("GET", f"{base}/{name}/versions", params={"filter": "state:ENABLED"})
        if listed.status_code == 200:
            for v in listed.json().get("versions") or []:
                if v.get("name") and v["name"] != newest:
                    gone = self._call("POST", f"{_API}/{v['name']}:destroy", json={})
                    if gone.status_code != 200:
                        logger.warning("an older workspace secret version not destroyed: status=%d", gone.status_code)

    def access(self, name: str) -> str | None:
        r = self._call("GET", f"{_API}/projects/{self._project}/secrets/{name}/versions/latest:access")
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            logger.warning("workspace secret not read: status=%d", r.status_code)
            raise SecretStoreError("read_refused")
        try:
            return base64.b64decode(r.json()["payload"]["data"]).decode("utf-8")
        except (ValueError, KeyError):
            raise SecretStoreError("read_refused") from None


class WorkspaceSecrets:
    """The secure card's request, the save, and the key for a pull. The database decides who (the Owner opens and saves; the Owner and an Admin pull)."""

    def __init__(self, rest_url: str, anon_key: str, store: SecretStore, fingerprint_key: bytes, *, rpc: RpcClient | None = None) -> None:
        self.store = store
        from app.assistant_work.store import PlanExpiredError, PlanStateError

        self._rpc = rpc or RpcClient(rest_url, anon_key, {"SM981": PlanStateError, "SM982": PlanExpiredError})
        self._fp_key = fingerprint_key
        from app.connectors.repository import PostgrestConnectorsRepository

        self.connectors = PostgrestConnectorsRepository(rest_url, anon_key)   # the IndiaMART pull window, for a workspace pulling with its own key

    def fingerprint(self, tenant_id: uuid.UUID, kind: str, value: str) -> str:
        return hmac.new(self._fp_key, f"{tenant_id}:{kind}:".encode() + value.encode("utf-8"), hashlib.sha256).hexdigest()[:16]

    def open(self, token: str, tenant_id: uuid.UUID, kind: str, message_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "secret_request_open", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_message_id": str(message_id) if message_id else None})

    def save(self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID, value: str) -> dict[str, Any]:
        """The request is used up first (once, 15 minutes, the caller's own), then Secret Manager is written, then the database learns where it is."""
        use = self._rpc.object(token, "secret_request_use", {"p_tenant_id": str(tenant_id), "p_request_id": str(request_id)})
        kind, name = str(use["kind"]), str(use["secret_name"])
        self.store.put(name, value)
        tail = last4(value)
        self._rpc.object(token, "workspace_secret_record", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_secret_name": name, "p_last4": tail or None,
                                                            "p_fingerprint": self.fingerprint(tenant_id, kind, value)})
        logger.info("workspace secret saved: kind=%s", kind)
        return {"saved": True, "last4": tail or None}

    def where(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any] | None:
        got = self._rpc.call(token, "workspace_secret_get", {"p_tenant_id": str(tenant_id), "p_kind": kind})
        return got if isinstance(got, dict) else None

    def key(self, token: str, tenant_id: uuid.UUID, kind: str) -> str | None:
        """The workspace's own key, or None when it has none (the caller then uses the installation's, as before)."""
        found = self.where(token, tenant_id, kind)
        return self.store.access(str(found["secret_name"])) if found else None
