"""In-memory CatalogueRepository and StorageClient for the HTTP tests (job AY). They record every call with the caller's token and answer from what the test planted; they decide NOTHING (the photo limit,
the roles, the exact price and the search are the database's, tested in pgTAP 80 and tests/integration/test_catalogue_api.py)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

T1 = "2026-10-10T10:00:00+00:00"
BUCKET_PREFIX = "cat-"


def photo_row(item_id: str, photo_id: str, position: int = 1, tenant: str = "t") -> dict[str, Any]:
    return {
        "id": photo_id,
        "position": position,
        "bucket": f"{BUCKET_PREFIX}{tenant}",
        "path": f"{item_id}/{photo_id}.jpg",
        "thumb_path": f"{item_id}/{photo_id}_t.jpg",
        "width": 640,
        "height": 800,
        "bytes": 120_000,
    }


def item_row(
    item_id: str, photos: list[dict[str, Any]] | None = None, **over: Any
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": item_id,
        "name": "Maroon Kanchi pattu",
        "fabric": "kanchi_pattu",
        "colours": ["maroon"],
        "zari": "rich",
        "border": "Contrast border",
        "occasions": ["wedding"],
        "price_band": "25k_50k",
        "price_paise": None,
        "stock_status": "in_stock",
        "active": True,
        "created_at": T1,
        "updated_at": T1,
        "photos": photos if photos is not None else [],
        "rank": 0,
    }
    row.update(over)
    return row


class FakeCatalogue:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.items: dict[str, dict[str, Any]] = {}
        self.raise_next: Exception | None = None

    def _log(self, name: str, token: str, args: dict[str, Any]) -> None:
        self.calls.append((name, token, args))
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def last(self, name: str) -> dict[str, Any]:
        return [c for c in self.calls if c[0] == name][-1][2]

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        self._log("catalogue_ensure_bucket", token, {"p_tenant_id": str(tenant_id)})
        return f"{BUCKET_PREFIX}{tenant_id}"

    def save_item(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("catalogue_item_save", token, args)
        created = args["p_item_id"] not in self.items
        old = self.items.get(args["p_item_id"], {})
        self.items[args["p_item_id"]] = item_row(
            args["p_item_id"],
            old.get("photos", []),
            name=args["p_name"],
            fabric=args["p_fabric"],
            colours=args["p_colours"],
            zari=args["p_zari"],
            border=args["p_border"],
            occasions=args["p_occasions"],
            price_band=args["p_price_band"],
            stock_status=args["p_stock_status"],
            active=args["p_active"],
            price_paise=args["p_price_paise"] if args["p_change_price"] else old.get("price_paise"),
        )
        return {"id": args["p_item_id"], "active": args["p_active"], "created": created}

    def add_photo(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("catalogue_photo_add", token, args)
        if args["p_item_id"] not in self.items:
            from app.crm.repository import InvalidReferenceError

            raise InvalidReferenceError("23503")
        item = self.items[args["p_item_id"]]
        existing = next((p for p in item["photos"] if p["id"] == args["p_photo_id"]), None)
        if existing is not None:
            return {"id": existing["id"], "position": existing["position"], "replayed": True}
        photo = photo_row(
            args["p_item_id"], args["p_photo_id"], len(item["photos"]) + 1, str(args["p_tenant_id"])
        )
        photo.update(width=args["p_width"], height=args["p_height"], bytes=args["p_bytes"])
        item["photos"].append(photo)
        return {"id": photo["id"], "position": photo["position"], "replayed": False}

    def remove_photo(self, token: str, tenant_id: uuid.UUID, photo_id: uuid.UUID) -> dict[str, Any]:
        self._log(
            "catalogue_photo_remove",
            token,
            {"p_tenant_id": str(tenant_id), "p_photo_id": str(photo_id)},
        )
        for item in self.items.values():
            for p in item["photos"]:
                if p["id"] == str(photo_id):
                    item["photos"].remove(p)
                    return {"id": str(photo_id), "item_id": item["id"], "replayed": False}
        raise KeyError(photo_id)

    def reorder(
        self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, photo_ids: list[uuid.UUID]
    ) -> dict[str, Any]:
        self._log(
            "catalogue_photos_reorder",
            token,
            {"p_item_id": str(item_id), "p_photo_ids": [str(p) for p in photo_ids]},
        )
        item = self.items[str(item_id)]
        by_id = {p["id"]: p for p in item["photos"]}
        item["photos"] = [dict(by_id[str(pid)], position=n) for n, pid in enumerate(photo_ids, 1)]
        return {"item_id": str(item_id)}

    def get_item(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]:
        self._log("catalogue_get", token, {"p_item_id": str(item_id)})
        if str(item_id) not in self.items:
            from app.crm.repository import InvalidReferenceError

            raise InvalidReferenceError("23503")
        return dict(self.items[str(item_id)])

    def search(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> list[dict[str, Any]]:
        self._log("catalogue_search", token, args)
        rows = [r for r in self.items.values() if r["active"] or args["p_include_inactive"]]
        return [dict(r) for r in rows[: args["p_limit"]]]


class FakeStorage:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str, Any]] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.fail_sign = False
        self.expires: list[int] = []

    def upload(self, token: str, bucket: str, path: str, data: bytes, content_type: str) -> None:
        self.calls.append(("upload", token, bucket, (path, content_type, len(data))))
        self.objects[(bucket, path)] = data

    def sign(self, token: str, bucket: str, paths: list[str], expires: int = 600) -> dict[str, str]:
        self.calls.append(("sign", token, bucket, list(paths)))
        self.expires.append(expires)
        if self.fail_sign:
            from app.tenancy.repository import UpstreamError

            raise UpstreamError("storage down")
        return {p: f"http://storage.local/object/sign/{bucket}/{p}?token=abc" for p in paths}

    def remove(self, token: str, bucket: str, paths: list[str]) -> None:
        self.calls.append(("remove", token, bucket, list(paths)))
        for p in paths:
            self.objects.pop((bucket, p), None)
