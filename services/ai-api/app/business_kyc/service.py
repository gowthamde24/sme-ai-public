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

from app.business_kyc import rules
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
    "no_line_yet": "We are setting up your line. This takes a short while.",
    "credits_needed": "Add credits to set up your phone number: the first month is taken from your credits now and given back if you do not finish.",
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

    def wait_get(self, token: str, tenant_id: uuid.UUID) -> bool:
        out = self._rpc.call(token, "business_line_wait_get", {"p_tenant_id": str(tenant_id)})
        return isinstance(out, dict) and out.get("waiting") is True

    def wait_put(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "business_line_wait_put", {"p_tenant_id": str(tenant_id)})

    def wait_clear(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "business_line_wait_clear", {"p_tenant_id": str(tenant_id)})

    def reserve_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        out = self._rpc.call(token, "line_reserve_get", {"p_tenant_id": str(tenant_id)})
        return out if isinstance(out, dict) else {}

    def reserve_place(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        out = self._rpc.call(token, "line_reserve_place", {"p_tenant_id": str(tenant_id)})
        return out if isinstance(out, dict) else {}

    def reserve_close(self, token: str, tenant_id: uuid.UUID, outcome: str) -> bool:
        out = self._rpc.call(token, "line_reserve_close", {"p_tenant_id": str(tenant_id), "p_outcome": outcome})
        return isinstance(out, dict) and out.get("closed") is True

    def client_remove(self, token: str, tenant_id: uuid.UUID) -> None:
        self._rpc.call(token, "business_client_remove", {"p_tenant_id": str(tenant_id)})


def refusal(reason: str, *, status: int = 422, extra: dict[str, Any] | None = None) -> ApiError:
    return ApiError(status, "kyc_unavailable" if reason == "unavailable" else "kyc_refused", WORDS.get(reason, WORDS["refused"]), extra={"reason": reason, **(extra or {})})


def _inr(paise: int) -> str:
    return f"₹{paise // 100:,}" if paise % 100 == 0 else f"₹{paise / 100:,.2f}"


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
            if self._waiting(token, tenant_id):
                return {"state": "waiting_for_line", "account_type": None, "step": None, "steps": {}, "missing": [], "reason": "no_line_yet", "words": WORDS["no_line_yet"]}
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
        verified_flag = live.get("aadhaar_verified")
        out["aadhaar_verified"] = verified_flag if isinstance(verified_flag, bool) else None
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
        try:   # the same pass: first months held too long go back, and the free-channel figure is kept for the low-stock alert
            self.release_due(system_token, rpc)
            self.note_stock(system_token, rpc)
        except Exception as exc:  # noqa: BLE001 - a failed release never hides the approvals above; it is tried again next tick
            log.warning("business_kyc release_failed %s", exc.__class__.__name__)
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

    def _waiting(self, token: str, tenant_id: uuid.UUID) -> bool:
        wait_get = getattr(self._repo, "wait_get", None)
        try:
            return bool(wait_get(token, tenant_id)) if wait_get is not None else False
        except Exception:   # noqa: BLE001 - an unreadable marker is "not waiting": the status then says not started and the Owner may try again
            return False

    def _set_waiting(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """No free channel at VoiceLink for this business's own client: it WAITS (the staff console says so; the Owner is told, not turned away)."""
        wait_put = getattr(self._repo, "wait_put", None)
        if wait_put is not None:
            wait_put(token, tenant_id)
        log.warning("business_kyc no_free_channel tenant_fp=%s", str(tenant_id)[:8])
        return self.status(token, tenant_id)

    def retry_waiting(self, token: str, tenant_id: uuid.UUID, email: str, name: str) -> dict[str, Any]:
        """The Owner's screen read the status while the business waits for a line: if a channel is free now the client is made (the same call as `start`)."""
        return self.start(token, tenant_id, email, name, None)

    def _reserve(self, token: str, tenant_id: uuid.UUID) -> bool:
        """Places the reserve; True when THIS call debited it (so a failed client can give it back). 402 `credits_needed` when the balance is too low: nothing is created."""
        place = getattr(self._repo, "reserve_place", None)
        if place is None:
            return False
        out = place(token, tenant_id)
        if out.get("placed") is not True:
            needed = int(out.get("needed_paise") or 0)
            raise ApiError(402, "credits_needed", WORDS["credits_needed"], extra={"needed_paise": needed, "needed_text": _inr(needed), "balance_paise": int(out.get("balance_paise") or 0)})
        return out.get("replayed") is not True and int(out.get("amount_paise") or 0) > 0

    def _repo_close(self, token: str, tenant_id: uuid.UUID, outcome: str) -> bool:
        close = getattr(self._repo, "reserve_close", None)
        return bool(close(token, tenant_id, outcome)) if close is not None else False

    def reserve_info(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        get = getattr(self._repo, "reserve_get", None)
        if get is None:
            return None
        try:
            got = get(token, tenant_id)
        except Exception:   # noqa: BLE001 - the screen can do without it
            return None
        price, amount = int(got.get("price_paise") or 0), int(got.get("amount_paise") or 0)
        return {"state": got.get("state") or "none", "amount_paise": amount, "amount_text": _inr(amount), "price_paise": price, "price_text": _inr(price), "due_at": got.get("due_at")}

    def reserve_applied(self, token: str, tenant_id: uuid.UUID) -> None:
        """The number was bought: the held first month is now the number fee (no money moves)."""
        self._repo_close(token, tenant_id, "applied")

    def cancel(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """The Owner stops before the number is bought: the first month is refunded, the unverified client is deleted at VoiceLink (its channel returns) and the business can start again."""
        row = self._row(token, tenant_id)
        if row is not None and row["state"] == "verified":
            raise refusal("refused")
        if row is not None:
            try:
                self._api.delete_client(int(row["client_id"]))
            except VoicelinkError:
                log.warning("business_kyc client_delete_failed tenant_fp=%s", str(tenant_id)[:8])
        self._repo_close(token, tenant_id, "refunded")
        remove = getattr(self._repo, "client_remove", None)
        if remove is not None:
            remove(token, tenant_id)
        return self.status(token, tenant_id)

    def release_due(self, system_token: str, rpc: Any) -> int:
        """The worker's pass: a first month held for 14 days without a verified business, or for a KYC that is stuck, goes back, and the abandoned client is deleted so its channel returns. Idempotent: a refunded reserve is not listed again."""
        released = 0
        due = rpc.call(system_token, "scheduler_line_reserves_due", {"p_limit": 50})
        for item in due if isinstance(due, list) else []:
            try:
                if item.get("client_id"):
                    try:
                        self._api.delete_client(int(item["client_id"]))
                    except VoicelinkError:
                        log.warning("business_kyc client_delete_failed")
                rpc.call(system_token, "scheduler_line_reserve_refund", {"p_tenant_id": str(item["tenant_id"]), "p_reason": "expired"})
                released += 1
            except (KeyError, ValueError, TypeError):
                continue
        return released

    def note_stock(self, system_token: str, rpc: Any) -> None:
        free = self._api.free_channels()
        if free is not None:
            rpc.call(system_token, "scheduler_channel_stock_put", {"p_free": max(int(free), 0)})

    # ------------------------------------------------------------------------------------------ steps
    def start(self, token: str, tenant_id: uuid.UUID, email: str, name: str, phone: str | None) -> dict[str, Any]:
        if self._row(token, tenant_id) is not None:
            return self.status(token, tenant_id)
        free = self._api.free_channels()
        if free is not None and free < 1:   # known to be empty: do not even ask (VoiceLink would refuse)
            return self._set_waiting(token, tenant_id)
        placed = self._reserve(token, tenant_id)   # the first month of the number leaves the balance now (only when a channel is free); too little credit: nothing is created
        first, _, last = (name.strip() or "Business owner").partition(" ")
        try:
            client_id = self._api.create_client(
                username="s19-" + tenant_id.hex[:12], email=email, first_name=first[:40] or "Business", last_name=(last or "Owner")[:40], password=secrets.token_urlsafe(18), phone=phone, channel_count=1,
            )
        except VoicelinkError as exc:
            if placed:
                self._repo_close(token, tenant_id, "refunded")   # nothing was made: the money goes straight back
            if exc.reason == "no_channel":
                return self._set_waiting(token, tenant_id)
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            raise refusal("email_in_use") from None
        self._repo.put(token, tenant_id, client_id, None, "created", None)
        wait_clear = getattr(self._repo, "wait_clear", None)
        if wait_clear is not None:
            wait_clear(token, tenant_id)
        return self.status(token, tenant_id)

    def _step(self, token: str, tenant_id: uuid.UUID, step: str, fields: dict[str, Any], *, account_type: str | None = None) -> dict[str, Any]:
        client_id, _ = self._need_client(token, tenant_id)
        try:
            data = self._api.kyc_step(step, client_id, fields)
        except VoicelinkError as exc:
            if _unavailable(exc):
                raise refusal("unavailable", status=503) from None
            data = exc.data
            if step == "register-details" and "city" in exc.message.lower() and "not found" in exc.message.lower():   # VoiceLink's own list of cities per state: "City 'Anantapur' was not found in the selected state."
                raise rules.refuse({"city": "city_not_found"}) from None
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
