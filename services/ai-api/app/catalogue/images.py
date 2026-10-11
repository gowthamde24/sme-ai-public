"""Server-side photo processing (job AY, ADR 0069): an upload becomes a WhatsApp-friendly JPEG and a thumbnail, and nothing else of the original survives.

* The file is decoded by Pillow, which decides the type from the BYTES (the Content-Type header is only a first filter): jpeg, png or webp, not animated, at most 5 MB and 40 megapixels (a decompression bomb is
  refused before it is decoded).
* The orientation the camera recorded is applied to the pixels; then every piece of metadata is dropped: EXIF (including the GPS location, the camera, the time), XMP, ICC profile, comments. The output
  is built from a fresh image of the pixels only, so there is nothing to forget to strip.
* Transparency is flattened onto white. The photo is at most 1280 px on its longest side (it never grows); the thumbnail at most 320 px. Both are JPEG.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.catalogue.errors import PhotoRejectedError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 40_000_000
PHOTO_SIDE = 1280
THUMB_SIDE = 320
ACCEPTED_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


@dataclass(frozen=True)
class ProcessedPhoto:
    photo: bytes
    thumb: bytes
    width: int
    height: int


def _encode(image: Image.Image, side: int, quality: int) -> tuple[bytes, tuple[int, int]]:
    out = image.copy()
    out.thumbnail((side, side), Image.Resampling.LANCZOS)  # shrinks only; keeps the proportions
    buffer = io.BytesIO()
    # a new image from the pixels: no exif, no icc profile, no comment travels (save() is given none)
    out.save(buffer, format="JPEG", quality=quality, optimize=True, progressive=False)
    return buffer.getvalue(), out.size


def process(data: bytes, declared_type: str | None) -> ProcessedPhoto:
    if len(data) > MAX_UPLOAD_BYTES:
        raise PhotoRejectedError("too_large")
    if len(data) == 0:
        raise PhotoRejectedError("unreadable")
    if (
        declared_type is not None
        and declared_type.split(";")[0].strip().lower() not in ACCEPTED_TYPES
    ):
        raise PhotoRejectedError("unsupported_type")
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in _FORMATS:
                raise PhotoRejectedError("unsupported_type")
            if getattr(probe, "is_animated", False) or getattr(probe, "n_frames", 1) > 1:
                raise PhotoRejectedError("animated")
            width, height = probe.size
            if width * height > MAX_PIXELS:
                raise PhotoRejectedError("too_big_pixels")
            probe.load()
            oriented = ImageOps.exif_transpose(probe)
            pixels = (
                oriented.convert("RGBA")
                if oriented.mode in ("RGBA", "LA", "P")
                else oriented.convert("RGB")
            )
            if pixels.mode == "RGBA":
                flat = Image.new("RGB", pixels.size, (255, 255, 255))
                flat.paste(pixels, mask=pixels.getchannel("A"))
                pixels = flat
            clean = Image.new("RGB", pixels.size)
            clean.paste(pixels)
    except PhotoRejectedError:
        raise
    except Image.DecompressionBombError:
        raise PhotoRejectedError("too_big_pixels") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError):
        raise PhotoRejectedError("unreadable") from None
    if min(clean.size) < 16:
        raise PhotoRejectedError("unreadable")
    photo, size = _encode(clean, PHOTO_SIDE, 85)
    thumb, _ = _encode(clean, THUMB_SIDE, 80)
    return ProcessedPhoto(photo=photo, thumb=thumb, width=size[0], height=size[1])
