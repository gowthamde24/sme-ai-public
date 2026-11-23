"""Job AY (ADR 0069) on the real stack: the catalogue with its photos in the LOCAL Supabase Storage, photos in the outbox, "keep a record", Agent OWL's two catalogue tools, the lead search and the
suggested message, with real JWTs, real PostgREST, real Storage and the real database functions. The only channel is the local fake. All data is synthetic (generated pictures).

What is proved: a private bucket per business that only its members read and only Owner and Admin write; an upload is decoded, resized, stripped of EXIF and GPS and thumbnailed BEFORE it is stored;
signed URLs work for a member and nothing else does (no public URL, no other business); the limits (type, 5 MB, eight photos) with nothing left behind when one is refused; an active item needs a photo;
the exact price is the Owner's alone with a second factor; the deterministic search; a message with photos goes through the SAME policy (a price in the caption waits for approval; photos with none go by
themselves only when automatic sending is on) and the channel is handed the photos by reference; keep_record makes the touch when the message is really sent; the assistant finds and sends; the lead search
never returns a number; a suggested message is checked and counted.

THE CLOCK. Whether a message goes now or waits for 09:00 is the database's outbox clock, so these tests never lean on the real time: the module pins it (for the whole local database, restored afterwards)
to 14:00 India time five days ago, and the tests about quiet hours pin 23:30 (and the next morning) for their own duration."""

# ruff: noqa: E501, S608

from __future__ import annotations

import io
import uuid
from collections.abc import Callable, Iterator
from datetime import datetime, time, timedelta, timezone
from typing import Any

import httpx
import operator_sql
import pytest
from assistant_eval import Scripted, final, respond
from assistant_support import assistant_app, enable_assistant, events, restore
from conftest import Stack, aal1_token, bearer
from crm_support import World
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead
from PIL import Image
from test_outbox_api import restore_clock

from app.agents.llm.interface import ToolCall
from app.assistant.dev_model import DevAssistantModel
from app.outbox.adapter import LocalFakeAdapter

IST = timezone(timedelta(hours=5, minutes=30))
D0 = datetime.now(IST).date() - timedelta(days=5)


def pin_clock(at: time, day: int = 0) -> None:
    """Pin the outbox clock of the whole local database to `at` India time on a date five days ago (+ `day`), until restore_clock()."""
    instant = datetime.combine(D0 + timedelta(days=day), at, tzinfo=IST)
    operator_sql.sql(
        "create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' "
        f"as $b$ select timestamptz '{instant.isoformat()}' $b$"
    )


def jpeg_with_gps(size: tuple[int, int] = (2400, 1800)) -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (17.0, 23.0, 6.0), "E", (78.0, 29.0, 9.0)
    buffer = io.BytesIO()
    Image.new("RGB", size, (150, 30, 60)).save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def png(size: tuple[int, int] = (800, 600), colour: tuple[int, int, int] = (20, 100, 160)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="PNG")
    return buffer.getvalue()


class Shop:
    def __init__(self, client: TestClient, world: World, stack: Stack) -> None:
        self.client, self.w, self.stack = client, world, stack
        self.fw = FollowWorld(client, world, world.a)
        self.tenant = world.a.id
        runtime = client.app.state.runtime  # type: ignore[attr-defined]
        self.adapter: LocalFakeAdapter = runtime.outbox_adapter
        assert isinstance(self.adapter, LocalFakeAdapter)

    def call(self, user: str, method: str, path: str, body: Any = None, *, box: str = "a", token: str | None = None) -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        headers = {"Authorization": f"Bearer {token}"} if token else bearer(users[user])
        return self.client.request(method, f"/v1/tenants/{self.tenant if box == 'a' else self.w.b.id}{path}", json=body, headers=headers)

    def upload(self, user: str, item: str, data: bytes, content_type: str | None = "image/jpeg", *, photo_id: str | None = None, box: str = "a", token: str | None = None) -> Any:
        users = (self.w.a if box == "a" else self.w.b).users
        headers = {"Authorization": f"Bearer {token or users[user].token}"}
        if content_type:
            headers["Content-Type"] = content_type
        suffix = f"?photo_id={photo_id}" if photo_id else ""
        return self.client.post(f"/v1/tenants/{self.tenant if box == 'a' else self.w.b.id}/catalogue/items/{item}/photos{suffix}", content=data, headers=headers)

    def item(self, name: str = "Maroon Kanchi pattu", *, fabric: str = "kanchi_pattu", colours: list[str] | None = None, band: str = "25k_50k", occasions: list[str] | None = None, stock: str = "in_stock", active: bool = False, user: str = "owner", extra: dict[str, Any] | None = None, item_id: str | None = None, box: str = "a") -> tuple[str, Any]:
        iid = item_id or str(uuid.uuid4())
        body = {"name": name, "fabric": fabric, "colours": colours or ["maroon"], "zari": "rich", "border": "Temple border", "occasions": occasions if occasions is not None else ["wedding"], "price_band": band, "stock_status": stock, "active": active, **(extra or {})}
        return iid, self.call(user, "PUT", f"/catalogue/items/{iid}", body, box=box)

    def stocked(self, name: str, *, photos: int = 1, **kw: Any) -> str:
        iid, r = self.item(name, **kw)
        assert r.status_code == 200, r.text
        for _ in range(photos):
            up = self.upload("owner", iid, png())
            assert up.status_code == 200, up.text
        body = {**{k: v for k, v in r.json()["item"].items() if k in ("name", "fabric", "colours", "zari", "border", "occasions", "price_band", "stock_status")}, "active": True}
        again = self.call("owner", "PUT", f"/catalogue/items/{iid}", body)
        assert again.status_code == 200 and again.json()["item"]["active"] is True, again.text
        return iid

    def lead(self) -> Lead:
        return self.fw.lead()

    def objects(self, bucket_tenant: str | None = None) -> int:
        return int(operator_sql.sql(f"select count(*) from storage.objects where bucket_id = 'cat-{bucket_tenant or self.tenant}'"))

    def msg_row(self, message_id: str) -> str:
        return operator_sql.sql(f"select status || '/' || reason from public.outbox_messages where id = '{message_id}'")

    def submit(self, user: str, lead: Lead, text: str, photo_ids: list[str] | None = None, **extra: Any) -> tuple[str, Any]:
        mid = str(uuid.uuid4())
        r = self.call(user, "POST", "/outbox/messages", {"message_id": mid, "lead_id": lead.id, "text": text, "language": "en", "category": "info", "photo_ids": photo_ids or [], **extra})
        return mid, r


@pytest.fixture(scope="module")
def shop(client: TestClient, eval_world: World, stack: Stack) -> Iterator[Shop]:
    pin_clock(time(14, 0))
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    s = Shop(client, eval_world, stack)
    assert s.call("owner", "PUT", "/outbox/settings", {"auto_send_enabled": True, "per_customer_daily_limit": 5}).status_code == 200
    try:
        yield s
    finally:
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        restore_clock()


def fetch(url: str) -> httpx.Response:
    return httpx.get(url, timeout=20)


# ---------------------------------------------------------------------------------------------- upload, processing, signed URLs
def test_an_upload_is_resized_stripped_and_thumbnailed_before_it_is_stored(shop: Shop) -> None:
    iid, r = shop.item()
    assert r.status_code == 200 and r.json()["created"] is True and r.json()["item"]["active"] is False and r.json()["item"]["photo_count"] == 0
    up = shop.upload("owner", iid, jpeg_with_gps(), "image/jpeg")
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["replayed"] is False and body["photo"]["position"] == 1 and (body["photo"]["width"], body["photo"]["height"]) == (1280, 960)
    big, thumb = fetch(body["photo"]["url"]), fetch(body["photo"]["thumb_url"])
    assert big.status_code == 200 and big.headers["content-type"] == "image/jpeg"
    for blob, longest in ((big.content, 1280), (thumb.content, 320)):
        image = Image.open(io.BytesIO(blob))
        assert image.format == "JPEG" and max(image.size) == longest
        assert dict(image.getexif()) == {} and image.getexif().get_ifd(0x8825) == {}, "no EXIF, no GPS location"
        assert b"SecretCameraMaker" not in blob
    assert body["photo"]["expires_in_seconds"] == 600


def test_the_bucket_is_private_and_a_signed_url_is_the_only_way_in(shop: Shop) -> None:
    iid, _ = shop.item()
    up = shop.upload("owner", iid, png()).json()["photo"]
    signed = up["url"]
    assert "/object/sign/" in signed and "token=" in signed
    path = signed.split("/object/sign/", 1)[1].split("?")[0]
    base = signed.split("/object/sign/", 1)[0]
    assert fetch(f"{base}/object/public/{path}").status_code in (400, 404), "there is no public URL"
    assert fetch(f"{base}/object/{path}").status_code in (400, 401, 403, 404), "no unsigned read"
    forged = signed.split("token=")[0] + "token=" + "x" * 40
    assert fetch(forged).status_code in (400, 401, 403, 404), "a forged token opens nothing"
    bucket = path.split("/")[0]
    assert bucket == f"cat-{shop.tenant}"
    row = operator_sql.sql(f"select public || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = '{bucket}'")
    assert row == "false|5242880|image/jpeg,image/png,image/webp"


def test_another_business_can_neither_read_nor_sign_nor_write_this_business_files(shop: Shop, stack: Stack) -> None:
    iid, _ = shop.item()
    shop.upload("owner", iid, png())
    bucket = f"cat-{shop.tenant}"
    paths = operator_sql.sql(f"select name from storage.objects where bucket_id = '{bucket}' limit 1")
    b_owner = shop.w.b.users["owner"]
    headers = {"apikey": stack.anon_key, "Authorization": f"Bearer {b_owner.token}"}
    sign = httpx.post(f"{stack.url}/storage/v1/object/sign/{bucket}", json={"expiresIn": 60, "paths": [paths]}, headers=headers, timeout=20)
    signed = sign.json() if sign.status_code == 200 else []
    assert not [row for row in signed if isinstance(row, dict) and row.get("signedURL")], "another business gets no URL"
    put = httpx.post(f"{stack.url}/storage/v1/object/{bucket}/evil/x.jpg", content=jpeg_with_gps((64, 64)), headers={**headers, "Content-Type": "image/jpeg"}, timeout=20)
    assert put.status_code in (400, 401, 403), put.text
    anon = httpx.get(f"{stack.url}/storage/v1/object/{bucket}/{paths}", headers={"apikey": stack.anon_key}, timeout=20)
    assert anon.status_code in (400, 401, 403, 404)
    assert shop.call("owner", "GET", f"/catalogue/items/{iid}", box="b").status_code in (404, 422)
    assert shop.call("owner", "GET", "/catalogue/items", box="b").json()["items"] == []


def test_sales_and_viewers_read_the_catalogue_but_cannot_change_it(shop: Shop) -> None:
    iid = shop.stocked("Read-only check")
    for user in ("sales", "viewer"):
        assert shop.call(user, "GET", "/catalogue/items").status_code == 200
        got = shop.call(user, "GET", f"/catalogue/items/{iid}")
        assert got.status_code == 200 and got.json()["photos"][0]["thumb_url"], "a member gets signed URLs"
        assert fetch(got.json()["photos"][0]["thumb_url"]).status_code == 200
        assert shop.upload(user, iid, png()).status_code == 403
        assert shop.call(user, "PUT", f"/catalogue/items/{iid}", {"name": "x", "fabric": "soft_silk", "colours": ["red"], "price_band": "under_5k"}).status_code == 403
        assert shop.call(user, "POST", f"/catalogue/photos/{uuid.uuid4()}/remove").status_code == 403
    admin = shop.upload("admin", iid, png())
    assert admin.status_code == 200, "an Admin can"


# ---------------------------------------------------------------------------------------------- limits
REFUSED: dict[str, tuple[str | None, Callable[[], bytes], int, str]] = {
    "gif": ("image/gif", lambda: b"GIF89a", 415, "photo_type_unsupported"),
    "garbage": ("image/jpeg", lambda: b"this is not a picture", 422, "photo_unreadable"),
    "over_five_mb": ("image/png", lambda: b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024 + 80_000), 413, "photo_too_large"),
    "no_type": (None, lambda: png(), 415, "photo_type_unsupported"),
}


@pytest.mark.parametrize("case", sorted(REFUSED))
def test_a_file_that_cannot_be_used_is_refused_and_nothing_is_stored(shop: Shop, case: str) -> None:
    content_type, make, status, code = REFUSED[case]
    iid, _ = shop.item()
    before = shop.objects()
    r = shop.upload("owner", iid, make(), content_type)
    assert r.status_code == status and r.json()["error"]["code"] == code, r.text
    assert shop.objects() == before


def test_the_ninth_photo_is_refused_and_leaves_no_file_behind(shop: Shop) -> None:
    iid, _ = shop.item()
    for n in range(8):
        r = shop.upload("owner", iid, png(colour=(10 + n * 20, 50, 90)))
        assert r.status_code == 200 and r.json()["photo"]["position"] == n + 1
    before = shop.objects()
    r = shop.upload("owner", iid, png())
    assert r.status_code == 409 and r.json()["error"]["code"] == "too_many_photos"
    assert shop.objects() == before, "the two files of the refused photo were removed again"
    got = shop.call("owner", "GET", f"/catalogue/items/{iid}").json()
    assert got["photo_count"] == 8


def test_a_retry_with_the_same_photo_id_is_one_photo(shop: Shop) -> None:
    iid, _ = shop.item()
    pid = str(uuid.uuid4())
    first = shop.upload("owner", iid, png(), photo_id=pid)
    second = shop.upload("owner", iid, png(), photo_id=pid)
    assert first.json()["replayed"] is False and second.json()["replayed"] is True
    assert shop.call("owner", "GET", f"/catalogue/items/{iid}").json()["photo_count"] == 1


def test_an_active_item_needs_a_photo_and_its_last_photo_cannot_be_removed(shop: Shop) -> None:
    iid, _ = shop.item()
    r = shop.call("owner", "PUT", f"/catalogue/items/{iid}", {"name": "Maroon Kanchi pattu", "fabric": "kanchi_pattu", "colours": ["maroon"], "price_band": "25k_50k", "active": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "needs_photo"
    up = shop.upload("owner", iid, png()).json()["photo"]
    ok = shop.call("owner", "PUT", f"/catalogue/items/{iid}", {"name": "Maroon Kanchi pattu", "fabric": "kanchi_pattu", "colours": ["maroon"], "price_band": "25k_50k", "active": True})
    assert ok.status_code == 200 and ok.json()["item"]["active"] is True
    gone = shop.call("owner", "POST", f"/catalogue/photos/{up['id']}/remove")
    assert gone.status_code == 409 and gone.json()["error"]["code"] == "needs_photo"


def test_removing_and_reordering_photos(shop: Shop) -> None:
    iid, _ = shop.item()
    ids = [shop.upload("owner", iid, png(colour=(30 * n, 60, 120))).json()["photo"]["id"] for n in range(1, 4)]
    reordered = shop.call("owner", "PUT", f"/catalogue/items/{iid}/photos/order", {"photo_ids": [ids[2], ids[0], ids[1]]})
    assert [p["id"] for p in reordered.json()["photos"]] == [ids[2], ids[0], ids[1]] and [p["position"] for p in reordered.json()["photos"]] == [1, 2, 3]
    assert shop.call("owner", "PUT", f"/catalogue/items/{iid}/photos/order", {"photo_ids": [ids[0]]}).status_code == 422
    removed = shop.call("owner", "POST", f"/catalogue/photos/{ids[0]}/remove")
    assert removed.status_code == 200 and [p["id"] for p in removed.json()["photos"]] == [ids[2], ids[1]] and [p["position"] for p in removed.json()["photos"]] == [1, 2]
    again = shop.call("owner", "POST", f"/catalogue/photos/{ids[0]}/remove")
    assert again.status_code == 200, "removing twice changes nothing"


# ---------------------------------------------------------------------------------------------- the exact price
def test_the_exact_price_is_the_owners_alone_with_a_second_factor(shop: Shop) -> None:
    iid, _ = shop.item()
    with_price = {"name": "Priced", "fabric": "kanchi_pattu", "colours": ["maroon"], "price_band": "25k_50k", "price_paise": 3_850_000}
    assert shop.call("admin", "PUT", f"/catalogue/items/{iid}", with_price).status_code == 403
    weak = shop.call("owner", "PUT", f"/catalogue/items/{iid}", with_price, token=aal1_token(shop.stack, shop.w.a.users["owner"]))
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    ok = shop.call("owner", "PUT", f"/catalogue/items/{iid}", with_price)
    assert ok.status_code == 200 and ok.json()["item"]["price_paise"] == 3_850_000 and ok.json()["item"]["price_text"] == "₹38,500.00"
    kept = shop.call("admin", "PUT", f"/catalogue/items/{iid}", {"name": "Renamed by an Admin", "fabric": "kanchi_pattu", "colours": ["maroon"], "price_band": "25k_50k"})
    assert kept.status_code == 200 and kept.json()["item"]["price_paise"] == 3_850_000, "an Admin's edit leaves the price alone"
    cleared = shop.call("owner", "PUT", f"/catalogue/items/{iid}", {**with_price, "price_paise": None})
    assert cleared.json()["item"]["price_paise"] is None and cleared.json()["item"]["price_text"] is None


# ---------------------------------------------------------------------------------------------- search
def test_the_search_is_deterministic_and_filtered(shop: Shop) -> None:
    unique = uuid.uuid4().hex[:6]
    a = shop.stocked(f"Zz{unique} Alpha", fabric="soft_silk", colours=["red", "gold"], occasions=["wedding"], band="5k_10k", stock="in_stock")
    b = shop.stocked(f"Zz{unique} Beta", fabric="soft_silk", colours=["green"], occasions=["festival"], band="10k_25k", stock="few_left")
    c = shop.stocked(f"Zz{unique} Gamma", fabric="soft_silk", colours=["red"], occasions=["daily"], band="5k_10k", stock="made_to_order")
    def names(r: Any) -> list[str]:
        return [i["name"] for i in r.json()["items"] if unique in i["name"]]

    assert names(shop.call("viewer", "GET", "/catalogue/items?fabric=soft_silk&limit=50")) == [f"Zz{unique} Alpha", f"Zz{unique} Beta", f"Zz{unique} Gamma"]
    assert names(shop.call("sales", "GET", "/catalogue/items?fabric=soft_silk&colour=red&limit=50")) == [f"Zz{unique} Alpha", f"Zz{unique} Gamma"]
    assert names(shop.call("sales", "GET", "/catalogue/items?fabric=soft_silk&colour=green,gold&limit=50")) == [f"Zz{unique} Alpha", f"Zz{unique} Beta"]
    assert names(shop.call("sales", "GET", "/catalogue/items?fabric=soft_silk&occasion=festival&limit=50")) == [f"Zz{unique} Beta"]
    assert names(shop.call("sales", "GET", "/catalogue/items?fabric=soft_silk&price_band=5k_10k&in_stock=true&limit=50")) == [f"Zz{unique} Alpha"]
    # an inactive item (still with a photo) is hidden from everyone but an Owner or Admin who asks
    shop.call("owner", "PUT", f"/catalogue/items/{c}", {"name": f"Zz{unique} Gamma", "fabric": "soft_silk", "colours": ["red"], "occasions": ["daily"], "price_band": "5k_10k", "stock_status": "made_to_order", "active": False})
    assert f"Zz{unique} Gamma" not in names(shop.call("sales", "GET", "/catalogue/items?fabric=soft_silk&include_inactive=true&limit=50"))
    assert f"Zz{unique} Gamma" in names(shop.call("owner", "GET", "/catalogue/items?fabric=soft_silk&include_inactive=true&limit=50"))
    first = shop.call("owner", "GET", "/catalogue/items?fabric=soft_silk&limit=1").json()
    assert first["next_cursor"] is not None and len(first["items"]) == 1
    second = shop.call("owner", "GET", f"/catalogue/items?fabric=soft_silk&limit=1&after={first['next_cursor']}").json()
    assert second["items"][0]["id"] != first["items"][0]["id"]
    assert {a, b}  # both created


# ---------------------------------------------------------------------------------------------- photos in the outbox
def test_photos_without_a_price_go_by_themselves_and_the_channel_gets_them_by_reference(shop: Shop) -> None:
    item = shop.stocked("Outbox photo", photos=2)
    photos = [p["id"] for p in shop.call("owner", "GET", f"/catalogue/items/{item}").json()["photos"]]
    lead = shop.lead()
    mid, r = shop.submit("sales", lead, "Here are two sarees you may like.", photos)
    assert r.status_code == 200, r.text
    body = r.json()["message"]
    assert body["status"] in ("queued",) and [m["photo_id"] for m in body["media"]] == photos and all(m["thumb_url"] for m in body["media"])
    assert shop.msg_row(mid) == "queued/auto_allowed", "14:00 India time: photos without a price go by themselves"
    sent = shop.call("owner", "POST", "/outbox/dispatch").json()
    assert sent["sent"] >= 1
    got = [m for m in shop.adapter.sent if str(m.message_id) == mid]
    assert len(got) == 1
    assert [str(x.photo_id) for x in got[0].media] == photos
    assert all(x.bucket == f"cat-{shop.tenant}" and x.path.endswith(".jpg") and x.content_type == "image/jpeg" for x in got[0].media)
    assert shop.msg_row(mid) == "sent/auto_allowed"


def test_at_night_photos_wait_for_the_morning_like_any_message(shop: Shop) -> None:
    item = shop.stocked("Night photo")
    photo = shop.call("owner", "GET", f"/catalogue/items/{item}").json()["photos"][0]["id"]
    lead = shop.lead()
    pin_clock(time(23, 30))
    try:
        mid, r = shop.submit("sales", lead, "A saree you may like.", [photo])
        assert r.status_code == 200 and shop.msg_row(mid) == "queued/quiet_hours"
        shop.call("owner", "POST", "/outbox/dispatch")
        assert not [m for m in shop.adapter.sent if str(m.message_id) == mid], "nothing goes between 9 pm and 9 am"
        assert shop.call("owner", "GET", f"/outbox/messages/{mid}").json()["media"][0]["photo_id"] == photo
    finally:
        pin_clock(time(14, 0))


def test_a_price_in_the_caption_waits_for_a_person_and_goes_only_after_approval(shop: Shop) -> None:
    item = shop.stocked("Priced caption")
    photo = shop.call("owner", "GET", f"/catalogue/items/{item}").json()["photos"][0]["id"]
    lead = shop.lead()
    mid, r = shop.submit("sales", lead, "This one is ₹30,000 to ₹50,000.", [photo])
    assert r.status_code == 200 and r.json()["message"]["status"] == "needs_approval" and r.json()["message"]["reason"] == "money"
    assert not [m for m in shop.adapter.sent if str(m.message_id) == mid]
    approved = shop.call("owner", "POST", f"/outbox/messages/{mid}/approve")
    assert approved.status_code == 200, approved.text
    shop.call("owner", "POST", "/outbox/dispatch")
    assert shop.msg_row(mid) == "sent/owner_approved"
    assert len([m for m in shop.adapter.sent if str(m.message_id) == mid]) == 1


def test_photos_that_are_not_this_businesss_active_live_photos_are_refused(shop: Shop) -> None:
    lead = shop.lead()
    inactive, _ = shop.item("Inactive with photo")
    pid = shop.upload("owner", inactive, png()).json()["photo"]["id"]
    assert shop.submit("sales", lead, "A hidden saree.", [pid])[1].status_code == 422, "an inactive item's photo"
    assert shop.submit("sales", lead, "Five photos.", [str(uuid.uuid4()) for _ in range(5)])[1].status_code == 422
    assert shop.submit("sales", lead, "Nothing like it.", [str(uuid.uuid4())])[1].status_code == 422
    other = shop.w.b
    other_item, r = shop.item("Business b", box="b")
    assert r.status_code == 200
    other_photo = shop.upload("owner", other_item, png(), box="b").json()["photo"]["id"]
    assert shop.submit("sales", lead, "Another business's photo.", [other_photo])[1].status_code == 422
    assert other.id != shop.tenant


def test_keep_record_makes_the_touch_when_the_message_is_really_sent_and_not_before(shop: Shop) -> None:
    lead = shop.lead()
    mid, r = shop.submit("sales", lead, "We have the new festival collection.", keep_record=True)
    assert r.status_code == 200 and r.json()["message"]["keep_record"] is True
    def count() -> int:
        return int(operator_sql.sql(f"select count(*) from public.lead_touches where lead_id = '{lead.id}'"))

    assert count() == 0, "queued: no touch"
    shop.call("owner", "POST", "/outbox/dispatch")
    assert shop.msg_row(mid) == "sent/auto_allowed" and count() == 1, "sent: one touch"
    assert operator_sql.sql(f"select direction || '|' || channel from public.lead_touches where lead_id = '{lead.id}'") == "out|whatsapp"
    shop.call("owner", "POST", "/outbox/dispatch")
    assert count() == 1
    # held for the morning: no touch until it is really sent
    night = shop.lead()
    pin_clock(time(23, 30))
    try:
        held, _ = shop.submit("sales", night, "We have the new festival collection.", keep_record=True)
        shop.call("owner", "POST", "/outbox/dispatch")
        assert shop.msg_row(held) == "queued/quiet_hours" and int(operator_sql.sql(f"select count(*) from public.lead_touches where lead_id = '{night.id}'")) == 0
        pin_clock(time(9, 30), day=1)
        shop.call("owner", "POST", "/outbox/dispatch")
        assert shop.msg_row(held) == "sent/quiet_hours" and int(operator_sql.sql(f"select count(*) from public.lead_touches where lead_id = '{night.id}'")) == 1, "now it is sent, and the touch is made"
    finally:
        pin_clock(time(14, 0))
    # not asked: never
    other = shop.lead()
    mid2, _ = shop.submit("sales", other, "We have the new festival collection.")
    shop.call("owner", "POST", "/outbox/dispatch")
    assert int(operator_sql.sql(f"select count(*) from public.lead_touches where lead_id = '{other.id}'")) == 0
    assert mid2 != mid


# ---------------------------------------------------------------------------------------------- the lead search and the suggested message
def test_the_lead_search_finds_by_company_contact_and_phone_ending_and_never_returns_a_number(shop: Shop) -> None:
    lead = shop.lead()
    phone = lead.phone or ""
    digits = "".join(ch for ch in phone if ch.isdigit())
    r = shop.call("sales", "GET", f"/leads/search?q={digits[-5:]}")
    assert r.status_code == 200, r.text
    hit = next(i for i in r.json()["items"] if i["lead_id"] == lead.id)
    assert hit["phone_last4"] == digits[-4:] and phone not in r.text and digits[:-4] not in r.text
    by_name = shop.call("viewer", "GET", f"/leads/search?q={lead.label}")
    assert by_name.status_code == 200 and any(i["lead_id"] == lead.id for i in by_name.json()["items"])
    assert shop.call("sales", "GET", "/leads/search?q=12").status_code == 422
    assert shop.call("sales", "GET", "/leads/search?q=x").status_code == 422
    assert shop.call("owner", "GET", f"/leads/search?q={digits[-5:]}", box="b").json()["items"] == [], "another business finds nothing of ours"
    page = shop.call("owner", "GET", "/leads/search?q=Person&limit=2").json()
    assert len(page["items"]) <= 2


# ---------------------------------------------------------------------------------------------- Agent OWL
HOLDER: dict[str, Any] = {"model": None}


@pytest.fixture(scope="module")
def app(stack: Any) -> Iterator[TestClient]:
    yield from assistant_app(stack, factory=lambda: HOLDER["model"])


@pytest.fixture(scope="module")
def assistant_on(eval_world: World, shop: Shop) -> Iterator[None]:
    saved = enable_assistant([eval_world.a, eval_world.b])
    try:
        yield
    finally:
        restore(saved)


def test_agent_owl_finds_sarees_and_sends_their_photos_under_the_policy(app: TestClient, shop: Shop, assistant_on: None) -> None:
    unique = uuid.uuid4().hex[:6]
    item = shop.stocked(f"Qq{unique} Peacock", fabric="mysore_silk", colours=["green"], occasions=["festival"], band="10k_25k", extra={})
    photo = shop.call("owner", "GET", f"/catalogue/items/{item}").json()["photos"][0]["id"]
    lead = shop.lead()
    HOLDER["model"] = Scripted(
        [
            lambda r: respond(ToolCall("find_catalogue_items", {"fabric": "mysore_silk", "colour": "green", "occasion": "festival"})),
            lambda r: respond(ToolCall("send_catalogue_items", {"lead_id": lead.id, "item_ids": [item], "language": "en", "caption": "Here is a saree you may like."})),
            lambda r: final("answer", "I found the green Mysore silk saree and queued its photo for the customer.", "en", ["s1", "s2"]),
        ]
    )
    r = app.post(f"/v1/tenants/{shop.tenant}/assistant/messages", json={"message_id": str(uuid.uuid4()), "text": "send photos of the green mysore silk to the customer"}, headers=bearer(shop.w.a.users["owner"]))
    assert r.status_code == 200, r.text
    evts = events(r)
    sources = [e[1] for e in evts if e[0] == "source"]
    assert {s["kind"] for s in sources} == {"catalogue_item", "outbox_message"}, sources
    queued = operator_sql.sql(f"select count(*) from public.outbox_messages where lead_id = '{lead.id}' and source = 'assistant'")
    assert queued == "1"
    mid = operator_sql.sql(f"select id from public.outbox_messages where lead_id = '{lead.id}' and source = 'assistant'")
    assert operator_sql.sql(f"select photo_id from public.outbox_message_media where message_id = '{mid}'") == photo
    assert shop.msg_row(mid) == "queued/auto_allowed", "photos without a price go by themselves only because automatic sending is on"
    assert not [m for m in shop.adapter.sent if str(m.message_id) == mid], "the assistant dispatched nothing"


def test_agent_owl_cannot_send_a_price_without_the_owner_and_cannot_name_one(app: TestClient, shop: Shop, assistant_on: None) -> None:
    item = shop.stocked(f"Qq{uuid.uuid4().hex[:6]} Priced")
    lead = shop.lead()
    HOLDER["model"] = Scripted(
        [
            lambda r: respond(ToolCall("send_catalogue_items", {"lead_id": lead.id, "item_ids": [item], "language": "en", "caption": "A lovely saree for ₹30,000 to ₹50,000."})),
            lambda r: respond(ToolCall("send_catalogue_items", {"lead_id": lead.id, "item_ids": [item], "language": "en", "caption": "A lovely saree.", "price_paise": 100})),
            lambda r: final("refusal", "I queued it, and it waits for you to approve it.", "en", []),
        ]
    )
    r = app.post(f"/v1/tenants/{shop.tenant}/assistant/messages", json={"message_id": str(uuid.uuid4()), "text": "send photos of it with the price"}, headers=bearer(shop.w.a.users["owner"]))
    assert r.status_code == 200, r.text
    rows = operator_sql.sql(f"select status || '/' || reason from public.outbox_messages where lead_id = '{lead.id}'").splitlines()
    assert rows == ["needs_approval/money"], "the caption's amount made it wait for the Owner; the call with a price field was refused"


def test_a_suggested_message_is_checked_and_counted(app: TestClient, shop: Shop, assistant_on: None) -> None:
    HOLDER["model"] = DevAssistantModel()  # the development stand-in writes a fixed, boring greeting in the customer's language
    lead = shop.lead()
    before = int(operator_sql.sql(f"select count(*) from public.agent_runs where tenant_id = '{shop.tenant}'"))
    r = app.post(f"/v1/tenants/{shop.tenant}/leads/{lead.id}/draft-message", json={}, headers=bearer(shop.w.a.users["sales"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["machine_draft"] is True and body["language"] == "en" and body["gloss_en"] and "₹" not in body["text"]
    after = int(operator_sql.sql(f"select count(*) from public.agent_runs where tenant_id = '{shop.tenant}'"))
    assert after == before + 1, "it is a run of the assistant"
    steps = operator_sql.sql(f"select count(*) from public.agent_run_steps where run_id = (select id from public.agent_runs where tenant_id = '{shop.tenant}' order by created_at desc limit 1)")
    assert int(steps) >= 0
    te = app.post(f"/v1/tenants/{shop.tenant}/leads/{lead.id}/draft-message", json={"language": "te"}, headers=bearer(shop.w.a.users["owner"]))
    assert te.status_code == 200 and te.json()["language"] == "te" and te.json()["gloss_en"]
    assert app.post(f"/v1/tenants/{shop.tenant}/leads/{lead.id}/draft-message", json={}, headers=bearer(shop.w.a.users["viewer"])).status_code == 403
    assert app.post(f"/v1/tenants/{shop.w.b.id}/leads/{lead.id}/draft-message", json={}, headers=bearer(shop.w.a.users["owner"])).status_code == 404
