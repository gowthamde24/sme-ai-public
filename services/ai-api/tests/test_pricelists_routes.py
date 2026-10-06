"""The price-list import routes with a fake data layer and the REAL pinned parser: who may use them, what a preview shows, that a commit parses again and sends only validated items with the caller's
token, replay, the closed issue codes (never a cell), and what a hostile file does."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

from app.crm.repository import ConflictError, InvalidReferenceError, InvalidValueError
from app.tenancy.repository import MfaRequired
from tests.fakes import TENANT_A, auth, make_client
from tests.pricelists_fakes import P_BLUE, P_RED, P_SET, FakePriceLists

VID = "55555555-5555-4555-8555-555555555555"
GOOD = 'sku,name,unit_price,moq,tax_bps,min_qty_1,price_1\nSYN-KJ-RED-01,"SYNTHETIC Kanjivaram silk saree, red",4200,4,500,10,4000\nSYN-KJ-BLUE-01,Blue,4200,4,500,,\nSYN-PT-SET-01,Set,"2,800.50",1,500,,\n'
CANARY = "CANARY-77c1"


class World:
    def __init__(self) -> None:
        self.p = FakePriceLists()
        self.client, _ = make_client(pricelists=self.p)

    def call(
        self, path: str, body: Any, user: str | None, tenant: uuid.UUID = TENANT_A.id, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.post(f"/v1/tenants/{tenant}{path}", json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


def preview(w: World, csv: str = GOOD, user: str = "a_owner", **kw: Any) -> Any:
    return w.call(
        "/price-lists/import/preview", {"csv": csv, "effective_from": "2026-10-06"}, user, **kw
    )


def commit(w: World, csv: str = GOOD, user: str = "a_owner", vid: str = VID, **kw: Any) -> Any:
    return w.call(
        "/price-lists/import", {"id": vid, "csv": csv, "effective_from": "2026-10-06"}, user, **kw
    )


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


BODIES = [
    ("/price-lists/import/preview", {"csv": GOOD, "effective_from": "2026-10-06"}),
    ("/price-lists/import", {"id": VID, "csv": GOOD, "effective_from": "2026-10-06"}),
]


@pytest.mark.parametrize(("path", "body"), BODIES)
def test_nobody_without_a_token_no_sales_no_viewer_and_no_outsider_reaches_the_data_layer(
    w: World, path: str, body: Any
) -> None:
    assert w.call(path, body, None).status_code == 401
    for user in ("a_sales", "a_viewer"):
        r = w.call(path, body, user)
        assert r.status_code == 403 and code(r) == "forbidden", user
    assert w.call(path, body, "outsider").status_code == 404
    assert w.call(path, body, "b_owner", TENANT_A.id).status_code == 404
    for user in ("a_owner", "a_admin"):
        for claim in ({"aal": "aal1"}, {"aal": None}, {"aal": "AAL2"}):
            r = w.call(path, body, user, **claim)
            assert r.status_code == 403 and code(r) == "mfa_required", (user, claim)
    assert w.p.tokens == [] and w.p.created == []


def test_a_preview_shows_what_the_file_would_become_and_writes_nothing(w: World) -> None:
    r = preview(w, user="a_admin")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (
        body["ok"] is True
        and body["issues"] == []
        and body["row_count"] == 3
        and len(body["canonical_hash"]) == 64
    )
    red = next(i for i in body["items"] if i["sku"] == "SYN-KJ-RED-01")
    assert red == {
        "sku": "SYN-KJ-RED-01", "name": "SYNTHETIC Kanjivaram silk saree, red", "catalog_name": "SYNTHETIC Kanjivaram silk saree, red", "name_matches": True, "sale_unit": "piece",
        "unit_price_paise": 420000, "minimum_order_quantity": 4, "tax_bps": 500, "breaks": [{"min_qty": 10, "unit_price_paise": 400000}],
    }  # fmt: skip
    blue = next(i for i in body["items"] if i["sku"] == "SYN-KJ-BLUE-01")
    assert (
        blue["name_matches"] is False
        and blue["catalog_name"] == "SYNTHETIC Kanjivaram silk saree, blue"
    )
    s = next(i for i in body["items"] if i["sku"] == "SYN-PT-SET-01")
    assert s["unit_price_paise"] == 280050 and s["sale_unit"] == "set"
    assert (
        w.p.created == []
        and set(w.p.tokens)
        and w.p.asked == [["SYN-KJ-BLUE-01", "SYN-KJ-RED-01", "SYN-PT-SET-01"]]
    )


def test_a_preview_names_a_row_a_column_and_a_closed_code_and_never_a_cell(w: World) -> None:
    bad = f"sku,name,unit_price,moq,tax_bps\n=CMD|{CANARY},Zeta Plant,100,1,500\nA-1,{CANARY} name,{CANARY},1,500\n"
    r = preview(w, bad)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False and body["items"] == [] and body["canonical_hash"] is None
    assert body["issues"] == [
        {"row": 1, "column": "sku", "code": "INVALID_SKU"},
        {"row": 2, "column": "unit_price", "code": "INVALID_MONEY"},
    ]
    assert CANARY not in r.text and "Zeta" not in r.text and "CMD" not in r.text
    assert w.p.asked == [], "a file the parser refuses never reaches the catalog"


def test_an_unknown_product_a_hidden_character_and_an_empty_list_are_issues_with_their_rows(
    w: World,
) -> None:
    csv = "sku,name,unit_price,moq,tax_bps\nSYN-KJ-RED-01,ok,100,1,500\nNOPE-1,No such product,100,1,500\nSYN-KJ-BLUE-01,Zero​width,100,1,500\nSYN-PT-SET-01,Two\nlines,100,1,500\n".replace(
        "Two\nlines", '"Two\nlines"'
    )
    body = preview(w, csv).json()
    assert body["ok"] is False and body["canonical_hash"] is None
    assert body["issues"] == [
        {"row": 2, "column": "sku", "code": "UNKNOWN_SKU"},
        {"row": 3, "column": "name", "code": "HIDDEN_CHARACTERS"},
        {"row": 4, "column": "name", "code": "HIDDEN_CHARACTERS"},
    ]
    assert [i["sku"] for i in body["items"]] == [
        "NOPE-1",
        "SYN-KJ-BLUE-01",
        "SYN-KJ-RED-01",
        "SYN-PT-SET-01",
    ], "the items are still shown for the person to see"
    empty = preview(w, "sku,name,unit_price,moq,tax_bps\n").json()
    assert empty["issues"] == [{"row": 0, "column": None, "code": "NO_ITEMS"}]


@pytest.mark.parametrize("name", ["హైదరా‌బాద్ శ్రీ‍సిల్క్", "ಮೈಸೂರು‌ ರೇಷ್ಮೆ", "कृष्ण‍ साड़ी"])
def test_indic_names_with_joiners_are_accepted(w: World, name: str) -> None:
    body = preview(w, f'sku,name,unit_price,moq,tax_bps\nSYN-KJ-RED-01,"{name}",100,1,500\n').json()
    assert body["ok"] is True and body["items"][0]["name"] == name


def test_a_file_over_a_thousand_items_is_refused_as_too_many(w: World) -> None:
    csv = "sku,name,unit_price,moq,tax_bps\n" + "".join(f"S{i},n,100,1,500\n" for i in range(1001))
    body = preview(w, csv).json()
    assert (
        body["issues"] == [{"row": 0, "column": None, "code": "TOO_MANY_ITEMS"}]
        and body["items"] == []
    )


def test_the_body_is_strict(w: World) -> None:
    for bad in (
        {"csv": GOOD},
        {"effective_from": "2026-10-06"},
        {"csv": "", "effective_from": "2026-10-06"},
        {"csv": GOOD, "effective_from": "soon"},
        {"csv": GOOD, "effective_from": "2026-10-06", "items": []},
    ):
        assert w.call("/price-lists/import/preview", bad, "a_owner").status_code == 422, bad
    assert (
        w.call(
            "/price-lists/import",
            {"id": "x", "csv": GOOD, "effective_from": "2026-10-06"},
            "a_owner",
        ).status_code
        == 422
    )
    assert (
        w.call(
            "/price-lists/import", {"csv": GOOD, "effective_from": "2026-10-06"}, "a_owner"
        ).status_code
        == 422
    )
    assert (
        w.call(
            "/price-lists/import/preview",
            {"csv": "x" * (2 * 1024 * 1024 + 1), "effective_from": "2026-10-06"},
            "a_owner",
        ).status_code
        == 422
    )


def test_a_commit_parses_again_and_sends_only_validated_items_with_the_callers_token(
    w: World,
) -> None:
    r = commit(w, user="a_admin")
    assert r.status_code == 201, r.text
    assert r.json() == {
        "version_id": VID,
        "version_no": 1,
        "effective_from": "2026-10-06",
        "item_count": 3,
        "content_sha256": "0" * 64,
        "replayed": False,
    }
    (args,) = w.p.created
    assert (
        args["p_version_id"] == VID
        and args["p_tenant_id"] == str(TENANT_A.id)
        and args["p_effective_from"] == "2026-10-06"
    )
    assert args["p_items"] == [
        {
            "product_id": str(P_BLUE),
            "sale_unit": "piece",
            "unit_price_paise": 420000,
            "minimum_order_quantity": 4,
            "tax_bps": 500,
            "breaks": [],
        },
        {
            "product_id": str(P_RED),
            "sale_unit": "piece",
            "unit_price_paise": 420000,
            "minimum_order_quantity": 4,
            "tax_bps": 500,
            "breaks": [{"min_qty": 10, "unit_price_paise": 400000}],
        },
        {
            "product_id": str(P_SET),
            "sale_unit": "set",
            "unit_price_paise": 280050,
            "minimum_order_quantity": 1,
            "tax_bps": 500,
            "breaks": [],
        },
    ]
    assert len(set(w.p.tokens)) == 1, "one caller's token for every call"


def test_a_retry_replays_with_a_200(w: World) -> None:
    assert commit(w).status_code == 201
    again = commit(w)
    assert again.status_code == 200 and again.json()["replayed"] is True


def test_a_file_with_issues_is_refused_with_them_and_nothing_is_sent(w: World) -> None:
    r = commit(w, f"sku,name,unit_price,moq,tax_bps\nNOPE-1,{CANARY},100,1,500\n")
    assert r.status_code == 422
    assert r.json() == {
        "error": {
            "code": "price_list_invalid",
            "message": "The file has problems. Nothing was saved.",
        },
        "issues": [{"row": 1, "column": "sku", "code": "UNKNOWN_SKU"}],
    }
    assert CANARY not in r.text and w.p.created == []


@pytest.mark.parametrize(
    ("error", "status", "name"),
    [
        (ConflictError("23505"), 409, "conflict"),
        (InvalidValueError("23514"), 422, "invalid_value"),
        (InvalidReferenceError("23503"), 422, "invalid_reference"),
        (MfaRequired("SM306"), 403, "mfa_required"),
    ],
)
def test_the_databases_refusals_are_fixed_answers_without_its_text(
    w: World, error: Exception, status: int, name: str
) -> None:
    w.p.raise_next = error
    r = commit(w)
    assert r.status_code == status and code(r) == name
    assert CANARY not in r.text


def test_the_price_lists_are_unavailable_without_their_repository() -> None:
    client, _ = make_client()
    for path, body in BODIES:
        r = client.post(f"/v1/tenants/{TENANT_A.id}{path}", json=body, headers=auth("a_owner"))
        assert r.status_code == 503 and r.json()["error"]["code"] == "price_lists_unavailable"


def test_the_path_in_a_log_line_is_words_not_data() -> None:
    from app.logging_safety import redact_path

    assert (
        redact_path(f"/v1/tenants/{TENANT_A.id}/price-lists/import/preview")
        == f"/v1/tenants/{TENANT_A.id}/price-lists/import/preview"
    )
    assert (
        redact_path("/v1/tenants/x/price-lists/import")
        == "/v1/tenants/<redacted>/price-lists/import"
    )
    assert json.dumps(redact_path("/v1/tenants/x/price-lists/SECRET")).count("SECRET") == 0


def test_issues_come_in_row_order_not_in_sku_order(w: World) -> None:
    csv = "sku,name,unit_price,moq,tax_bps\nZZZ-LAST,Unknown at row one,100,1,500\nAAA-FIRST,Unknown at row two,100,1,500\nSYN-KJ-RED-01,Zero\u200bwidth at row three,100,1,500\n"
    issues = preview(w, csv).json()["issues"]
    assert [(i["row"], i["code"]) for i in issues] == [
        (1, "UNKNOWN_SKU"),
        (2, "UNKNOWN_SKU"),
        (3, "HIDDEN_CHARACTERS"),
    ]
