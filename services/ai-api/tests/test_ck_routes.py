"""Job CK: the packs, modules, example-data, sign-up-provider, second-factor and custom-field routes, with fakes (no database). The database's own rules are proved in
supabase/tests/database/93..95 and tests/integration/test_ck_*.py."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.config import Settings
from app.customfields.errors import CustomFieldLimitError, CustomValueInvalidError
from app.customfields.repository import PostgrestCustomFieldsRepository
from app.packs.errors import ExampleAlreadyLoadedError, ModuleOffError
from app.packs.models import AuthProvidersOut
from app.packs.providers import providers_from_settings
from app.packs.registry import PackRegistry, default_directory
from app.packs.repository import PostgrestPacksRepository
from app.tenancy.repository import BusinessTypeUnavailable, UpstreamError
from tests.fakes import TENANT_A, TENANT_B, USERS, auth, make_client

ROOT = Path(__file__).resolve().parents[3]
PACKS = ROOT / "packages" / "packs"
A = TENANT_A.id
NOW = "2026-10-14T09:00:00+00:00"


# ------------------------------------------------------------------------------------------------------------------ fakes
class FakePacks:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.error: Exception | None = None
        self.loaded = False

    def _go(self, name: str, token: str) -> None:
        self.calls.append((name, token))
        if self.error is not None:
            raise self.error

    def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("pack", token)
        manifest = json.loads((PACKS / "construction_materials" / "pack.json").read_text(encoding="utf-8"))
        manifest.pop("example_data")
        return {"pack_id": "construction_materials", "version": 1, "status": "preview", "validated": False, "source": "signup", "chosen_at": NOW, "manifest": manifest, "modules": manifest["modules"]}

    def workspace_modules(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._go("modules", token)
        return [{"module": "quotes", "enabled": True, "reason": "pack"}, {"module": "fees", "enabled": False, "reason": "pack"}]

    def catalogue(self, token: str) -> list[dict[str, Any]]:
        self._go("catalogue", token)
        return []

    def example_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("example_status", token)
        return {"loaded": self.loaded, "batch_id": str(uuid.UUID(int=7)) if self.loaded else None, "pack_id": "textiles" if self.loaded else None, "loaded_at": NOW if self.loaded else None, "removed_at": None, "counts": {"companies": 3} if self.loaded else {}}

    def example_load(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("example_load", token)
        if self.loaded:
            raise ExampleAlreadyLoadedError("SM721")
        self.loaded = True
        return self.example_status(token, tenant_id)

    def example_remove(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("example_remove", token)
        self.loaded = False
        return {"batch_id": str(uuid.UUID(int=7)), "removed": {"companies": 2, "contacts": 3, "leads": 2, "products": 5}, "kept": {"companies": 1}}


def _fields() -> list[dict[str, Any]]:
    return [
        {"id": str(uuid.UUID(int=1)), "entity": "contact", "code": "customer_kind", "label": {"en": "Customer type"}, "kind": "choice", "choices": [{"code": "builder", "label": {"en": "Builder"}}], "required": False, "position": 0, "pii_class": "none", "mergeable": True, "active": True, "source": "pack"}
    ]


class FakeCustomFields:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.error: Exception | None = None

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.error is not None:
            raise self.error

    def defs_list(self, token: str, tenant_id: uuid.UUID, entity: str | None) -> list[dict[str, Any]]:
        self._go("list", entity)
        return [f for f in _fields() if entity in (None, f["entity"])]

    def def_create(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        self._go("create", body)
        return {**_fields()[0], "code": body["code"], "kind": body["kind"], "label": body["label"], "choices": body.get("choices"), "source": "owner", "required": body.get("required", False)}

    def def_update(self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        self._go("update", field_id, body)
        return {**_fields()[0], **{k: v for k, v in body.items() if k in ("required", "active", "position", "label")}}

    def values_get(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID) -> dict[str, Any]:
        self._go("get", entity, entity_id)
        return {"entity": entity, "entity_id": str(entity_id), "values": [{"code": "customer_kind", "kind": "choice", "active": True, "value": "builder"}]}

    def values_set(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID, values: dict[str, Any]) -> dict[str, Any]:
        self._go("set", entity, entity_id, values)
        return {"entity": entity, "entity_id": str(entity_id), "values": [{"code": c, "kind": "text", "active": True, "value": v} for c, v in values.items()]}

    def values_set_many(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        self._go("set_many", items)
        return {"set": len(items), "failed": []}


# ------------------------------------------------------------------------------------------------------------------ the sign-up cards (no sign-in)
def test_the_sign_up_cards_need_no_sign_in_and_list_the_three_business_types() -> None:
    client, _ = make_client(pack_registry=PackRegistry(PACKS))
    r = client.get("/v1/packs")
    assert r.status_code == 200, r.text
    body = r.json()["packs"]
    # job DR: the nine leads-and-calls types are previews too, listed after the published one by id
    assert [p["pack_id"] for p in body] == ["textiles", "auto_dealer", "clinic", "coaching", "construction_materials", "education", "other", "gym", "insurance_loans", "interiors_solar", "real_estate", "travel", "wholesale_b2b"]
    assert [p["validated"] for p in body] == [True] + [False] * 12
    assert all(p["names"]["en"] and p["summary"]["en"] and p["status"] in ("preview", "published") for p in body)


def test_the_cards_are_unavailable_rather_than_empty_when_the_files_are_missing(tmp_path: Path) -> None:
    client, _ = make_client(pack_registry=PackRegistry(tmp_path / "nope"))
    r = client.get("/v1/packs")
    assert r.status_code == 503 and r.json()["error"]["code"] == "packs_unavailable"
    plain, _ = make_client()
    assert plain.get("/v1/packs").status_code == 503


def test_a_draft_pack_and_an_unreadable_pack_are_never_served(tmp_path: Path) -> None:
    import shutil

    shutil.copytree(PACKS, tmp_path / "p")
    draft = json.loads((tmp_path / "p" / "education" / "pack.json").read_text(encoding="utf-8"))
    draft["status"] = "draft"
    (tmp_path / "p" / "education" / "pack.json").write_text(json.dumps(draft), encoding="utf-8")
    (tmp_path / "p" / "construction_materials" / "pack.json").write_text("{not json", encoding="utf-8")
    listed = PackRegistry(tmp_path / "p").selectable()
    assert [p.pack_id for p in listed.packs] == ["textiles", "auto_dealer", "clinic", "coaching", "general_business", "gym", "insurance_loans", "interiors_solar", "real_estate", "travel", "wholesale_b2b"]  # job DR: the nine previews stay (job DT: and the generic one; the registry holds its own id, the route says "other")


def test_the_default_directory_is_the_checkouts_packs() -> None:
    assert default_directory() == PACKS


def test_a_newer_version_replaces_an_older_one_in_the_cards(tmp_path: Path) -> None:
    import shutil

    shutil.copytree(PACKS, tmp_path / "p")
    newer = json.loads((tmp_path / "p" / "textiles" / "pack.json").read_text(encoding="utf-8"))
    newer["version"] = 2
    (tmp_path / "p" / "textiles" / "pack.json").write_text(json.dumps(newer), encoding="utf-8")
    assert next(p for p in PackRegistry(tmp_path / "p").selectable().packs if p.pack_id == "textiles").version == 2


# ------------------------------------------------------------------------------------------------------------------ providers and the second factor
def test_social_sign_up_is_off_unless_its_keys_are_configured() -> None:
    assert providers_from_settings(Settings(_env_file=None)) == AuthProvidersOut(email=True, google=False, facebook=False)  # type: ignore[call-arg]
    both = Settings(_env_file=None, auth_google_client_id="g.apps.example", auth_facebook_app_id="12345")  # type: ignore[call-arg]
    assert providers_from_settings(both) == AuthProvidersOut(email=True, google=True, facebook=True)
    blank = Settings(_env_file=None, auth_google_client_id="  ", auth_facebook_app_id="")  # type: ignore[call-arg]
    assert providers_from_settings(blank) == AuthProvidersOut(email=True, google=False, facebook=False)


def test_the_providers_route_needs_no_sign_in_and_never_carries_a_secret() -> None:
    client, _ = make_client(auth_providers=AuthProvidersOut(email=True, google=True, facebook=False))
    r = client.get("/v1/auth/providers")
    assert r.status_code == 200 and r.json() == {"email": True, "google": True, "facebook": False}
    default, _ = make_client()
    assert default.get("/v1/auth/providers").json() == {"email": True, "google": False, "facebook": False}


def test_the_second_factor_is_not_asked_at_sign_up_and_the_status_says_where_the_session_stands() -> None:
    client, _ = make_client()
    assert client.get("/v1/account/security").status_code == 401
    weak = client.get("/v1/account/security", headers=auth("a_owner", aal="aal1")).json()
    strong = client.get("/v1/account/security", headers=auth("a_owner", aal="aal2")).json()
    assert weak["session_level"] == "aal1" and strong["session_level"] == "aal2"
    assert weak["asked_at_sign_up"] is False
    assert {"approvals", "whatsapp_connect"} <= set(weak["needed_for"])


def test_the_setup_takes_a_pack_code_and_nothing_but_the_business_type_and_the_language() -> None:
    client, repo = make_client()
    ok = client.post("/v1/account/setup", json={"business_type": "construction_materials", "language": "te"}, headers=auth("outsider"))
    assert ok.status_code == 200, ok.text
    assert repo.setup_calls[-1] == ("construction_materials", "te")
    for body in (
        {"business_type": "Not A Code", "language": "en"},
        {"business_type": "", "language": "en"},
        {"business_type": "education", "language": "fr"},
        {"business_type": "education", "language": "en", "business_name": "Mine"},
        {"language": "en"},
    ):
        assert client.post("/v1/account/setup", json=body, headers=auth("outsider")).status_code == 422, body


def test_a_business_type_that_is_not_selectable_has_its_own_plain_refusal() -> None:
    client, repo = make_client()
    repo.raise_on_next = BusinessTypeUnavailable("SM702")
    r = client.post("/v1/account/setup", json={"business_type": "bakery", "language": "en"}, headers=auth("outsider"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "business_type_unavailable"


# ------------------------------------------------------------------------------------------------------------------ the workspace pack and modules
def test_every_member_reads_the_pack_with_its_words_units_and_modules() -> None:
    packs = FakePacks()
    client, _ = make_client(packs=packs)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(f"/v1/tenants/{A}/pack", headers=auth(user))
        assert r.status_code == 200, (user, r.text)
    body = r.json()
    assert body["pack_id"] == "construction_materials" and body["validated"] is False and body["status"] == "preview"
    assert body["core_tab"] == "orders" and "deliveries" in body["modules"] and "sq_ft" in body["units"] and body["default_unit"] == "sq_ft"
    assert body["labels"]["en"]["nav.item.orders"] == "Orders & deliveries" and body["language_review"]["te"] == "draft"
    assert body["has_example_data"] is False  # the fake pack has its example data taken out
    assert client.get(f"/v1/tenants/{A}/pack", headers=auth("outsider")).status_code == 404
    assert client.get(f"/v1/tenants/{A}/pack", headers=auth("b_owner")).status_code == 404
    assert client.get(f"/v1/tenants/{A}/pack").status_code == 401
    assert all(token for _, token in packs.calls)


def test_the_modules_list_says_which_are_on_and_why() -> None:
    client, _ = make_client(packs=FakePacks())
    r = client.get(f"/v1/tenants/{A}/modules", headers=auth("a_viewer"))
    assert r.status_code == 200 and r.json()["modules"] == [{"module": "quotes", "enabled": True, "reason": "pack"}, {"module": "fees", "enabled": False, "reason": "pack"}]
    assert client.get(f"/v1/tenants/{TENANT_B.id}/modules", headers=auth("a_owner")).status_code == 404


def test_the_packs_routes_are_unavailable_without_a_repository() -> None:
    client, _ = make_client()
    for path in ("pack", "modules", "example-data"):
        r = client.get(f"/v1/tenants/{A}/{path}", headers=auth("a_owner"))
        assert r.status_code == 503 and r.json()["error"]["code"] == "packs_unavailable", path


def test_a_module_that_is_off_is_a_403_with_its_own_code() -> None:
    packs = FakePacks()
    packs.error = ModuleOffError("SM701")
    client, _ = make_client(packs=packs)
    r = client.post(f"/v1/tenants/{A}/example-data", headers=auth("a_owner"))
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_off"
    packs.error = UpstreamError("down")
    assert client.get(f"/v1/tenants/{A}/pack", headers=auth("a_owner")).status_code in (502, 503)


# ------------------------------------------------------------------------------------------------------------------ example data
def test_owner_and_admin_load_and_remove_the_sample_and_everyone_can_see_its_status() -> None:
    packs = FakePacks()
    client, _ = make_client(packs=packs)
    url = f"/v1/tenants/{A}/example-data"
    assert client.get(url, headers=auth("a_viewer")).json()["loaded"] is False
    for user in ("a_sales", "a_viewer"):
        assert client.post(url, headers=auth(user)).status_code == 403, user
        assert client.post(url + "/remove", headers=auth(user)).status_code == 403, user
    assert client.post(url, headers=auth("outsider")).status_code == 404
    loaded = client.post(url, headers=auth("a_owner"))
    assert loaded.status_code == 201 and loaded.json()["loaded"] is True and loaded.json()["counts"]["companies"] == 3
    assert client.get(url, headers=auth("a_sales")).json()["loaded"] is True
    again = client.post(url, headers=auth("a_admin"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "example_data_loaded"
    removed = client.post(url + "/remove", headers=auth("a_admin"))
    assert removed.status_code == 200 and removed.json()["removed"]["products"] == 5 and removed.json()["kept"] == {"companies": 1, "contacts": 0, "leads": 0, "products": 0}
    assert client.get(url, headers=auth("a_owner")).json()["loaded"] is False


def test_loading_the_sample_needs_no_second_factor_it_is_not_a_money_action() -> None:
    client, _ = make_client(packs=FakePacks())
    assert client.post(f"/v1/tenants/{A}/example-data", headers=auth("a_owner", aal="aal1")).status_code == 201


# ------------------------------------------------------------------------------------------------------------------ custom fields
CF = f"/v1/tenants/{A}/custom-fields"
NEW = {"entity": "contact", "code": "site_area", "label": {"en": "Site area"}, "kind": "text"}


def test_every_member_lists_the_definitions() -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert client.get(CF, headers=auth(user)).status_code == 200, user
    assert client.get(CF + "?entity=catalogue_item", headers=auth("a_viewer")).json() == {"fields": []}
    assert client.get(CF + "?entity=dependant", headers=auth("a_viewer")).status_code == 422
    assert client.get(CF, headers=auth("outsider")).status_code == 404


def test_a_new_field_needs_owner_or_admin_with_a_second_factor_and_is_always_personal_class_none() -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    ok = client.post(CF, json=NEW, headers=auth("a_admin"))
    assert ok.status_code == 201, ok.text
    assert ok.json()["source"] == "owner" and ok.json()["pii_class"] == "none"
    for user, code in (("a_sales", 403), ("a_viewer", 403), ("outsider", 404)):
        assert client.post(CF, json=NEW, headers=auth(user)).status_code == code, user
    weak = client.post(CF, json=NEW, headers=auth("a_owner", aal="aal1"))
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert [c for c in cf.calls if c[0] == "create"].__len__() == 1


@pytest.mark.parametrize(
    "body",
    [
        {**NEW, "pii_class": "personal"},
        {**NEW, "source": "pack"},
        {**NEW, "tenant_id": str(A)},
        {**NEW, "code": "Bad Code"},
        {**NEW, "code": "x"},
        {**NEW, "label": {"te": "x"}},
        {**NEW, "label": {"en": ""}},
        {**NEW, "label": {"en": "x" * 81}},
        {**NEW, "label": {"fr": "x", "en": "x"}},
        {**NEW, "kind": "choice"},
        {**NEW, "kind": "text", "choices": [{"code": "a", "label": {"en": "A"}}]},
        {**NEW, "kind": "choice", "choices": []},
        {**NEW, "kind": "choice", "choices": [{"code": "a", "label": {"en": "A"}}, {"code": "a", "label": {"en": "B"}}]},
        {**NEW, "kind": "choice", "choices": [{"code": "A!", "label": {"en": "A"}}]},
        {**NEW, "kind": "secret"},
        {**NEW, "entity": "dependant"},
    ],
)
def test_a_malformed_definition_is_a_422_and_reaches_nothing(body: dict[str, Any]) -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    assert client.post(CF, json=body, headers=auth("a_owner")).status_code == 422
    assert cf.calls == []


def test_a_field_changes_only_in_its_label_flag_order_and_choices() -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    fid = uuid.UUID(int=1)
    ok = client.patch(f"{CF}/{fid}", json={"active": False, "add_choices": [{"code": "dealer", "label": {"en": "Dealer"}}]}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["active"] is False
    assert cf.calls[-1][1][1] == {"active": False, "add_choices": [{"code": "dealer", "label": {"en": "Dealer"}}]}  # only what was sent
    forbidden: list[dict[str, Any]] = [{"code": "new_code"}, {"kind": "number"}, {"entity": "catalogue_item"}, {"pii_class": "personal"}, {"choices": []}, {"position": -1}, {"add_choices": []}]
    for body in forbidden:
        assert client.patch(f"{CF}/{fid}", json=body, headers=auth("a_owner")).status_code == 422, body
    assert client.patch(f"{CF}/not-a-uuid", json={"active": True}, headers=auth("a_owner")).status_code == 404
    assert client.patch(f"{CF}/{fid}", json={"active": True}, headers=auth("a_sales")).status_code == 403
    assert client.patch(f"{CF}/{fid}", json={"active": True}, headers=auth("a_owner", aal="aal1")).status_code == 403


def test_a_contacts_values_are_read_by_all_and_written_by_owner_admin_and_sales() -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    cid = uuid.UUID(int=0xC)
    url = f"/v1/tenants/{A}/contacts/{cid}/custom"
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        assert client.get(url, headers=auth(user)).status_code == 200, user
    body: dict[str, Any] = {"values": {"customer_kind": "builder", "site_area": "Hitech City", "num": 5, "flag": True, "dte": "2026-10-14", "many": ["a", "b"], "clear": None}}
    for user in ("a_owner", "a_admin", "a_sales"):
        assert client.put(url, json=body, headers=auth(user)).status_code == 200, user
    assert client.put(url, json=body, headers=auth("a_viewer")).status_code == 403
    assert client.put(url, json=body, headers=auth("outsider")).status_code == 404
    assert cf.calls[-1][1][2] == body["values"]
    # no second factor is asked to fill in a value
    assert client.put(url, json=body, headers=auth("a_owner", aal="aal1")).status_code == 200
    assert client.get(f"/v1/tenants/{A}/contacts/nonsense/custom", headers=auth("a_owner")).status_code == 404


def test_a_catalogue_items_values_are_written_by_owner_and_admin_only() -> None:
    client, _ = make_client(custom_fields=FakeCustomFields())
    url = f"/v1/tenants/{A}/catalogue/{uuid.UUID(int=0x1)}/custom"
    assert client.put(url, json={"values": {"size": "200x100"}}, headers=auth("a_admin")).status_code == 200
    assert client.put(url, json={"values": {"size": "200x100"}}, headers=auth("a_sales")).status_code == 403
    assert client.get(url, headers=auth("a_sales")).status_code == 200


@pytest.mark.parametrize(
    "body",
    [{}, {"values": {"Bad Code": "x"}}, {"values": {"a": {"nested": 1}}}, {"values": {"a": [1, 2]}}, {"values": {"a": "x"}, "pii_class": "personal"}, {"values": [1]}, {"values": {f"f{i:02d}": "x" for i in range(41)}}],
)
def test_malformed_values_are_a_422_and_reach_nothing(body: dict[str, Any]) -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    assert client.put(f"/v1/tenants/{A}/contacts/{uuid.UUID(int=0xC)}/custom", json=body, headers=auth("a_owner")).status_code == 422
    assert cf.calls == []


def test_the_database_refusals_have_their_plain_words() -> None:
    cf = FakeCustomFields()
    client, _ = make_client(custom_fields=cf)
    url = f"/v1/tenants/{A}/contacts/{uuid.UUID(int=0xC)}/custom"
    for error, status, code in (
        (CustomValueInvalidError("SM711"), 422, "custom_value_invalid"),
        (CustomFieldLimitError("SM712"), 409, "custom_field_limit"),
        (ModuleOffError("SM701"), 403, "module_off"),
    ):
        cf.error = error
        r = client.put(url, json={"values": {"a_code": "x"}}, headers=auth("a_owner"))
        assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    plain, _ = make_client()
    assert plain.get(CF, headers=auth("a_owner")).status_code == 503


def test_no_model_path_reads_a_custom_value() -> None:
    """ADR 0084 principle 6: a model never sees a field the business marked personal and never any child's field. Today NOTHING outside the custom-field routes, the import and the wiring reads these values."""
    app_dir = ROOT / "services" / "ai-api" / "app"
    allowed = {"customfields", "packs", "leadspack"}  # job DR: leadspack reads a pack's custom field DEFINITIONS (never values)
    allowed_files = {app_dir / "main.py", app_dir / "auth" / "deps.py", app_dir / "integrations" / "routes_import.py", app_dir / "integrations" / "importer.py", app_dir / "integrations" / "mapping.py", app_dir / "privacy" / "export_builder.py"}  # (the export is the owner's own download of their data)
    pattern = re.compile(r"custom_field_values|custom_values_|customfields|custom_fields")
    offenders = []
    for path in app_dir.rglob("*.py"):
        if path.relative_to(app_dir).parts[0] in allowed or path in allowed_files:
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            offenders.append(str(path.relative_to(app_dir)))
    assert offenders == [], f"these modules mention custom field values: {offenders}"


# ------------------------------------------------------------------------------------------------------------------ the real repositories, against a mock transport
def _mock(handler: Any) -> httpx.Client:
    return httpx.Client(base_url="http://db.test/rest/v1", transport=httpx.MockTransport(handler))


def test_the_packs_repository_sends_the_callers_token_and_only_named_arguments() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        name = request.url.path.rsplit("/", 1)[-1]
        return httpx.Response(200, json=[] if name in ("workspace_modules", "pack_catalogue") else {"loaded": False})

    repo = PostgrestPacksRepository("http://db.test/rest/v1", "anon", client=_mock(handler))
    repo.workspace_pack("tok", A)
    repo.workspace_modules("tok", A)
    repo.catalogue("tok")
    repo.example_status("tok", A)
    repo.example_load("tok", A)
    repo.example_remove("tok", A)
    assert [r.url.path.rsplit("/", 1)[-1] for r in seen] == ["workspace_pack_get", "workspace_modules", "pack_catalogue", "example_data_status", "example_data_load", "example_data_remove"]
    assert all(r.headers["authorization"] == "Bearer tok" and r.headers["apikey"] == "anon" for r in seen)
    assert json.loads(seen[0].content) == {"p_tenant_id": str(A)} and json.loads(seen[2].content) == {}


@pytest.mark.parametrize(("sqlstate", "exc"), [("SM701", ModuleOffError), ("SM721", ExampleAlreadyLoadedError)])
def test_the_packs_repository_classifies_by_sqlstate_only(sqlstate: str, exc: type[Exception]) -> None:
    repo = PostgrestPacksRepository("http://db.test/rest/v1", "anon", client=_mock(lambda r: httpx.Response(400, json={"code": sqlstate, "message": "a secret detail"})))
    with pytest.raises(exc) as info:
        repo.example_load("tok", A)
    assert "secret" not in str(info.value)


def test_the_custom_fields_repository_maps_its_arguments_and_its_refusals() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path.endswith("custom_field_defs_list"):
            return httpx.Response(200, json=[])
        if request.url.path.endswith("custom_values_set") and b"BAD" in request.content:
            return httpx.Response(400, json={"code": "SM711", "message": "x"})
        if request.url.path.endswith("custom_field_def_create") and b"TOOMANY" in request.content:
            return httpx.Response(400, json={"code": "SM712", "message": "x"})
        return httpx.Response(200, json={"ok": True})

    repo = PostgrestCustomFieldsRepository("http://db.test/rest/v1", "anon", client=_mock(handler))
    assert repo.defs_list("tok", A, "contact") == []
    repo.def_create("tok", A, {"entity": "contact", "code": "c1", "label": {"en": "C"}, "kind": "text"})
    repo.def_update("tok", A, uuid.UUID(int=1), {"active": False})
    repo.values_get("tok", A, "contact", uuid.UUID(int=2))
    repo.values_set("tok", A, "contact", uuid.UUID(int=2), {"c1": "x"})
    repo.values_set_many("tok", A, [{"id": str(uuid.UUID(int=2)), "values": {"c1": "x"}}])
    created = json.loads(seen[1].content)
    assert created == {"p_tenant_id": str(A), "p_entity": "contact", "p_code": "c1", "p_label": {"en": "C"}, "p_kind": "text", "p_choices": None, "p_required": False}
    updated = json.loads(seen[2].content)
    assert updated["p_active"] is False and updated["p_label"] is None and updated["p_add_choices"] is None
    with pytest.raises(CustomValueInvalidError):
        repo.values_set("tok", A, "contact", uuid.UUID(int=2), {"c1": "BAD"})
    with pytest.raises(CustomFieldLimitError):
        repo.def_create("tok", A, {"entity": "contact", "code": "c2", "label": {"en": "TOOMANY"}, "kind": "text"})


def test_utc_is_what_the_fakes_use() -> None:
    assert datetime.fromisoformat(NOW).tzinfo == UTC
    assert USERS["a_owner"]


def test_a_pack_has_example_data_only_when_one_of_its_lists_has_a_row() -> None:
    from app.packs.routes import _has_example_data

    assert _has_example_data({"example_data": {"contacts": [{"key": "a"}]}}) is True
    assert _has_example_data({"example_data": {}}) is False
    assert _has_example_data({"example_data": {"contacts": [], "leads": []}}) is False
    assert _has_example_data({}) is False


def test_the_pack_says_itself_whether_it_ships_example_data() -> None:
    """The database function hands the manifest out without its example rows, so the answer comes from the function's own `has_example_data`; an older function that does not say it is read from the manifest."""

    class Says(FakePacks):
        def workspace_pack(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            return {**super().workspace_pack(token, tenant_id), "has_example_data": True}

    client, _ = make_client(packs=Says())
    r = client.get(f"/v1/tenants/{A}/pack", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["has_example_data"] is True
