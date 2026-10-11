"""The catalogue's dedicated refusals (job AY, ADR 0069). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class NeedsPhotoError(RepositoryError):
    """SM521: an active item needs a photo (also: the last photo of an active item cannot be removed)."""


class TooManyPhotosError(RepositoryError):
    """SM522: an item has eight photos already."""


class PhotoFilesMissingError(RepositoryError):
    """SM523: the photo's files are not in storage (the upload did not finish)."""


class PhotoRejectedError(Exception):
    """An uploaded file that cannot be used. `code` is one of: too_large, unsupported_type, unreadable, too_big_pixels, animated."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
