"""W3: "Connect WhatsApp" with Embedded Signup. The browser sends the account and number the shop picked (and the short code); we check the signup, reach the number with our own token, subscribe our app to the
account's webhooks and record the account for THIS business. Fake Graph only, no network."""

# ruff: noqa: E501

from __future__ import annotations

import httpx
import pytest

from app.whatsapp.graph import GraphClient
from app.whatsapp.runtime import WhatsAppRuntime
from tests.fakes import auth, make_client
from tests.test_whatsapp_routes import T, World

WABA, PNID = "100000000000777", "200000000000888"
BODY = {"waba_id": WABA, "phone_number_id": PNID, "code": "AQB-code-from-meta-0123456789"}


@pytest.fixture
def w() -> World:
    world = World(configured=True)
    object.__setattr__(world.runtime, "app_id", "1407102551140162")
    object.__setattr__(world.runtime, "config_id", "999000111222")
    object.__setattr__(world.runtime, "app_secret", world.runtime.app_secret or "app-secret-for-tests")
    object.__setattr__(world.runtime, "tokens", type(world.runtime.tokens)("platform-token", {"shop_a": "fake-token"}))
    world.graph.tokens.add("platform-token")
    world.graph.phones[PNID] = {"display_phone_number": "+91 98765 43210", "verified_name": "Synthetic Silks"}
    world.graph.valid_codes.add(BODY["code"])
    return world


def test_the_browser_gets_only_public_ids_and_only_when_it_can_connect(w: World) -> None:
    got = w.call("GET", T + "/whatsapp/connect/config", "a_owner").json()
    assert got == {"available": True, "app_id": "1407102551140162", "config_id": "999000111222", "graph_version": "v25.0"}
    assert w.call("GET", T + "/whatsapp/connect/config", "a_sales").status_code == 403
    bare = World(configured=False)
    assert bare.call("GET", T + "/whatsapp/connect/config", "a_owner").json()["available"] is False


def test_connecting_checks_the_signup_reaches_the_number_subscribes_and_records_the_account(w: World) -> None:
    r = w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert r.status_code == 200, r.text
    assert r.json() == {"connected": True, "display_phone": "+91 98765 43210", "verified_name": "Synthetic Silks", "status": "active"}
    assert WABA in w.graph.subscribed, "our app is subscribed to the shop's account"
    account = w.repo.account
    assert account is not None and account["waba_id"] == WABA and account["phone_number_id"] == PNID and account["token_ref"] == "default"
    assert "platform-token" not in r.text and "AQB" not in r.text, "no token and no code comes back"


def test_every_failure_records_nothing(w: World) -> None:
    w.repo.account = None
    bad_code = w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "code": "AQB-another-code-0123456789"})
    assert bad_code.status_code == 409 and bad_code.json()["error"]["code"] == "whatsapp_signup_invalid"
    no_access = w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "phone_number_id": "200000000000999"})
    assert no_access.status_code == 409 and no_access.json()["error"]["code"] == "whatsapp_no_access"
    assert w.repo.account is None and w.graph.subscribed == set()


def test_roles_validation_and_not_configured(w: World) -> None:
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert w.call("POST", T + "/whatsapp/connect", user, BODY).status_code == 403
    assert w.call("POST", T + "/whatsapp/connect", None, BODY).status_code == 401
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "waba_id": "abc"}).status_code == 422
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "extra": 1}).status_code == 422
    bare = World(configured=False)
    assert bare.call("POST", T + "/whatsapp/connect", "a_owner", BODY).json()["error"]["code"] == "whatsapp_not_configured"


def test_disconnect_disables_first_then_unsubscribes(w: World) -> None:
    w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert WABA in w.graph.subscribed
    r = w.call("POST", T + "/whatsapp/disconnect", "a_owner")
    assert r.status_code == 200 and r.json() == {"connected": False, "status": "disabled"}
    assert WABA not in w.graph.subscribed
    assert w.call("POST", T + "/whatsapp/disconnect", "a_admin").status_code == 403


def test_the_runtime_has_no_secret_in_its_repr() -> None:
    text = repr(WhatsAppRuntime(repository=None, app_secret="s3cret-value", app_id="1", config_id="2"))   # type: ignore[arg-type]
    assert "s3cret-value" not in text
    _ = (GraphClient, httpx, make_client, auth)
