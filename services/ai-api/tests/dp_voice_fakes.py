"""In-memory doubles for the own-voice tests of job DP part 5 (no database, no storage, no provider): the repository keeps what the database functions keep (one live voice, the sentence checked word for word,
a deletion that erases the name), the storage keeps bytes in a dict and answers like Storage does."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.ownvoice.repository import RecordingMissingError, SentenceMismatchError, VoiceExistsError
from app.tenancy.repository import UpstreamError


class FakeStorage:
    def __init__(self) -> None:
        self.files: dict[tuple[str, str], tuple[bytes, str]] = {}
        self.tokens: list[str] = []
        self.refuse_remove = False

    def upload(self, token: str, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.tokens.append(token)
        self.files[(bucket, path)] = (data, content_type)

    def sign(self, token: str, bucket: str, paths: list[str], expires: int = 600) -> dict[str, str]:
        raise AssertionError("a recording is never given a link")

    def remove(self, token: str, bucket: str, paths: list[str]) -> None:
        for p in paths:
            self.files.pop((bucket, p), None)

    def remove_checked(self, token: str, bucket: str, paths: list[str]) -> bool:
        if self.refuse_remove:
            return False
        self.remove(token, bucket, paths)
        return True


class FakeOwnVoiceRepository:
    def __init__(self, storage: FakeStorage, *, business: str = "Sri Lakshmi Silks") -> None:
        self.storage = storage
        self.business = business
        self.row: dict[str, Any] | None = None
        self.calls: list[tuple[str, Any]] = []
        self.fail_ready: Exception | None = None
        self.assistant_persona = "own_voice"
        self.tenant = uuid.UUID(int=0xA)

    def _bucket(self) -> str:
        return f"ovc-{self.tenant}"

    def sentence(self, token: str, tenant_id: uuid.UUID, name: str) -> str:
        self.calls.append(("sentence", name))
        return f"I, {name.strip()}, allow Stack19 to create an AI voice of me for {self.business}"

    def _json(self) -> dict[str, Any]:
        r = self.row
        if r is None:
            return {"status": "none", "languages": []}
        return {
            "id": r["id"], "status": r["status"], "consenting_name": r["name"], "consented_at": r["consented_at"], "sample_seconds": r["sample_seconds"], "consent_seconds": r["consent_seconds"],
            "ready_at": r.get("ready_at"), "deleted_at": r.get("deleted_at"), "languages": ["en", "te", "hi", "kn"] if r["status"] == "ready" else [],
        }

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("get", None))
        return self._json()

    def private(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        self.calls.append(("private", None))
        r = self.row
        if r is None or r["status"] == "deleted":
            return None
        return {"id": str(r["id"]), "status": r["status"], "bucket": self._bucket(), "sample_path": r["sample_path"], "consent_path": r["consent_path"], "provider": "fake", "provider_voice_id": r.get("provider_voice_id")}

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        self.calls.append(("ensure_bucket", None))
        return self._bucket()

    def begin(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("begin", {k: v for k, v in args.items() if k != "name"}))
        if self.row is not None and self.row["status"] in ("pending", "ready"):
            raise VoiceExistsError("SM831")
        if args["sentence"] != self.sentence(token, tenant_id, args["name"]):
            raise SentenceMismatchError("SM833")
        if (self._bucket(), args["sample_path"]) not in self.storage.files or (self._bucket(), args["consent_path"]) not in self.storage.files:
            raise RecordingMissingError("SM832")
        self.row = {
            "id": args["id"], "status": "pending", "name": args["name"], "sentence": args["sentence"], "consented_at": datetime.now(UTC).isoformat(), "sample_path": args["sample_path"],
            "consent_path": args["consent_path"], "sample_seconds": args["sample_seconds"], "consent_seconds": args["consent_seconds"],
        }
        return self._json()

    def ready(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID, provider: str, provider_voice_id: str) -> dict[str, Any]:
        self.calls.append(("ready", provider_voice_id))
        if self.fail_ready is not None:
            raise self.fail_ready
        assert self.row is not None and self.row["status"] == "pending"
        self.row.update(status="ready", provider_voice_id=provider_voice_id, ready_at=datetime.now(UTC).isoformat())
        return self._json()

    def failed(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("failed", None))
        assert self.row is not None
        self.row["status"] = "failed"
        return self._json()

    def deleted(self, token: str, tenant_id: uuid.UUID, voice_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("deleted", None))
        assert self.row is not None
        if (self._bucket(), self.row["sample_path"]) in self.storage.files or (self._bucket(), self.row["consent_path"]) in self.storage.files:
            raise RecordingMissingError("SM832")   # the database refuses to say deleted while a recording is still there
        self.row.update(status="deleted", name=None, sentence=None, sample_path=None, consent_path=None, provider_voice_id=None, deleted_at=datetime.now(UTC).isoformat())
        if self.assistant_persona == "own_voice":
            self.assistant_persona = "female_warm"
        return self._json()


__all__ = ["FakeOwnVoiceRepository", "FakeStorage", "UpstreamError"]
