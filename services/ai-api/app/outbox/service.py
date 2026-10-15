"""The outbox's rules that are not the database's: shaping rows into the API's answers, the opaque page cursor, and the dispatch loop that hands due messages to the channel adapter.

The database decides everything about a message (policy, blocks, state). This module only (a) words it and (b) delivers what the database claimed, and tells the database what the channel
said. It sends nothing itself: only a ChannelAdapter does, and only the local fake exists."""

from __future__ import annotations

import base64
import dataclasses
import logging
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any, Protocol

from app.catalogue.storage import CHANNEL_URL_SECONDS, StorageClient
from app.errors import ApiError
from app.outbox.adapter import (
    AudioClip,
    ChannelAdapter,
    MediaRef,
    OutgoingMessage,
    SendContext,
    SendResult,
    TemplateRef,
)
from app.outbox.models import (
    DELIVERY_TEXT,
    REASON_TEXT,
    ActorOut,
    CallRequestOut,
    DispatchOut,
    EventOut,
    MediaOut,
    OutboxMessageOut,
)
from app.tenancy.repository import RepositoryError, UpstreamError

logger = logging.getLogger("app.outbox.service")

DISPATCH_BATCH = 20
# a message whose provider was busy or unreachable is offered again when its claim lapses, this many times; then it is marked failed
MAX_SEND_ATTEMPTS = 5

# gives each photo of a message a signed address the channel can fetch it from (raises if it cannot for any of them)
MediaSigner = Callable[[str, list[MediaRef]], list[MediaRef]]
# makes the spoken copy of a claimed message, or None to send the text alone (job CV): (token, tenant id, message id). It never raises.
VoiceMaker = Callable[[str, uuid.UUID, uuid.UUID], AudioClip | None]


class MediaNotReady(Exception):
    """A photo of the message could not be given a signed address: the message is not handed to the channel this time."""


def media_signer(storage: StorageClient | None) -> MediaSigner | None:
    """A signer that asks storage, with the CALLER's token (a person's Dispatch) or the worker's token (the database lets the worker read only the files of messages it has claimed), for URLs that
    last CHANNEL_URL_SECONDS. None when there is no storage (then a message with photos is not handed over at all)."""
    if storage is None:
        return None

    def sign(token: str, refs: list[MediaRef]) -> list[MediaRef]:
        by_bucket: dict[str, list[str]] = {}
        for ref in refs:
            by_bucket.setdefault(ref.bucket, []).append(ref.path)
        urls: dict[tuple[str, str], str] = {}
        try:
            for bucket, paths in by_bucket.items():
                signed = storage.sign(token, bucket, paths, expires=CHANNEL_URL_SECONDS)
                urls.update({(bucket, path): url for path, url in signed.items()})
        except RepositoryError:
            raise MediaNotReady from None
        out = [dataclasses.replace(ref, url=urls.get((ref.bucket, ref.path))) for ref in refs]
        if any(ref.url is None for ref in out):
            raise MediaNotReady
        return out

    return sign


class DispatchPort(Protocol):
    """The two calls the dispatch loop needs. The outbox repository (a person's "dispatch now") and the scheduler's repository (the worker) both have them with these shapes."""

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...


def _customer(row: dict[str, Any]) -> tuple[str | None, str | None]:
    lead = row.get("lead")
    company = lead.get("company") if isinstance(lead, dict) else None
    if not isinstance(company, dict):
        return None, None
    name, city = company.get("name"), company.get("city")
    return (name if isinstance(name, str) else None, city if isinstance(city, str) else None)


def _send_context(raw: Any) -> SendContext | None:
    """The database's note on a claimed message for a real channel (null for the fake, or when the business has no active number)."""
    if not isinstance(raw, dict):
        return None
    try:
        template = raw.get("template")
        return SendContext(
            phone_number_id=str(raw["phone_number_id"]),
            token_ref=str(raw["token_ref"]),
            window_open=raw.get("window_open") is True,
            template=TemplateRef(str(template["name"]), str(template["language"]), str(template["body"])) if isinstance(template, dict) else None,
            coexistence=raw.get("coexistence") is True,
        )
    except (KeyError, TypeError):
        return None


def media_photos(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The photo records (bucket, thumb_path) of the messages' media, for one batch of signing."""
    return [
        m["photo"] for r in rows for m in (r.get("media") or []) if isinstance(m.get("photo"), dict)
    ]


def _media(row: dict[str, Any], urls: dict[str, str] | None) -> list[MediaOut]:
    out: list[MediaOut] = []
    for m in sorted(row.get("media") or [], key=lambda x: x.get("position", 0)):
        photo = m.get("photo") or {}
        out.append(
            MediaOut(
                photo_id=m["photo_id"],
                position=m["position"],
                thumb_url=(urls or {}).get(str(photo.get("thumb_path"))),
            )
        )
    return out


def event_out(row: dict[str, Any], names: dict[str, str]) -> EventOut:
    """One event row as the API's step. The person's name comes from `names` (user id -> display name); nothing else about them."""
    try:
        reason = row.get("reason")
        user_id = row.get("actor_user_id")
        return EventOut(
            kind=row["kind"],
            reason=reason,
            reason_text=(REASON_TEXT.get(reason) or DELIVERY_TEXT.get(reason)) if isinstance(reason, str) else None,
            at=row["at"],
            actor=ActorOut(
                kind=row["actor_kind"],
                user_id=user_id,
                name=names.get(str(user_id)) if user_id else None,
            ),
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected outbox event row") from None


def message_out(
    row: dict[str, Any],
    urls: dict[str, str] | None = None,
    events: list[EventOut] | None = None,
) -> OutboxMessageOut:
    customer, city = _customer(row)
    try:
        return OutboxMessageOut(
            id=row["id"],
            lead_id=row["lead_id"],
            contact_id=row.get("contact_id"),
            customer=customer,
            city=city,
            channel=row["channel"],
            text=row["body"],
            language=row["language"],
            category=row["category"],
            source=row["source"],
            status=row["status"],
            reason=row["reason"],
            reason_text=REASON_TEXT[row["reason"]],
            flags=row.get("flags") or [],
            model_flagged=row["model_flagged"],
            uncertain=row["uncertain"],
            disclosure_added=row["disclosure_added"],
            scheduled_for=row.get("scheduled_for"),
            created_at=row["created_at"],
            edited_at=row.get("edited_at"),
            decided_at=row.get("decided_at"),
            sent_at=row.get("sent_at"),
            failure_code=row.get("failure_code"),
            keep_record=row.get("keep_record") is True,
            media=_media(row, urls),
            gloss_en=row.get("gloss_en"),
            events=events,
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected outbox row") from None


def call_out(row: dict[str, Any]) -> CallRequestOut:
    customer, city = _customer(row)
    try:
        return CallRequestOut(
            id=row["id"],
            lead_id=row["lead_id"],
            contact_id=row["contact_id"],
            customer=customer,
            city=city,
            reason=row["reason"],
            script_draft=row["script_draft"],
            language=row["language"],
            status=row["status"],
            created_at=row["created_at"],
            decided_at=row.get("decided_at"),
            decision_note=row.get("decision_note"),
        )
    except (KeyError, ValueError, TypeError):
        raise UpstreamError("unexpected call request row") from None


# ---------------------------------------------------------------------------------------------- the page cursor: opaque to the client, (created_at as the database wrote it, id)
def encode_cursor(created_at: str, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{created_at}|{row_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[str, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        stamp, _, ident = (
            base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode().partition("|")
        )
        datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        return stamp, uuid.UUID(ident)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


def next_cursor(rows: list[dict[str, Any]], limit: int) -> str | None:
    if len(rows) < limit:
        return None
    last = rows[-1]
    return encode_cursor(str(last["created_at"]), uuid.UUID(str(last["id"])))


# ---------------------------------------------------------------------------------------------- dispatch
def dispatch_due(
    repository: DispatchPort,
    adapter: ChannelAdapter,
    token: str,
    tenant_id: uuid.UUID,
    *,
    limit: int = DISPATCH_BATCH,
    sign_media: MediaSigner | None = None,
    voice: VoiceMaker | None = None,
) -> DispatchOut:
    """Claim what is due (the database re-checks every block first), deliver each through the adapter, tell the database what happened. A message the database did not hand out (blocked at the
    re-check, held for the morning, held by the kill switch) is not touched here. If the database cannot be told, the claim lapses after two minutes and the message is offered again: a real
    adapter must therefore be given the message id as its idempotency key (OutgoingMessage.idempotency_key).

    PHOTOS (job BB): a message with photos is handed over only with a signed address for each (`sign_media`, made with the same token that claimed the message). If an address cannot be made, the
    message is neither sent nor marked: it stays claimed, the claim lapses, and the next round offers it again (`retry_later` counts them).

    VOICE NOTES (job CV): `voice`, when given, may return the spoken copy of a message (only the worker passes it, and the database decides per message). The audio travels in addition to the
    text, never instead of it, and a failure to make it only means the text goes alone."""
    sent = failed = retry_later = 0
    for item in repository.claim_due(token, tenant_id, limit):
        try:
            message_id = uuid.UUID(str(item["id"]))
            outgoing = OutgoingMessage(
                message_id,
                str(item["phone"]),
                str(item["body"]),
                str(item["language"]),
                tuple(
                    MediaRef(
                        uuid.UUID(str(m["photo_id"])),
                        str(m["bucket"]),
                        str(m["path"]),
                        str(m["content_type"]),
                    )
                    for m in (item.get("media") or [])
                ),
                int(item.get("attempts") or 1),
                _send_context(item.get("wa")),
            )
        except (KeyError, ValueError):
            logger.error("outbox claim had an unexpected shape")
            continue
        if outgoing.media:
            try:
                if sign_media is None:
                    raise MediaNotReady
                outgoing = dataclasses.replace(
                    outgoing, media=tuple(sign_media(token, list(outgoing.media)))
                )
            except MediaNotReady:
                logger.error(
                    "outbox: the photos of a message could not be signed; offered again later"
                )
                retry_later += 1
                continue
        if voice is not None:
            clip = voice(token, tenant_id, message_id)
            if clip is not None:
                outgoing = dataclasses.replace(outgoing, audio=clip)
        try:
            result = adapter.send(outgoing)
        except (
            Exception
        ) as exc:  # an adapter bug must not leave the batch half-told: only its class is kept
            logger.error("outbox adapter raised: %s", exc.__class__.__name__)
            result = SendResult(False, None, "adapter_error")
        if not result.ok and result.retry and outgoing.attempts < MAX_SEND_ATTEMPTS:
            logger.warning("outbox: the channel was busy or unreachable; offered again later")
            retry_later += 1
            continue
        try:
            if result.ok and result.adapter_message_id:
                repository.mark(
                    token,
                    {
                        "p_tenant_id": str(tenant_id),
                        "p_message_id": str(message_id),
                        "p_outcome": "sent",
                        "p_adapter": adapter.name,
                        "p_adapter_message_id": result.adapter_message_id,
                    },
                )
                sent += 1
            else:
                repository.mark(
                    token,
                    {
                        "p_tenant_id": str(tenant_id),
                        "p_message_id": str(message_id),
                        "p_outcome": "failed",
                        "p_adapter": adapter.name,
                        "p_failure_code": result.failure_code or "adapter_error",
                    },
                )
                failed += 1
        except RepositoryError as exc:
            logger.error("outbox could not record a delivery: %s", exc.__class__.__name__)
    return DispatchOut(sent=sent, failed=failed, retry_later=retry_later)
