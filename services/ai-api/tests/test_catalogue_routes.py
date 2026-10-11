"""Job AY (ADR 0069): the HTTP side of the catalogue against in-memory fakes: the role matrix of every endpoint, WHAT is sent to the database (and that an exact price is sent only when the body says
so), the closed validation, signed URLs (and a page that survives storage being down), the upload (raw body, type and size limits, the photo and its thumbnail stored, cleanup when registration is
refused), the cursor and the fixed error mapping. The database rules are pgTAP 80; the real stack is tests/integration/test_catalogue_api.py."""

# ruff: noqa: E501

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest
from PIL import Image

from app.catalogue import service
from app.catalogue.errors import NeedsPhotoError, PhotoFilesMissingError, TooManyPhotosError
from app.tenancy.repository import MfaRequired, UpstreamError
from tests.catalogue_fakes import FakeCatalogue, FakeStorage, item_row, photo_row
from tests.fakes import TENANT_A, auth, make_client

I1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
P1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
NEW = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
BASE = f"/v1/tenants/{TENANT_A.id}/catalogue"
EVERY_MEMBER = ("a_owner", "a_admin", "a_sales", "a_viewer")
OWNER_ADMIN = ("a_owner", "a_admin")


def jpeg(size: tuple[int, int] = (64, 48)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 10, 10)).save(buffer, format="JPEG")
    return buffer.getvalue()


class World:
    def __init__(self) -> None:
        self.db = FakeCatalogue()
        self.storage = FakeStorage()
        self.client, _ = make_client(catalogue=self.db, catalogue_storage=self.storage)
        self.db.items[I1] = item_row(
            I1, [photo_row(I1, P1, 1, str(TENANT_A.id)), photo_row(I1, P2, 2, str(TENANT_A.id))]
        )

    def call(
        self, method: str, path: str, user: str | None, body: Any = None, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, BASE + path, json=body, headers=headers)

    def upload(
        self,
        path: str,
        user: str | None,
        data: bytes,
        content_type: str | None = "image/jpeg",
        **claims: Any,
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        if content_type is not None:
            headers["Content-Type"] = content_type
        return self.client.post(BASE + path, content=data, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


ITEM: dict[str, Any] = {
    "name": "Green Dharmavaram",
    "fabric": "dharmavaram_silk",
    "colours": ["green", "gold"],
    "zari": "light",
    "occasions": ["festival"],
    "price_band": "10k_25k",
}
MATRIX: list[tuple[str, str, Any, tuple[str, ...]]] = [
    ("GET", "/items", None, EVERY_MEMBER),
    ("GET", f"/items/{I1}", None, EVERY_MEMBER),
    ("PUT", f"/items/{NEW}", ITEM, OWNER_ADMIN),
    ("POST", f"/photos/{P1}/remove", None, OWNER_ADMIN),
    ("PUT", f"/items/{I1}/photos/order", {"photo_ids": [P2, P1]}, OWNER_ADMIN),
]
IDS = [f"{m} {p.replace(I1, '<i>').replace(P1, '<p>').replace(NEW, '<n>')}" for m, p, *_ in MATRIX]


@pytest.mark.parametrize(("method", "path", "body", "allowed"), MATRIX, ids=IDS)
def test_the_role_matrix_of_every_endpoint(
    method: str, path: str, body: Any, allowed: tuple[str, ...]
) -> None:
    for user in EVERY_MEMBER:
        w = World()
        r = w.call(method, path, user, body)
        if user in allowed:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (
                user,
                r.status_code,
                r.text,
            )
            assert w.db.calls == [], f"{user} reached the data layer"
    w = World()
    assert w.call(method, path, "outsider", body).status_code == 404, "a stranger learns nothing"
    assert w.call(method, path, "b_owner", body).status_code == 404, (
        "another business's owner learns nothing"
    )
    assert w.call(method, path, None, body).status_code == 401
    assert w.db.calls == []


def test_the_upload_endpoint_has_the_same_roles() -> None:
    for user in EVERY_MEMBER:
        w = World()
        r = w.upload(f"/items/{I1}/photos", user, jpeg())
        assert r.status_code == (200 if user in OWNER_ADMIN else 403), (user, r.text)
    w = World()
    assert w.upload(f"/items/{I1}/photos", "outsider", jpeg()).status_code == 404
    assert w.upload(f"/items/{I1}/photos", None, jpeg()).status_code == 401
    assert w.storage.calls == [] and w.db.calls == []


# ---------------------------------------------------------------------------------------------- reading
def test_an_item_carries_words_for_every_closed_value_and_signed_urls(w: World) -> None:
    body = w.call("GET", f"/items/{I1}", "a_viewer").json()
    assert (
        body["fabric_label"] == "Kanchi pattu"
        and body["price_band_label"] == "₹25,000 to ₹50,000"
        and body["stock_label"] == "In stock"
    )
    assert body["price_paise"] is None and body["price_text"] is None, (
        "no exact price unless the Owner set one"
    )
    assert [p["position"] for p in body["photos"]] == [1, 2] and body["photo_count"] == 2
    first = body["photos"][0]
    assert first["url"].startswith("http://storage.local/object/sign/") and first[
        "thumb_url"
    ].endswith("_t.jpg?token=abc")
    assert first["expires_in_seconds"] == 600
    for forbidden in ("bucket", "path", "thumb_path"):
        assert forbidden not in first and forbidden not in body


def test_an_exact_price_is_shown_in_rupees_when_the_owner_set_one(w: World) -> None:
    w.db.items[I1]["price_paise"] = 850_000
    body = w.call("GET", f"/items/{I1}", "a_sales").json()
    assert body["price_paise"] == 850_000 and body["price_text"] == "₹8,500.00"


def test_the_list_shows_the_cover_only_and_signs_one_batch(w: World) -> None:
    body = w.call("GET", "/items", "a_viewer").json()
    (item,) = body["items"]
    assert item["cover"]["position"] == 1 and "photos" not in item and item["photo_count"] == 2
    signs = [c for c in w.storage.calls if c[0] == "sign"]
    assert len(signs) == 1 and len(signs[0][3]) == 2, "one batch: the cover's photo and thumbnail"
    assert signs[0][1] != "", "signed in the caller's name"


def test_a_page_survives_storage_being_down(w: World) -> None:
    w.storage.fail_sign = True
    r = w.call("GET", f"/items/{I1}", "a_owner")
    assert r.status_code == 200
    assert r.json()["photos"][0]["url"] is None and r.json()["photos"][0]["thumb_url"] is None


def test_the_filters_are_sent_as_the_databases_arguments(w: World) -> None:
    r = w.call(
        "GET",
        "/items?fabric=kanchi_pattu&colour=red,gold&occasion=wedding&price_band=5k_10k,10k_25k&in_stock=true&include_inactive=true&limit=5",
        "a_owner",
    )
    assert r.status_code == 200
    sent = w.db.last("catalogue_search")
    assert sent == {
        "p_fabric": "kanchi_pattu",
        "p_colours": ["red", "gold"],
        "p_occasions": ["wedding"],
        "p_price_bands": ["5k_10k", "10k_25k"],
        "p_in_stock_only": True,
        "p_include_inactive": True,
        "p_limit": 5,
        "p_after_rank": None,
        "p_after_name": None,
        "p_after_id": None,
    }


@pytest.mark.parametrize(
    "query",
    [
        "fabric=nylon",
        "colour=sparkly",
        "occasion=funeral",
        "price_band=cheap",
        "limit=0",
        "limit=51",
        "after=!!!",
    ],
)
def test_a_bad_filter_is_a_422_and_never_reaches_the_database(w: World, query: str) -> None:
    r = w.call("GET", f"/items?{query}", "a_owner")
    assert r.status_code == 422 and w.db.calls == []


def test_the_cursor_round_trips_and_a_full_page_offers_the_next(w: World) -> None:
    for n in range(2, 5):
        iid = str(uuid.UUID(int=n))
        w.db.items[iid] = item_row(
            iid, [photo_row(iid, str(uuid.UUID(int=100 + n)))], name=f"Item {n}", rank=n % 3
        )
    first = w.call("GET", "/items?limit=2", "a_owner").json()
    assert first["next_cursor"] is not None and len(first["items"]) == 2
    w.call("GET", f"/items?limit=2&after={first['next_cursor']}", "a_owner")
    sent = w.db.last("catalogue_search")
    last = w.db.items[first["items"][1]["id"]]
    assert (sent["p_after_rank"], sent["p_after_name"], sent["p_after_id"]) == (
        last["rank"],
        last["name"],
        last["id"],
    )
    assert w.call("GET", "/items?limit=50", "a_owner").json()["next_cursor"] is None, (
        "a short page is the last"
    )


def test_an_unknown_or_malformed_id_is_a_404(w: World) -> None:
    assert w.call("GET", "/items/not-a-uuid", "a_owner").status_code == 404


# ---------------------------------------------------------------------------------------------- writing
def test_saving_an_item_sends_the_whole_set_and_no_price_unless_asked(w: World) -> None:
    r = w.call("PUT", f"/items/{NEW}", "a_admin", ITEM)
    assert (
        r.status_code == 200
        and r.json()["created"] is True
        and r.json()["item"]["name"] == "Green Dharmavaram"
    )
    assert w.db.last("catalogue_item_save") == {
        "p_item_id": NEW,
        "p_tenant_id": str(TENANT_A.id),
        "p_name": "Green Dharmavaram",
        "p_fabric": "dharmavaram_silk",
        "p_colours": ["green", "gold"],
        "p_zari": "light",
        "p_border": None,
        "p_occasions": ["festival"],
        "p_price_band": "10k_25k",
        "p_stock_status": "in_stock",
        "p_active": False,
        "p_price_paise": None,
        "p_change_price": False,
    }
    again = w.call("PUT", f"/items/{NEW}", "a_admin", {**ITEM, "name": "Renamed"})
    assert again.json()["created"] is False, "the same id again is a change"


def test_the_price_field_present_means_change_it_and_absent_means_leave_it(w: World) -> None:
    w.call("PUT", f"/items/{I1}", "a_owner", {**ITEM, "price_paise": 850000})
    sent = w.db.last("catalogue_item_save")
    assert sent["p_change_price"] is True and sent["p_price_paise"] == 850000
    w.call("PUT", f"/items/{I1}", "a_owner", {**ITEM, "price_paise": None})
    sent = w.db.last("catalogue_item_save")
    assert sent["p_change_price"] is True and sent["p_price_paise"] is None, (
        "an explicit null clears it"
    )
    w.call("PUT", f"/items/{I1}", "a_owner", ITEM)
    assert w.db.last("catalogue_item_save")["p_change_price"] is False, "left out: untouched"


def test_an_admin_sending_a_price_is_refused_by_the_database_and_a_missing_second_factor_is_mfa_required(
    w: World,
) -> None:
    from app.tenancy.repository import Forbidden

    w.db.raise_next = Forbidden("42501")
    assert (
        w.call("PUT", f"/items/{I1}", "a_admin", {**ITEM, "price_paise": 100000}).status_code == 403
    )
    w.db.raise_next = MfaRequired("SM306")
    r = w.call("PUT", f"/items/{I1}", "a_owner", {**ITEM, "price_paise": 100000}, aal="aal1")
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"


@pytest.mark.parametrize(
    "change",
    [
        {"name": ""},
        {"name": "x" * 121},
        {"fabric": "nylon"},
        {"colours": []},
        {"colours": ["red", "blue", "green", "black", "white"]},
        {"colours": ["sparkly"]},
        {"occasions": ["funeral"]},
        {"price_band": "cheap"},
        {"stock_status": "plenty"},
        {"zari": "heavy"},
        {"active": "yes"},
        {"price_paise": 50},
        {"price_paise": 100_000_001},
        {"tenant_id": "x"},
        {"bucket": "cat-x"},
        {"photos": []},
    ],
)
def test_the_validation_is_closed(w: World, change: dict[str, Any]) -> None:
    r = w.call("PUT", f"/items/{NEW}", "a_owner", {**ITEM, **change})
    assert r.status_code == 422, r.text
    assert w.db.calls == []


def test_the_databases_refusals_are_fixed_sentences(w: World) -> None:
    for error, code in (
        (NeedsPhotoError("SM521"), "needs_photo"),
        (TooManyPhotosError("SM522"), "too_many_photos"),
        (PhotoFilesMissingError("SM523"), "photo_files_missing"),
    ):
        w.db.raise_next = error
        r = w.call("PUT", f"/items/{I1}", "a_owner", {**ITEM, "active": True})
        assert r.status_code == 409 and r.json()["error"]["code"] == code
        assert "SM5" not in r.text


def test_removing_a_photo_returns_the_item(w: World) -> None:
    r = w.call("POST", f"/photos/{P1}/remove", "a_owner")
    assert r.status_code == 200 and [p["id"] for p in r.json()["photos"]] == [P2]


def test_reordering_sends_the_list_and_returns_the_new_order(w: World) -> None:
    r = w.call("PUT", f"/items/{I1}/photos/order", "a_admin", {"photo_ids": [P2, P1]})
    assert [p["id"] for p in r.json()["photos"]] == [P2, P1]
    assert w.db.last("catalogue_photos_reorder")["p_photo_ids"] == [P2, P1]
    assert (
        w.call("PUT", f"/items/{I1}/photos/order", "a_owner", {"photo_ids": []}).status_code == 422
    )
    assert (
        w.call("PUT", f"/items/{I1}/photos/order", "a_owner", {"photo_ids": [P1] * 9}).status_code
        == 422
    )


def test_an_unavailable_catalogue_says_so() -> None:
    client, _ = make_client()
    assert client.get(BASE + "/items", headers=auth("a_owner")).status_code == 503


def test_a_broken_row_is_a_fixed_error(w: World) -> None:
    w.db.items[I1]["fabric"] = "mystery"
    r = w.call("GET", f"/items/{I1}", "a_owner")
    assert r.status_code >= 500 and "mystery" not in r.text


# ---------------------------------------------------------------------------------------------- upload
def test_a_photo_for_an_item_that_does_not_exist_is_refused_and_its_files_are_removed(
    w: World,
) -> None:
    r = w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", jpeg())
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_reference"
    assert w.storage.objects == {}


def test_an_upload_stores_the_photo_and_a_thumbnail_and_registers_them(w: World) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    r = w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", jpeg((3000, 2000)))
    assert r.status_code == 200, r.text
    uploads = [c for c in w.storage.calls if c[0] == "upload"]
    assert [(u[3][0], u[3][1]) for u in uploads] == [
        (f"{NEW}/{P1}.jpg", "image/jpeg"),
        (f"{NEW}/{P1}_t.jpg", "image/jpeg"),
    ]
    assert uploads[0][2] == f"cat-{TENANT_A.id}", "the business's own private bucket"
    added = w.db.last("catalogue_photo_add")
    assert (added["p_width"], added["p_height"], added["p_photo_id"], added["p_item_id"]) == (
        1280,
        853,
        P1,
        NEW,
    )
    assert "catalogue_ensure_bucket" in w.db.names()
    body = r.json()
    assert (
        body["replayed"] is False
        and body["photo"]["id"] == P1
        and body["photo"]["position"] == 1
        and body["item"]["photo_count"] == 1
    )


def test_the_stored_files_are_the_processed_ones_not_the_original(w: World) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    original = jpeg((2000, 1500))
    w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", original)
    stored = w.storage.objects[(f"cat-{TENANT_A.id}", f"{NEW}/{P1}.jpg")]
    assert stored != original and Image.open(io.BytesIO(stored)).size == (1280, 960)
    thumb = w.storage.objects[(f"cat-{TENANT_A.id}", f"{NEW}/{P1}_t.jpg")]
    assert Image.open(io.BytesIO(thumb)).size == (320, 240)


def test_a_retry_with_the_same_photo_id_replays(w: World) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    first = w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", jpeg())
    second = w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", jpeg())
    assert first.json()["replayed"] is False and second.json()["replayed"] is True
    assert second.json()["item"]["photo_count"] == 1


def test_without_a_photo_id_the_server_makes_one(w: World) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    r = w.upload(f"/items/{NEW}/photos", "a_owner", jpeg())
    assert r.status_code == 200 and uuid.UUID(r.json()["photo"]["id"])
    assert w.upload(f"/items/{NEW}/photos?photo_id=nope", "a_owner", jpeg()).status_code == 404


@pytest.mark.parametrize(
    ("content_type", "data", "status", "code"),
    [
        ("image/gif", jpeg(), 415, "photo_type_unsupported"),
        ("application/pdf", jpeg(), 415, "photo_type_unsupported"),
        (None, jpeg(), 415, "photo_type_unsupported"),
        ("image/jpeg", b"not an image at all", 422, "photo_unreadable"),
        ("image/jpeg", b"", 422, "photo_unreadable"),
        ("image/png", b"x" * (5 * 1024 * 1024 + 70000), 413, "photo_too_large"),
    ],
)
def test_a_file_that_cannot_be_used_is_refused_with_its_own_code_and_nothing_is_stored(
    w: World, content_type: str | None, data: bytes, status: int, code: str
) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    r = w.upload(f"/items/{NEW}/photos", "a_owner", data, content_type)
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    assert [
        c for c in w.storage.calls if c[0] == "upload"
    ] == [] and "catalogue_photo_add" not in w.db.names()


def test_when_registration_is_refused_the_stored_files_are_removed_again(w: World) -> None:
    w.db.items[NEW] = item_row(NEW, [])
    w.db.raise_next = None
    original = w.db.add_photo

    def refuse(token: str, args: dict[str, Any]) -> dict[str, Any]:
        raise TooManyPhotosError("SM522")

    w.db.add_photo = refuse  # type: ignore[method-assign]
    r = w.upload(f"/items/{NEW}/photos?photo_id={P1}", "a_owner", jpeg())
    assert r.status_code == 409 and r.json()["error"]["code"] == "too_many_photos"
    assert [c[3] for c in w.storage.calls if c[0] == "remove"] == [
        [f"{NEW}/{P1}.jpg", f"{NEW}/{P1}_t.jpg"]
    ]
    assert w.storage.objects == {}, "nothing is left behind"
    w.db.add_photo = original  # type: ignore[method-assign]


def test_storage_refusing_the_upload_is_a_fixed_error() -> None:
    w = World()
    w.db.items[NEW] = item_row(NEW, [])

    def broken(*a: Any, **k: Any) -> None:
        raise UpstreamError("storage said: bucket policy mentions secret-detail")

    w.storage.upload = broken  # type: ignore[method-assign]
    r = w.upload(f"/items/{NEW}/photos", "a_owner", jpeg())
    assert r.status_code >= 500 and "secret-detail" not in r.text


def test_every_call_carries_the_callers_token() -> None:
    w = World()
    w.db.items[NEW] = item_row(NEW, [])
    w.upload(f"/items/{NEW}/photos", "a_owner", jpeg())
    assert {c[1] for c in w.db.calls} == {c[1] for c in w.db.calls} and all(
        c[1] for c in w.db.calls
    )
    assert all(c[1] for c in w.storage.calls)


def test_the_cursor_helpers_round_trip_a_name_with_a_bar() -> None:
    i = uuid.UUID(int=7)
    raw = service.encode_cursor(2, "Name | with bar", i)
    assert service.decode_cursor(raw) == (2, "Name | with bar", i)
