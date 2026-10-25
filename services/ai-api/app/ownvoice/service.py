"""Making and deleting the Owner's own voice (job DP part 5).

MAKE (Owner, second factor):  check the two recordings -> make the workspace's private bucket -> upload both with the OWNER's token (the storage rules let only the Owner write there) -> the database looks at
the files itself and records the consent (name, time, the exact sentence) -> the provider makes the voice from the SAMPLE only (the consent recording is never sent anywhere) -> the database makes it selectable.
If the provider refuses, the attempt is marked failed and both recordings are removed: nothing of a refused attempt is kept.

DELETE (Owner, second factor), in this order so that nothing is left half done: the voice at the provider (safe to repeat) -> both recordings (checked: they must really be gone) -> the record (name and
sentence erased, the voice no longer selectable, an assistant that used it falls back to a stock voice). A failure of any step stops there and the Owner can press delete again.

No recording and no transcript is ever logged; the logs say only what step ran."""

from __future__ import annotations

import base64
import binascii
import logging
import uuid
from typing import Any

from app.catalogue.storage import StorageClient
from app.errors import ApiError
from app.ownvoice import audio_check
from app.ownvoice.models import (
    MAX_CONSENT_BYTES,
    MAX_SAMPLE_BYTES,
    OwnVoiceIn,
    OwnVoiceOut,
    SentenceOut,
)
from app.ownvoice.repository import OwnVoiceRepository
from app.tenancy.repository import RepositoryError
from app.voice.interface import VoiceCloner, VoiceError

logger = logging.getLogger("app.ownvoice")

REFUSALS = {
    "not_audio": "That recording is not an audio file of the kind it says.",
    "length_mismatch": "That recording is not as long as it should be.",
    "implausible_length": "That recording does not look like speech of that length.",
}


class OwnVoiceService:
    def __init__(self, repository: OwnVoiceRepository, storage: StorageClient, cloner: VoiceCloner) -> None:
        self._repo = repository
        self._storage = storage
        self._cloner = cloner

    def sentence(self, token: str, tenant_id: uuid.UUID, name: str) -> SentenceOut:
        return SentenceOut(sentence=self._repo.sentence(token, tenant_id, name))

    def get(self, token: str, tenant_id: uuid.UUID) -> OwnVoiceOut:
        return OwnVoiceOut.model_validate(self._repo.get(token, tenant_id))

    # ------------------------------------------------------------------ make
    @staticmethod
    def _decode(text: str, limit: int) -> bytes:
        try:
            data = base64.b64decode(text, validate=True)
        except (binascii.Error, ValueError):
            raise ApiError(422, "recording_not_base64", "That recording could not be read.") from None
        if not data or len(data) > limit:
            raise ApiError(413, "recording_too_large", "That recording is too big.")
        return data

    def create(self, token: str, tenant_id: uuid.UUID, body: OwnVoiceIn) -> OwnVoiceOut:
        sample = self._decode(body.sample_base64, MAX_SAMPLE_BYTES)
        consent = self._decode(body.consent_base64, MAX_CONSENT_BYTES)
        try:
            sample_seconds = audio_check.check(sample, body.sample_type, body.sample_seconds)
            consent_seconds = audio_check.check(consent, body.consent_type, body.consent_seconds)
        except audio_check.AudioRefused as exc:
            raise ApiError(422, f"recording_{exc.code}", REFUSALS[exc.code]) from None
        bucket = self._repo.ensure_bucket(token, tenant_id)
        sample_path = f"{body.id}/sample.{audio_check.EXTENSION[body.sample_type]}"
        consent_path = f"{body.id}/consent.{audio_check.EXTENSION[body.consent_type]}"
        self._storage.upload(token, bucket, sample_path, sample, body.sample_type)
        self._storage.upload(token, bucket, consent_path, consent, body.consent_type)
        try:
            self._repo.begin(
                token, tenant_id,
                {"id": body.id, "name": body.name, "sentence": body.consent_sentence, "sample_path": sample_path, "sample_seconds": sample_seconds, "consent_path": consent_path, "consent_seconds": consent_seconds},
            )
        except RepositoryError:
            self._storage.remove(token, bucket, [sample_path, consent_path])   # the consent was not recorded: neither recording is kept
            raise
        try:
            provider_voice = self._cloner.create(sample, body.sample_type, label="Your own voice")
        except VoiceError as exc:
            logger.warning("own voice: the provider refused (%s)", exc.code)
            self._repo.failed(token, tenant_id, body.id)
            self._storage.remove(token, bucket, [sample_path, consent_path])
            raise ApiError(502, "voice_provider_refused", "The voice could not be made right now. Nothing was kept. Try again later.") from None
        try:
            self._repo.ready(token, tenant_id, body.id, self._cloner.name, provider_voice)
        except RepositoryError:
            self._cloner.delete(provider_voice)   # nothing keeps running that the database does not know of
            raise
        return self.get(token, tenant_id)

    # ------------------------------------------------------------------ delete
    def delete(self, token: str, tenant_id: uuid.UUID) -> OwnVoiceOut:
        live: dict[str, Any] | None = self._repo.private(token, tenant_id)
        if live is None:
            return self.get(token, tenant_id)
        voice_id = uuid.UUID(str(live["id"]))
        if live.get("provider_voice_id"):
            try:
                self._cloner.delete(str(live["provider_voice_id"]))
            except VoiceError as exc:
                logger.warning("own voice: the provider could not delete (%s)", exc.code)
                raise ApiError(502, "voice_provider_unreachable", "The voice could not be removed right now. Nothing changed. Press delete again in a moment.") from None
        paths = [p for p in (live.get("sample_path"), live.get("consent_path")) if p]
        if paths and not self._storage.remove_checked(token, str(live["bucket"]), [str(p) for p in paths]):
            raise ApiError(502, "recordings_not_removed", "The recordings could not be removed right now. Press delete again in a moment.")
        self._repo.deleted(token, tenant_id, voice_id)
        return self.get(token, tenant_id)
