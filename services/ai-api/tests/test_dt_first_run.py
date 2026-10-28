"""Job DT (ADR 0115) at the API: the business profile (the Owner edits it at any time, a type change that the data forbids is a 409 with a closed reason), the logo and the members' pictures (re-drawn
server side, kept in the business's private bucket), the people list, and the sign-in status. A fake repository and a fake storage stand in; nothing is contacted."""

# ruff: noqa: E501

from __future__ import annotations

import io
import time
import uuid
from typing import Any

from PIL import Image

from app.workspace.errors import TypeChangeRefusedError
from tests.catalogue_fakes import FakeStorage
from tests.fakes import TENANT_A, TENANT_B, USERS, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}"
BUCKET = f"img-{TENANT_A.id}"


def picture(fmt: str = "PNG", size: tuple[int, int] = (900, 600)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (200, 80, 40)).save(buffer, format=fmt)
    return buffer.getvalue()


class FakeBusiness:
    """Remembers the profile like the database function would (the parts the API depends on)."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.row: dict[str, Any] = {"name": "Tenant A", "type": "textiles", "type_name": "Textiles", "type_label": None, "city": None, "phone": None, "languages": [], "logo_path": None,
                                    "name_used_in": ["assistant_greeting", "voice_preview", "call_opening", "whatsapp_opening", "menu_header"], "updated_at": None}
        self.refuse: str | None = None
        self.members: dict[str, dict[str, Any]] = {}
        self.second_factor = False

    def business(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.row)

    def save_business(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("save_business", dict(patch)))
        if self.refuse:
            exc = TypeChangeRefusedError("SM791")
            exc.detail = self.refuse
            raise exc
        for key, value in patch.items():
            self.row["type_label" if key == "type_label" else key] = value
        return dict(self.row)

    def ensure_images_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        return BUCKET

    def set_logo(self, token: str, tenant_id: uuid.UUID, path: str | None) -> dict[str, Any]:
        self.calls.append(("set_logo", path))
        old, self.row["logo_path"] = self.row["logo_path"], path
        return {"logo_path": path, "old_path": old}

    def my_profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"user_id": str(USERS["a_sales"]), "display_name": "Ravi", "language": "te", "avatar_path": None, "google_picture": "https://lh3.googleusercontent.com/a/photo"}

    def save_my_profile(self, token: str, tenant_id: uuid.UUID, patch: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("save_my_profile", dict(patch)))
        me = {**self.my_profile(token, tenant_id), **{k: v for k, v in patch.items()}}
        me["old_avatar_path"] = self.members.get("old")
        return me

    def people(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return [{"user_id": str(USERS["a_owner"]), "display_name": "Lakshmi", "language": None, "avatar_path": "member/x/y.jpg", "google_picture": None},
                {"user_id": str(USERS["a_sales"]), "display_name": "Ravi", "language": None, "avatar_path": None, "google_picture": "https://lh3.googleusercontent.com/a/photo"},
                {"user_id": str(USERS["a_viewer"]), "display_name": None, "language": None, "avatar_path": None, "google_picture": None}]

    def account_security(self, token: str) -> dict[str, Any]:
        return {"second_factor_on": self.second_factor, "provider": "google"}


def world() -> tuple[Any, FakeBusiness, FakeStorage]:
    repo, storage = FakeBusiness(), FakeStorage()
    client, _ = make_client(workspace=repo, catalogue_storage=storage)
    return client, repo, storage


def test_any_member_reads_the_profile_and_a_stranger_does_not() -> None:
    client, _, _ = world()
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(f"{BASE}/workspace/profile", headers=auth(user))
        assert r.status_code == 200 and r.json()["name"] == "Tenant A" and r.json()["logo_url"] is None, user
    assert "assistant_greeting" in r.json()["name_used_in"]
    assert client.get(f"{BASE}/workspace/profile", headers=auth("b_owner")).status_code == 404
    assert client.get(f"{BASE}/workspace/profile").status_code == 401


def test_only_the_owner_edits_it_and_no_second_factor_is_asked() -> None:
    client, repo, _ = world()
    old = int(time.time()) - 7200
    r = client.patch(f"{BASE}/workspace/profile", json={"name": "Lakshmi Sarees", "city": "Guntur"}, headers=auth("a_owner", aal="aal1", iat=old))
    assert r.status_code == 200 and r.json()["name"] == "Lakshmi Sarees", "an Owner who signed in two hours ago may still fix the name"
    assert repo.calls[-1] == ("save_business", {"name": "Lakshmi Sarees", "city": "Guntur"})
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.patch(f"{BASE}/workspace/profile", json={"name": "x"}, headers=auth(user)).status_code == 403, user
    assert client.patch(f"{BASE}/workspace/profile", json={"name": "x"}, headers=auth("b_owner")).status_code == 404


def test_a_bad_patch_is_a_422_and_a_city_or_phone_can_be_cleared() -> None:
    client, repo, _ = world()
    h = auth("a_owner")
    bad_bodies: list[dict[str, Any]] = [{}, {"name": ""}, {"name": None}, {"phone": "call me"}, {"languages": []}, {"languages": ["xx"]}, {"colour": "red"}, {"type": "Not A Code"}, {"type_label": "x"}]
    for body in bad_bodies:
        assert client.patch(f"{BASE}/workspace/profile", json=body, headers=h).status_code == 422, body
    assert not repo.calls
    r = client.patch(f"{BASE}/workspace/profile", json={"city": None, "phone": None}, headers=h)
    assert r.status_code == 200 and repo.calls[-1] == ("save_business", {"city": None, "phone": None})


def test_a_type_change_the_data_forbids_is_a_409_with_a_closed_reason() -> None:
    client, repo, _ = world()
    for reason in ("pack_data_present", "lead_data_present", "unknown_type"):
        repo.refuse = reason
        r = client.patch(f"{BASE}/workspace/profile", json={"type": "clinic"}, headers=auth("a_owner"))
        assert r.status_code == 409 and r.json()["error"]["code"] == "type_change_refused" and r.json()["error"]["reason"] == reason
    repo.refuse = None
    r = client.patch(f"{BASE}/workspace/profile", json={"type": "other", "type_label": "Pet shop"}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["type"] == "other" and r.json()["type_label"] == "Pet shop"


def test_the_logo_is_redrawn_stored_privately_signed_and_replaced() -> None:
    client, repo, storage = world()
    h = {**auth("a_admin"), "Content-Type": "image/png"}
    r = client.post(f"{BASE}/workspace/logo", content=picture(), headers=h)
    assert r.status_code == 200 and r.json()["logo_url"].startswith(f"http://storage.local/object/sign/{BUCKET}/logo/")
    ((bucket, path), data), = storage.objects.items()
    assert bucket == BUCKET and path.startswith("logo/") and path.endswith(".jpg")
    with Image.open(io.BytesIO(data)) as out:
        assert out.format == "JPEG" and max(out.size) <= 1280
    first = path
    client.post(f"{BASE}/workspace/logo", content=picture("JPEG"), headers={**auth("a_owner"), "Content-Type": "image/jpeg"})
    assert (BUCKET, first) not in storage.objects and len(storage.objects) == 1, "the old file is deleted"
    assert client.post(f"{BASE}/workspace/logo/remove", headers=auth("a_owner")).status_code == 200 and not storage.objects and repo.row["logo_path"] is None
    for user in ("a_sales", "a_viewer"):
        assert client.post(f"{BASE}/workspace/logo", content=picture(), headers={**auth(user), "Content-Type": "image/png"}).status_code == 403, user


def test_a_bad_or_big_image_is_refused_and_nothing_is_stored() -> None:
    client, _, storage = world()
    h = {**auth("a_owner"), "Content-Type": "image/png"}
    assert client.post(f"{BASE}/workspace/logo", content=b"not an image", headers=h).status_code == 422
    assert client.post(f"{BASE}/workspace/logo", content=picture(), headers={**auth("a_owner"), "Content-Type": "application/pdf"}).status_code == 415
    assert client.post(f"{BASE}/workspace/logo", content=b"x" * (5 * 1024 * 1024 + 70000), headers=h).status_code == 413
    assert not storage.objects


def test_a_member_sets_their_own_name_language_and_picture() -> None:
    client, repo, storage = world()
    h = auth("a_sales")
    r = client.get(f"{BASE}/me/profile", headers=h)
    assert r.status_code == 200 and r.json()["picture"] == "google" and r.json()["picture_url"].startswith("https://lh3.googleusercontent.com/")
    assert client.patch(f"{BASE}/me/profile", json={"display_name": "Ravi K", "language": "te"}, headers=h).status_code == 200
    assert repo.calls[-1] == ("save_my_profile", {"display_name": "Ravi K", "language": "te"})
    for body in ({}, {"language": "xx"}, {"display_name": ""}, {"display_name": None}, {"x": 1}):
        assert client.patch(f"{BASE}/me/profile", json=body, headers=h).status_code == 422, body
    r = client.post(f"{BASE}/me/picture", content=picture(), headers={**h, "Content-Type": "image/png"})
    assert r.status_code == 200
    ((bucket, path), data), = storage.objects.items()
    assert bucket == BUCKET and path.startswith(f"member/{USERS['a_sales']}/") and path.endswith(".jpg")
    with Image.open(io.BytesIO(data)) as out:
        assert out.format == "JPEG" and max(out.size) <= 320
    assert repo.calls[-1] == ("save_my_profile", {"avatar_path": path})
    assert client.post(f"{BASE}/me/picture/remove", headers=h).status_code == 200 and repo.calls[-1] == ("save_my_profile", {"avatar_path": None})  # type: ignore[comparison-overlap]
    assert client.get(f"{BASE}/me/profile", headers=auth("b_owner")).status_code == 404


def test_the_people_list_gives_every_member_a_name_and_the_right_kind_of_picture() -> None:
    client, _, storage = world()
    r = client.get(f"{BASE}/people", headers=auth("a_viewer"))
    assert r.status_code == 200
    kinds = [p["picture"] for p in r.json()["people"]]
    assert kinds == ["own", "google", "none"]
    assert r.json()["people"][0]["picture_url"].startswith(f"http://storage.local/object/sign/{BUCKET}/member/")
    assert r.json()["people"][2]["display_name"] is None and r.json()["people"][2]["picture_url"] is None
    assert client.get(f"{BASE}/people", headers=auth("b_owner")).status_code == 404
    assert TENANT_B.id != TENANT_A.id and storage.calls[0][2] == BUCKET


def test_the_sign_in_status_says_whether_the_authenticator_is_on_and_nothing_about_a_time_window() -> None:
    client, repo, _ = world()
    r = client.get("/v1/account/security", headers=auth("a_owner", aal="aal1"))
    body = r.json()
    assert r.status_code == 200 and body["second_factor"] == "optional" and body["second_factor_on"] is False and body["provider"] == "google"
    assert body["session_level"] == "aal1" and body["asked_at_sign_up"] is False
    assert "recent_sign_in" not in body and "signed_in_at" not in body, "no 10-minute window (owner decision, 28 Oct)"
    repo.second_factor = True
    r = client.get("/v1/account/security", headers=auth("a_owner", aal="aal2"))
    assert r.json()["second_factor_on"] is True and r.json()["session_level"] == "aal2"


def test_every_email_carries_the_three_bar_mark_from_our_own_domain_and_nothing_third_party() -> None:
    import re
    from pathlib import Path

    from app.billing import mail

    out = mail.to_html(["Hello there."], "Thank you")
    src = re.search(r'<img src="([^"]+)"', out)
    assert src is not None and src.group(1).startswith("https://stack19.com/brand/") and "tracking" not in out.lower()
    assert len(re.findall(r"<img ", out)) == 1
    root = Path(__file__).resolve().parents[3]
    png = (root / "apps" / "web" / "public" / "brand" / "stack19-mark-email.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) < 20_000
    for template in (root / "supabase" / "templates").glob("*.html"):
        assert "{{ .SiteURL }}/brand/stack19-mark-email.png" in template.read_text(encoding="utf-8"), template.name


def test_the_code_is_asked_once_per_session_and_only_of_a_person_who_turned_the_authenticator_on() -> None:
    client, repo, _ = world()
    url = f"{BASE}/erasure-requests"

    def attempt(**claims: Any) -> Any:
        return client.post(url, json={"id": str(uuid.uuid4()), "scope": "tenant"}, headers=auth("a_owner", **claims))


    def asked(r: Any) -> bool:
        return bool(r.status_code == 403 and r.json()["error"].get("code") == "mfa_required")

    assert not asked(attempt(aal="aal1")), "no authenticator: never asked, however old the sign-in"
    assert not asked(attempt(aal="aal1", iat=int(time.time()) - 86_400)), "and a day-old session is no different (no time window)"
    repo.second_factor = True
    r = attempt(aal="aal1")
    assert asked(r) and r.json()["error"]["reason"] == "second_factor"
    assert not asked(attempt(aal="aal2")), "once the code was entered the session stays aal2"
    assert not asked(attempt(aal="aal2", iat=int(time.time()) - 86_400)), "...for as long as the session lives: no second question"


def test_other_is_the_screens_name_for_the_generic_pack_in_the_lists_and_at_setup() -> None:
    from app.workspace import other_type

    assert other_type.public_id("general_business") == "other" and other_type.internal_code("other") == "general_business"
    assert other_type.public_id("coaching") == "coaching" and other_type.internal_code("coaching") == "coaching"
    client, repo, _ = world()
    # the lead templates answer to "other" (and still to the pack's own id)
    listing = client.get("/v1/lead-templates").json()["templates"]
    assert "other" in [t["pack_id"] for t in listing] and "general_business" not in [t["pack_id"] for t in listing]
    assert client.get("/v1/lead-templates/other").json()["pack_id"] == "other"
    # setup: "other" needs its words, a normal type takes none, and the words are saved as the type label
    h = auth("outsider")
    assert client.post("/v1/account/setup", json={"business_type": "other", "language": "en"}, headers=h).status_code == 422
    assert client.post("/v1/account/setup", json={"business_type": "coaching", "language": "en", "business_label": "Pet shop"}, headers=h).status_code == 422
    assert client.post("/v1/account/setup", json={"business_type": "other", "language": "en", "business_label": "x"}, headers=h).status_code == 422
    ok = client.post("/v1/account/setup", json={"business_type": "other", "language": "en", "business_label": "Pet shop"}, headers=h)
    assert ok.status_code == 200, ok.text
    assert ("save_business", {"type": "other", "type_label": "Pet shop"}) in repo.calls
