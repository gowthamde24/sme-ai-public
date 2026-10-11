"""The outbox's rules that are not the database's: shaping rows into the API's answers, the opaque page cursor, and the dispatch loop that hands due messages to the channel adapter.

The database decides everything about a message (policy, blocks, state). This module only (a) words it and (b) delivers what the database claimed, and tells the database what the channel
said. It sends nothing itself: only a ChannelAdapter does, and only the local fake exists."""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime
from typing import Any, Protocol

from app.errors import ApiError
from app.outbox.adapter import ChannelAdapter, MediaRef, OutgoingMessage, SendResult
from app.outbox.models import REASON_TEXT, CallRequestOut, DispatchOut, MediaOut, OutboxMessageOut
from app.tenancy.repository import RepositoryError, UpstreamError

logger = logging.getLogger("app.outbox.service")

DISPATCH_BATCH = 20


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


def message_out(row: dict[str, Any], urls: dict[str, str] | None = None) -> OutboxMessageOut:
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
) -> DispatchOut:
    """Claim what is due (the database re-checks every block first), deliver each through the adapter, tell the database what happened. A message the database did not hand out (blocked at the
    re-check, held for 9 am, held by the kill switch) is not touched here. If the database cannot be told, the claim lapses after two minutes and the message is offered again: a real
    adapter must therefore be given the message id as its idempotency key."""
    sent = failed = 0
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
            )
        except (KeyError, ValueError):
            logger.error("outbox claim had an unexpected shape")
            continue
        try:
            result = adapter.send(outgoing)
        except (
            Exception
        ) as exc:  # an adapter bug must not leave the batch half-told: only its class is kept
            logger.error("outbox adapter raised: %s", exc.__class__.__name__)
            result = SendResult(False, None, "adapter_error")
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
    return DispatchOut(sent=sent, failed=failed)
