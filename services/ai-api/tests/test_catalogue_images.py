"""Job AY (ADR 0069): the server-side photo processing. An upload becomes a WhatsApp-friendly JPEG and a thumbnail and nothing of the original's metadata survives: no EXIF, no GPS location, no camera,
no comment, no colour profile. The type is decided by the BYTES, not by the header; a bomb, an animation, a non-image and an oversize file are refused before anything is stored."""

# ruff: noqa: E501

from __future__ import annotations

import io

import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from app.catalogue import images
from app.catalogue.errors import PhotoRejectedError


def png(size: tuple[int, int] = (200, 100), mode: str = "RGB", colour: tuple[int, ...] = (200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, colour).save(buffer, format="PNG", pnginfo=_pnginfo())
    return buffer.getvalue()


def _pnginfo() -> PngInfo:
    info = PngInfo()
    info.add_text("Comment", "shot at the secret warehouse 17.385,78.486")
    return info


def jpeg_with_exif(size: tuple[int, int] = (40, 20), orientation: int = 1) -> bytes:
    image = Image.new("RGB", size, (10, 120, 200))
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    exif[0x0112] = orientation
    exif[0x9003] = "2026:10:01 10:00:00"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (17.0, 23.0, 6.0), "E", (78.0, 29.0, 9.0)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif, comment=b"private note")
    return buffer.getvalue()


def open_(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def test_a_jpeg_is_stripped_of_every_piece_of_metadata() -> None:
    source = jpeg_with_exif()
    assert b"SecretCameraMaker" in source and b"private note" in source, "(the source really carries them)"
    out = images.process(source, "image/jpeg")
    for blob in (out.photo, out.thumb):
        assert b"SecretCameraMaker" not in blob and b"private note" not in blob and b"Exif" not in blob
        reread = open_(blob)
        assert reread.format == "JPEG" and dict(reread.getexif()) == {} and "icc_profile" not in reread.info and "comment" not in reread.info
        assert reread.getexif().get_ifd(0x8825) == {}, "no GPS location"


@pytest.mark.parametrize(("orientation", "expected"), [(1, (40, 20)), (6, (20, 40)), (8, (20, 40)), (3, (40, 20))])
def test_the_cameras_orientation_is_applied_to_the_pixels(orientation: int, expected: tuple[int, int]) -> None:
    out = images.process(jpeg_with_exif(orientation=orientation), "image/jpeg")
    assert (out.width, out.height) == expected
    assert open_(out.photo).size == expected


def test_a_png_comment_does_not_travel() -> None:
    out = images.process(png(), "image/png")
    assert b"secret warehouse" not in out.photo and b"secret warehouse" not in out.thumb
    assert open_(out.photo).format == "JPEG"


def test_a_large_photo_is_shrunk_to_1280_and_a_thumbnail_to_320_keeping_the_proportions() -> None:
    out = images.process(png((3000, 2000)), "image/png")
    assert (out.width, out.height) == (1280, 853)
    assert open_(out.thumb).size == (320, 213)


def test_a_small_photo_is_never_enlarged() -> None:
    out = images.process(png((300, 200)), "image/png")
    assert (out.width, out.height) == (300, 200)
    assert open_(out.thumb).size == (300, 200) or max(open_(out.thumb).size) <= 320


def test_transparency_is_flattened_onto_white() -> None:
    out = images.process(png((50, 50), "RGBA", (255, 0, 0, 0)), "image/png")
    pixel = open_(out.photo).convert("RGB").getpixel((25, 25))
    assert isinstance(pixel, tuple) and pixel[0] > 240 and pixel[1] > 240


def test_webp_is_accepted() -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), (1, 2, 3)).save(buffer, format="WEBP")
    out = images.process(buffer.getvalue(), "image/webp")
    assert open_(out.photo).format == "JPEG"


@pytest.mark.parametrize("declared", ["image/gif", "application/pdf", "text/html", "image/svg+xml"])
def test_a_type_that_is_not_accepted_is_refused_by_its_header(declared: str) -> None:
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(png(), declared)
    assert raised.value.code == "unsupported_type"


def test_a_header_that_lies_does_not_help() -> None:
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(b"<html><script>alert(1)</script></html>", "image/jpeg")
    assert raised.value.code in ("unreadable", "unsupported_type")
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buffer, format="GIF")
    with pytest.raises(PhotoRejectedError) as raised2:
        images.process(buffer.getvalue(), "image/png")
    assert raised2.value.code == "unsupported_type", "a GIF sent as a PNG is still a GIF"


def test_an_empty_or_garbage_file_is_unreadable() -> None:
    for data in (b"", b"\x89PNG\r\n\x1a\nnot really", b"\xff\xd8\xff garbage"):
        with pytest.raises(PhotoRejectedError) as raised:
            images.process(data, "image/jpeg")
        assert raised.value.code == "unreadable"


def test_over_five_megabytes_is_refused_before_it_is_decoded() -> None:
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(b"\xff\xd8" + b"0" * (images.MAX_UPLOAD_BYTES + 1), "image/jpeg")
    assert raised.value.code == "too_large"


def test_a_decompression_bomb_is_refused() -> None:
    bomb = io.BytesIO()
    Image.new("1", (9000, 9000), 0).save(bomb, format="PNG")  # tiny file, 81 megapixels
    assert len(bomb.getvalue()) < images.MAX_UPLOAD_BYTES
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(bomb.getvalue(), "image/png")
    assert raised.value.code == "too_big_pixels"


def test_an_animation_is_refused() -> None:
    buffer = io.BytesIO()
    frames = [Image.new("RGB", (32, 32), (i * 40, 0, 0)) for i in range(3)]
    frames[0].save(buffer, format="WEBP", save_all=True, append_images=frames[1:], duration=100)
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(buffer.getvalue(), "image/webp")
    assert raised.value.code == "animated"


def test_a_speck_is_refused() -> None:
    with pytest.raises(PhotoRejectedError) as raised:
        images.process(png((4, 4)), "image/png")
    assert raised.value.code == "unreadable"


def test_the_output_is_small_enough_for_the_database_limits() -> None:
    out = images.process(png((4000, 3000), "RGB", (120, 40, 200)), "image/png")
    assert len(out.photo) < images.MAX_UPLOAD_BYTES and 16 <= out.width <= 4096 and 16 <= out.height <= 4096
