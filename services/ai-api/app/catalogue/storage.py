"""The catalogue's door to Supabase Storage (the LOCAL service; no new account). Every call carries the CALLER's JWT and the public key, so the storage rules decide (a member of the business reads its
private bucket; Owner and Admin add and remove files there): there is no service key. Failures are classified by status only; the service's text is never returned or logged.

A file is reached only through a SIGNED URL that expires in minutes (SIGNED_URL_SECONDS); the bucket itself is private."""

from __future__ import annotations

import logging
import urllib.parse
from typing import Protocol

import httpx

from app.tenancy.repository import UpstreamError

logger = logging.getLogger("app.catalogue.storage")

SIGNED_URL_SECONDS = 600


class StorageClient(Protocol):
    def upload(
        self, token: str, bucket: str, path: str, data: bytes, content_type: str
    ) -> None: ...
    def sign(self, token: str, bucket: str, paths: list[str]) -> dict[str, str]: ...
    def remove(self, token: str, bucket: str, paths: list[str]) -> None: ...


class HttpStorageClient:
    def __init__(
        self,
        storage_url: str,
        anon_key: str,
        *,
        public_url: str | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        # storage_url: the service's own address (…/storage/v1); public_url: the address a BROWSER reaches it at, put in front of a signed path (defaults to the same)
        self._base = storage_url.rstrip("/")
        self._public = (public_url or storage_url).rstrip("/")
        self._anon_key = anon_key
        self._client = client or httpx.Client(timeout=httpx.Timeout(20.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    def _headers(self, token: str, **extra: str) -> dict[str, str]:
        return {"apikey": self._anon_key, "Authorization": f"Bearer {token}", **extra}

    @staticmethod
    def _quote(path: str) -> str:
        return urllib.parse.quote(path, safe="/")

    def upload(self, token: str, bucket: str, path: str, data: bytes, content_type: str) -> None:
        try:
            response = self._client.post(
                f"{self._base}/object/{bucket}/{self._quote(path)}",
                content=data,
                headers=self._headers(
                    token,
                    **{
                        "Content-Type": content_type,
                        "x-upsert": "false",
                        "Cache-Control": "max-age=3600",
                    },
                ),
            )
        except httpx.HTTPError as exc:
            logger.error("storage unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("storage unreachable") from None
        if response.is_success:
            return
        if response.status_code == 409 or _duplicate(response):
            return  # the same file again (a retry): the database check that follows decides
        logger.error("storage refused an upload: http=%s", response.status_code)
        raise UpstreamError("storage refused the upload")

    def sign(self, token: str, bucket: str, paths: list[str]) -> dict[str, str]:
        """path -> an absolute signed URL that works for SIGNED_URL_SECONDS. A path storage could not sign is left out."""
        if not paths:
            return {}
        try:
            response = self._client.post(
                f"{self._base}/object/sign/{bucket}",
                json={"expiresIn": SIGNED_URL_SECONDS, "paths": paths},
                headers=self._headers(token),
            )
        except httpx.HTTPError as exc:
            logger.error("storage unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("storage unreachable") from None
        if not response.is_success:
            logger.error("storage refused to sign: http=%s", response.status_code)
            raise UpstreamError("storage refused to sign")
        try:
            rows = response.json()
        except ValueError:
            raise UpstreamError("storage returned a non-JSON body") from None
        out: dict[str, str] = {}
        for row in rows if isinstance(rows, list) else []:
            if (
                isinstance(row, dict)
                and row.get("signedURL")
                and isinstance(row.get("path"), str)
                and not row.get("error")
            ):
                out[row["path"]] = f"{self._public}{row['signedURL']}"
        return out

    def remove(self, token: str, bucket: str, paths: list[str]) -> None:
        """Best effort: used to clean up files of an upload that did not complete."""
        if not paths:
            return
        try:
            self._client.request(
                "DELETE",
                f"{self._base}/object/{bucket}",
                json={"prefixes": paths},
                headers=self._headers(token),
            )
        except httpx.HTTPError as exc:
            logger.warning("storage cleanup failed: %s", exc.__class__.__name__)


def _duplicate(response: httpx.Response) -> bool:
    try:
        body = response.json()
    except ValueError:
        return False
    return isinstance(body, dict) and str(body.get("statusCode")) == "409"
