"""Suppression keys in use (T010, ADR 0020): compute a contact's keys with the ring, record them, backfill the contacts that have none.

NOTHING here logs, returns or raises with an identifier, a key or an HMAC. A key that cannot be recorded never fails the request that triggered it (a contact is still created, an
erasure still reaches the database): the contact stays unkeyed, which is SAFE (it cannot receive a follow-up draft, T010 part 2) and is what the backfill is for."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.suppression.keys import KeyRing
from app.suppression.repository import SuppressionRepository
from app.tenancy.repository import RepositoryError

logger = logging.getLogger("app.suppression.service")
BATCH = 100
MAX_BATCHES = 5  # one backfill call handles at most this many batches; the Owner calls again while contacts remain


def record_for_contact(
    repo: SuppressionRepository | None,
    ring: KeyRing | None,
    token: str,
    contact_id: uuid.UUID,
    email: str | None,
    phone: str | None,
) -> dict[str, Any] | None:
    """Compute and record the keys of one contact with the caller's token. Returns the database's answer (flags only) or None when nothing was recorded."""
    if repo is None or ring is None:
        return None
    keys, also = ring.keys_of(email, phone)
    if not ring.has_keys(keys):
        return None
    try:
        return repo.record_keys(token, contact_id, keys, also)
    except RepositoryError as exc:
        logger.warning("suppression keys were not recorded: %s", type(exc).__name__)
        return None


def backfill(
    repo: SuppressionRepository, ring: KeyRing, token: str, tenant_id: uuid.UUID
) -> dict[str, int]:
    """Key the contacts that hold an identifier with no key, in batches. Stops when a batch brings nothing new (a contact whose identifier cannot be normalised stays unkeyed:
    it is counted as `unkeyable`, not retried forever)."""
    recorded = skipped = flagged = unkeyable = 0
    seen: set[str] = set()
    remaining = repo.unkeyed_count(token, tenant_id)
    for _ in range(MAX_BATCHES):
        rows = [
            r
            for r in repo.unkeyed_contacts(token, tenant_id, BATCH)
            if str(r.get("id")) not in seen
        ]
        if not rows:
            break
        items: list[dict[str, Any]] = []
        for row in rows:
            seen.add(str(row.get("id")))
            keys, also = ring.keys_of(row.get("email"), row.get("phone"))
            fully = (row.get("email") is None or "email" in keys) and (
                row.get("phone") is None or "phone" in keys
            )
            if not fully:
                unkeyable += 1
            if ring.has_keys(keys):
                items.append({"contact_id": str(row["id"]), "keys": keys, "also": also})
        if not items:
            break
        done = repo.backfill(token, tenant_id, items)
        recorded += int(done.get("recorded", 0))
        skipped += int(done.get("skipped", 0))
        flagged += int(done.get("flagged", 0))
        remaining = int(done.get("remaining", remaining))
        if remaining == 0 or int(done.get("recorded", 0)) == 0:
            break
    return {
        "recorded": recorded,
        "skipped": skipped,
        "flagged": flagged,
        "unkeyable": unkeyable,
        "remaining": remaining,
    }
