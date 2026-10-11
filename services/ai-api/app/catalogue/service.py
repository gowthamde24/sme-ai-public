"""The catalogue's rules that are not the database's: shaping rows into the API's answers, signing photo URLs in one batch, the opaque page cursor, and the upload (decode, resize, strip, store, register)."""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime
from typing import Any

from app.catalogue import images
from app.catalogue.errors import PhotoRejectedError
from app.catalogue.models import (
    CatalogueItemOut,
    CatalogueItemSummary,
    PhotoOut,
)
from app.catalogue.repository import CatalogueRepository
from app.catalogue.storage import SIGNED_URL_SECONDS, StorageClient
from app.catalogue.vocab import BAND_LABEL, FABRIC_LABEL, STOCK_LABEL
from app.errors import ApiError
from app.tenancy.repository import RepositoryError, UpstreamError
from app.today.service import format_rupees

logger = logging.getLogger("app.catalogue.service")


def price_text(paise: Any) -> str | None:
    return (
        format_rupees(int(paise))
        if isinstance(paise, int) and not isinstance(paise, bool)
        else None
    )


def sign_urls(
    storage: StorageClient | None,
    token: str,
    photos: list[dict[str, Any]],
    *,
    thumbs_only: bool = False,
) -> dict[str, str]:
    """path -> signed URL for the given photos (all in one bucket per business, so one call per bucket). If storage cannot sign, the photos are returned without URLs rather than failing the page."""
    if storage is None:
        return {}
    by_bucket: dict[str, list[str]] = {}
    for p in photos:
        paths = by_bucket.setdefault(str(p["bucket"]), [])
        paths.append(str(p["thumb_path"]))
        if not thumbs_only:
            paths.append(str(p["path"]))
    out: dict[str, str] = {}
    for bucket, paths in by_bucket.items():
        try:
            out.update(storage.sign(token, bucket, paths))
        except UpstreamError:
            logger.warning("photo urls could not be signed")
    return out


def photo_out(p: dict[str, Any], urls: dict[str, str]) -> PhotoOut:
    return PhotoOut(
        id=p["id"],
        position=p["position"],
        url=urls.get(str(p["path"])),
        thumb_url=urls.get(str(p["thumb_path"])),
        width=p["width"],
        height=p["height"],
        bytes=p["bytes"],
        expires_in_seconds=SIGNED_URL_SECONDS,
    )


def _base(row: dict[str, Any]) -> dict[str, Any]:
    try:
        return {
            "id": row["id"],
            "name": row["name"],
            "fabric": row["fabric"],
            "fabric_label": FABRIC_LABEL[row["fabric"]],
            "colours": row["colours"],
            "zari": row["zari"],
            "border": row.get("border"),
            "occasions": row["occasions"],
            "price_band": row["price_band"],
            "price_band_label": BAND_LABEL[row["price_band"]],
            "price_paise": row.get("price_paise"),
            "price_text": price_text(row.get("price_paise")),
            "stock_status": row["stock_status"],
            "stock_label": STOCK_LABEL[row["stock_status"]],
            "active": row["active"],
            "photo_count": len(row.get("photos") or []),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }
    except (KeyError, TypeError):
        raise UpstreamError("unexpected catalogue row") from None


def item_out(row: dict[str, Any], urls: dict[str, str]) -> CatalogueItemOut:
    try:
        return CatalogueItemOut(
            **_base(row), photos=[photo_out(p, urls) for p in row.get("photos") or []]
        )
    except (KeyError, TypeError, ValueError):
        raise UpstreamError("unexpected catalogue row") from None


def summary_out(row: dict[str, Any], urls: dict[str, str]) -> CatalogueItemSummary:
    photos = row.get("photos") or []
    try:
        return CatalogueItemSummary(
            **_base(row), cover=photo_out(photos[0], urls) if photos else None
        )
    except (KeyError, TypeError, ValueError):
        raise UpstreamError("unexpected catalogue row") from None


# ---------------------------------------------------------------------------------------------- the page cursor: (rank, name, id), opaque to the client
def encode_cursor(rank: int, name: str, item_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{rank}|{item_id}|{name}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[int, str, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        rank, item_id, name = text.split("|", 2)
        return int(rank), name, uuid.UUID(item_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


def next_cursor(rows: list[dict[str, Any]], limit: int) -> str | None:
    if len(rows) < limit:
        return None
    last = rows[-1]
    return encode_cursor(int(last["rank"]), str(last["name"]), uuid.UUID(str(last["id"])))


def search_args(
    *,
    fabric: str | None,
    colours: list[str] | None,
    occasions: list[str] | None,
    price_bands: list[str] | None,
    in_stock_only: bool,
    include_inactive: bool,
    limit: int,
    after: tuple[int, str, uuid.UUID] | None,
) -> dict[str, Any]:
    return {
        "p_fabric": fabric,
        "p_colours": colours,
        "p_occasions": occasions,
        "p_price_bands": price_bands,
        "p_in_stock_only": in_stock_only,
        "p_include_inactive": include_inactive,
        "p_limit": limit,
        "p_after_rank": after[0] if after else None,
        "p_after_name": after[1] if after else None,
        "p_after_id": str(after[2]) if after else None,
    }


# ---------------------------------------------------------------------------------------------- the upload
class UploadFailed(ApiError):
    pass


REJECTIONS: dict[str, tuple[int, str, str]] = {
    "too_large": (413, "photo_too_large", "That photo is bigger than 5 MB."),
    "unsupported_type": (415, "photo_type_unsupported", "Use a JPEG, PNG or WebP photo."),
    "unreadable": (422, "photo_unreadable", "That file could not be read as a photo."),
    "too_big_pixels": (422, "photo_too_big", "That photo has too many pixels. Use a smaller one."),
    "animated": (422, "photo_animated", "Use a still photo, not an animation."),
}


def store_photo(
    repository: CatalogueRepository,
    storage: StorageClient,
    token: str,
    tenant_id: uuid.UUID,
    item_id: uuid.UUID,
    photo_id: uuid.UUID,
    data: bytes,
    declared_type: str | None,
) -> dict[str, Any]:
    """Decode and clean the upload, put the photo and its thumbnail in the business's private bucket, then register the photo. If registering fails (a ninth photo, the item is not this business's) the files
    just stored are removed again. An exact retry (same photo id) is safe: the files are the same bytes, the registration replays."""
    try:
        processed = images.process(data, declared_type)
    except PhotoRejectedError as exc:
        status, code, message = REJECTIONS[exc.code]
        raise ApiError(status, code, message) from None
    bucket = repository.ensure_bucket(token, tenant_id)
    path = f"{item_id}/{photo_id}.jpg"
    thumb = f"{item_id}/{photo_id}_t.jpg"
    storage.upload(token, bucket, path, processed.photo, "image/jpeg")
    storage.upload(token, bucket, thumb, processed.thumb, "image/jpeg")
    try:
        return repository.add_photo(
            token,
            {
                "p_photo_id": str(photo_id),
                "p_tenant_id": str(tenant_id),
                "p_item_id": str(item_id),
                "p_width": processed.width,
                "p_height": processed.height,
                "p_bytes": len(processed.photo),
                "p_thumb_bytes": len(processed.thumb),
            },
        )
    except RepositoryError:
        storage.remove(token, bucket, [path, thumb])
        raise


def iso(value: Any) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
