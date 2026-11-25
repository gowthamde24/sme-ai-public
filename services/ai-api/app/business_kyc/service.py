"""Business KYC through the app (Model B): a VoiceLink client per workspace, its KYC steps in plain words.

The identity details and files pass through this process to VoiceLink and are dropped: nothing here is stored or logged except the state word and VoiceLink's client id (migration 20261231991200).
Aadhaar never reaches us: DigiLocker opens in the person's browser and returns to VoiceLink's page. Every unknown answer of VoiceLink becomes a closed word, never a raw message."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import binascii
import logging
import secrets
import uuid
from collections.abc import Callable
from typing import Any, Protocol

from app.errors import ApiError
from app.rpc_base import RpcClient
from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError

log = logging.getLogger("app.business_kyc")
MAX_FILE = 10 * 1024 * 1024
TYPES = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}
MAGIC = {"application/pdf": b"%PDF-", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff"}

WORDS = {
    "unavailable": "We could not reach the verification service. Please try again in a few minutes.",
    "email_in_use": "That e-mail address is already used for another phone-service account. Please contact us.",
    "pan_mismatch": "The name does not match the PAN card. Type it exactly as on the card.",
    "pan_invalid": "That PAN is not valid. Check the ten characters and try again.",
    "gst_invalid": "That GSTIN could not be verified. Check the 15 characters and try again.",
    "step_order": "Please finish the earlier step first.",
    "file_unreadable": "The file could not be read. Please upload a clear photo or PDF (up to 10 MB).",
    "file_too_big": "That file is bigger than 10 MB.",
    "missing_documents": "Some documents are still missing.",
    "refused": "That could not be saved. Please check the details and try again.",
    "not_started": "Start the verification first.",
    "stuck": "We could not finish. Our team has been told; your details are kept as they were.",
}


class Repo(Protocol):
    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...
    def put(self, token: str, tenant_id: uuid.UUID, client_id: int, account_type: str | None, state: str, reason: str | None) -> dict[str, Any]: ...


class RpcRepo:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "business_client_get", {"p_tenant_id": str(tenant_id)})
        return out if isinstance(out, dict) else None

    def put(self, token: str, tenant_id: uuid.UUID, client_id: int, account_type: str | None, state: str, reason: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "business_client_put", {"p_tenant_id": str(tenant_id), "p_client_id": client_id, "p_account_type": account_type, "p_state": state, "p_reason": reason})


def refusal(reason: str, *, status: int = 422, extra: dict[str, Any] | None = None) -> ApiError:
    return ApiError(status, "kyc_unavailable" if reason == "unavailable" else "kyc_refused", WORDS.get(reason, WORDS["refused"]), extra={"reason": reason, **(extra or {})})


def _unavailable(exc: VoicelinkError) -> bool:
    return exc.reason in ("unreachable", "server", "auth")


class BusinessKycService:
    def __init__(self, repo: Repo, api: VoicelinkApi, *, return_url: str, alert: Callable[[str], None] | None = None) -> None:
        self._repo, self._api, self._return_url, self._alert = repo, api, return_url, alert

    # ------------------------------------------------------------------------------------------ reads
    def _row(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        return self._repo.get(token, tenant_id)

    def _need_client(self, token: str, tenant_id: uuid.UUID) -> tuple[int, dict[str, Any]]:
        row = self._row(token, tenant_id)
        if row is None:
            raise refusal("not_started")
        return int(row["client_id"]), row

    def status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        row = self._row(token, tenant_id)
        if row is None:
            return {"state": "not_started", "account_type": None, "step": None, "steps": {}, "missing": [], "reason": None, "words": None}
        out: dict[str, Any] = {"state": row["state"], "account_type": row.get("account_type"), "step": None, "steps": {}, "missing": [], "reason": row.get("reason"), "words": WORDS.get(str(row.get("reason") or ""))}
        if row["state"] == "verified":
            return out
        try:
            live = self._api.kyc_status(int(row["client_id"]))
        except VoicelinkError as exc:
            if _unavailable(exc):
                return out   # what we last knew; VoiceLink is not answering
            return out
        raw_docs = live.get("documents")
        docs: dict[str, Any] = raw_docs if isinstance(raw_docs, dict) else {}
        out["steps"] = {k: bool(isinstance(v, dict) and v.get("uploaded")) for k, v in docs.items() if k in ("pan", "aadhaar", "gst")}
        step = live.get("current_step")
        out["step"] = step if isinstance(step, str) and step.isalpha() and len(step) < 20 else None
        if live.get("is_complete") is True or live.get("kyc_status") == 1:
            out["state"] = "verified"
            self._repo.put(token, tenant_id, int(row["client_id"]), None, "verified", None)
        return out

    def ensure_client(self, token: str, tenant_id: uuid.UUID, email: str, name: str) -> int:
        """The workspace's own VoiceLink client: made now if it has none (the account details are the signed-in Owner's e-mail and the business name). Raises the plain refusal of `start` when VoiceLink cannot."""
        row = self._row(token, tenant_id)
        if row is None:
            self.start(token, tenant_id, email, name, None)
            row = self._row(token, tenant_id)
        if row is None:
            raise refusal("unavailable", status=503)
        return int(row["client_id"])

    def has_client(self, token: str, tenant_id: uuid.UUID) -> bool:
        return self._row(token, tenant_id) is not None

    def verified(self, token: str, tenant_id: uuid.UUID) -> bool:
        return self.client_for(token, tenant_id) is not None

    def refresh_pending(self, system_token: str, rpc: RpcClient) -> int:
        """The worker's pass: ask VoiceLink about each client still waiting and mark the approved ones, so a number goes live without the owner opening a page. Returns how many were marked."""
        marked = 0
        waiting = rpc.call(system_token, "business_client_pending", {"p_limit": 50})
        for item in waiting if isinstance(waiting, list) else []:
            try:
                live = self._api.kyc_status(int(item["client_id"]))
            except (VoicelinkError, KeyError, ValueError, TypeError):
                continue
            if live.get("is_complete") is True or live.get("kyc_status") == 1:
                rpc.call(system_token, "business_client_mark_verified", {"p_tenant_id": str(item["tenant_id"])})
                marked += 1
        return marked

    def client_for(self, token: str, tenant_id: uuid.UUID) -> int | None:
        """The client number may be bought under: only when its KYC is complete."""
        row = self._row(token, tenant_id)
        if row is None:
            return None
        if row["state"] == "verified":
            return int(row["client_id"])
        if row["state"] in ("submitted", "in_progress", "created"):
            status = self.status(token, tenant_id)
            if status["state"] == "verified":
                return int(row["client_id"])
        return None

    # ------------------------------------------------------------------------------------------ steps
    def start(self, token: str, tenant_id: uuid.UUID, email: str, name: str, phone: str | None) -> dict[str, Any]:
        if self._row(token, tenant_id) is not None:
            return self.status(token, tenant_id)
        first, _, last = (name.strip() or "Business owner").partition(" ")
        try:
            client_id = self._api.create_client(
                username="s19-" + tenant_id.hex[:12], email=email, first_name=first[:40] or "Business", last_name=(last or "Owner")[:40], password=secrets.token_urlsafe(18), phone=phone, channel_count=1,
            )
        except VoicelinkError as exc:
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            raise refusal("email_in_use") from None
        self._repo.put(token, tenant_id, client_id, None, "created", None)
        return self.status(token, tenant_id)

    def _step(self, token: str, tenant_id: uuid.UUID, step: str, fields: dict[str, Any], *, account_type: str | None = None) -> dict[str, Any]:
        client_id, _ = self._need_client(token, tenant_id)
        try:
            data = self._api.kyc_step(step, client_id, fields)
        except VoicelinkError as exc:
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            data = exc.data
            if step == "pan-verify" and data.get("pan_match_status") == 2:
                raise refusal("pan_mismatch") from None
            raise refusal({"pan-verify": "pan_invalid", "gst-verify": "gst_invalid"}.get(step, "step_order" if exc.status == 422 else "refused")) from None
        if step == "pan-verify" and data.get("pan_match_status") == 2:
            raise refusal("pan_mismatch")
        self._repo.put(token, tenant_id, client_id, account_type, "in_progress", None)
        return data

    def details(self, token: str, tenant_id: uuid.UUID, fields: dict[str, Any]) -> dict[str, Any]:
        self._step(token, tenant_id, "register-details", {**fields, "term_and_condition": True}, account_type=str(fields.get("account_type")))
        return self.status(token, tenant_id)

    def pan(self, token: str, tenant_id: uuid.UUID, pan_number: str, holder_name: str) -> dict[str, Any]:
        self._step(token, tenant_id, "pan-verify", {"pan_number": pan_number.upper(), "pan_holder_name": holder_name})
        return self.status(token, tenant_id)

    def gst(self, token: str, tenant_id: uuid.UUID, gst_number: str) -> dict[str, Any]:
        self._step(token, tenant_id, "gst-verify", {"gst_number": gst_number.upper()})
        return self.status(token, tenant_id)

    def aadhaar_start(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """The address DigiLocker opens at, in the person's own browser (their phone). Aadhaar details never come to us."""
        data = self._step(token, tenant_id, "aadhaar-init", {"redirect_url": self._return_url})
        url = data.get("redirect_url")
        if not isinstance(url, str) or not url.startswith("https://"):
            raise refusal("refused")
        return {"redirect_url": url}

    def upload(self, token: str, tenant_id: uuid.UUID, document_type: str, content_type: str, content_base64: str) -> dict[str, Any]:
        client_id, _ = self._need_client(token, tenant_id)
        if content_type not in TYPES or document_type not in ("pan", "aadhaar", "gst") or len(content_base64) > MAX_FILE * 4 // 3 + 16:
            raise refusal("file_too_big" if len(content_base64) > MAX_FILE * 4 // 3 + 16 else "file_unreadable")
        try:
            content = base64.b64decode(content_base64, validate=True)
        except (binascii.Error, ValueError):
            raise refusal("file_unreadable") from None
        if not content or len(content) > MAX_FILE or not content.startswith(MAGIC[content_type]):
            raise refusal("file_too_big" if len(content) > MAX_FILE else "file_unreadable")
        try:
            self._api.kyc_upload(client_id, document_type, f"{document_type}.{TYPES[content_type]}", content, content_type)
        except VoicelinkError as exc:
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            raise refusal("step_order") from None
        finally:
            del content
        return self.status(token, tenant_id)

    def submit(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        client_id, _ = self._need_client(token, tenant_id)
        try:
            self._api.kyc_final_submit(client_id)
        except VoicelinkError as exc:
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            missing = exc.data.get("missing_documents")
            if isinstance(missing, list):
                labels = [m for m in missing if isinstance(m, str) and len(m) < 40][:5]
                raise refusal("missing_documents", extra={"missing": labels}) from None
            self._repo.put(token, tenant_id, client_id, None, "stuck", "submit_refused")   # not a missing document: a person at Stack19 looks
            if self._alert is not None:
                try:
                    self._alert("Business KYC: VoiceLink refused a final submit that lists no missing document (client submit may not be supported). Check the client in the VoiceLink portal.")
                except Exception as err:  # noqa: BLE001
                    log.warning("business_kyc alert_failed %s", err.__class__.__name__)
            raise refusal("stuck", status=409) from None
        self._repo.put(token, tenant_id, client_id, None, "submitted", None)
        return self.status(token, tenant_id)
