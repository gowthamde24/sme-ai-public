"""An in-memory PriceListRepository for the route tests. The real rules are the database's and the real-stack tests' (tests/integration/test_price_list_import_api.py); this fake holds the
catalog the service reads and records what the service writes, so the tests can check WHAT was sent to the database and with whose token."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.pricelists.repository import Product

P_RED = uuid.UUID(int=0xA001)
P_BLUE = uuid.UUID(int=0xA002)
P_SET = uuid.UUID(int=0xA003)
CATALOG: dict[str, Product] = {
    "SYN-KJ-RED-01": Product(
        P_RED, "SYN-KJ-RED-01", "SYNTHETIC Kanjivaram silk saree, red", "piece"
    ),
    "SYN-KJ-BLUE-01": Product(
        P_BLUE, "SYN-KJ-BLUE-01", "SYNTHETIC Kanjivaram silk saree, blue", "piece"
    ),
    "SYN-PT-SET-01": Product(
        P_SET, "SYN-PT-SET-01", "SYNTHETIC Paithani silk saree, set of 3", "set"
    ),
}


class FakePriceLists:
    def __init__(self) -> None:
        self.tokens: list[str] = []
        self.asked: list[list[str]] = []
        self.created: list[dict[str, Any]] = []
        self.raise_next: Exception | None = None
        self.versions: dict[str, dict[str, Any]] = {}

    def products_by_sku(
        self, token: str, tenant_id: uuid.UUID, skus: list[str]
    ) -> dict[str, Product]:
        self.tokens.append(token)
        self.asked.append(list(skus))
        return {s: CATALOG[s] for s in skus if s in CATALOG}

    def create_version(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self.tokens.append(token)
        self.created.append(args)
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error
        replayed = args["p_version_id"] in self.versions
        self.versions.setdefault(args["p_version_id"], args)
        return {
            "version_id": args["p_version_id"],
            "version_no": 1,
            "effective_from": args["p_effective_from"],
            "item_count": len(args["p_items"]),
            "content_sha256": "0" * 64,
            "replayed": replayed,
        }
