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
    world.graph.granted_wabas[BODY["code"]] = {WABA}   # the signup shared this account with us
    world.graph.app_token = "1407102551140162|app-secret-for-tests"
    world.graph.waba_phones[WABA] = {PNID}   # ... and this number belongs to it
    return world


def test_the_browser_gets_only_public_ids_and_only_when_it_can_connect(w: World) -> None:
    got = w.call("GET", T + "/whatsapp/connect/config", "a_owner").json()
    assert got == {"available": True, "app_id": "1407102551140162", "config_id": "999000111222", "graph_version": "v25.0", "missing": [], "onboarding_types": ["cloud_api", "coexistence"],
                   "embedded_version": "v5", "launch_extras": {"setup": {}, "version": "v5"}}
    assert w.call("GET", T + "/whatsapp/connect/config", "a_sales").status_code == 403
    bare = World(configured=False)
    out = bare.call("GET", T + "/whatsapp/connect/config", "a_owner").json()
    assert out["available"] is False and "app_id" in out["missing"] and "config_id" in out["missing"], "it says WHAT is missing (closed words), so the owner knows what is pending"


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


def test_a_signup_that_did_not_share_this_account_cannot_claim_it(w: World) -> None:
    """18 Nov 2026: the code proves the signup was ours, debug_token proves WHICH accounts it shared: another business's account our platform token happens to reach cannot be claimed."""
    w.repo.account = None
    other = w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "waba_id": "100000000000999"})
    assert other.status_code == 409 and other.json()["error"]["code"] == "whatsapp_signup_invalid"
    w.graph.granted_wabas[BODY["code"]] = set()   # a signup that shared nothing
    nothing = w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert nothing.status_code == 409 and nothing.json()["error"]["code"] == "whatsapp_signup_invalid"
    assert w.repo.account is None and w.graph.subscribed == set(), "nothing recorded, nothing subscribed"


def test_the_code_is_required(w: World) -> None:
    w.repo.account = None
    r = w.call("POST", T + "/whatsapp/connect", "a_owner", {"waba_id": WABA, "phone_number_id": PNID})
    assert r.status_code == 422 and w.repo.account is None, "the code is part of the contract now"


def test_a_connection_that_cannot_be_recorded_takes_its_subscription_back(w: World, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr(w.repo, "account_save", boom)
    with pytest.raises(RuntimeError):
        w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert WABA not in w.graph.subscribed, "subscribed but not recorded: the subscription is taken back"


def test_a_number_that_is_not_on_the_account_the_signup_shared_cannot_be_claimed(w: World) -> None:
    """Review of 18 Nov: the shared account proves nothing about ANOTHER business's number our platform token also reaches."""
    w.repo.account = None
    victim = "200000000000555"
    w.graph.phones[victim] = {"display_phone_number": "+91 90000 11111", "verified_name": "Someone Else"}
    w.graph.waba_phones["100000000000444"] = {victim}   # the victim's own account, not the one this signup shared
    r = w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "phone_number_id": victim})
    assert r.status_code == 409 and r.json()["error"]["code"] == "whatsapp_no_access" and w.repo.account is None and w.graph.subscribed == {WABA} - {WABA}


def test_an_expired_foreign_or_malformed_token_inspection_refuses(w: World) -> None:
    w.repo.account = None
    w.graph.app_token = "999|another-secret"   # Meta says the app credential is not ours: debug_token fails
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", BODY).json()["error"]["code"] == "whatsapp_signup_invalid"
    w.graph.app_token = "1407102551140162|app-secret-for-tests"
    for odd in ({"data": ["not", "a", "dict"]}, {"data": {"is_valid": False, "app_id": "1407102551140162", "granular_scopes": [{"scope": "whatsapp_business_management", "target_ids": [WABA]}]}},
                {"data": {"is_valid": True, "app_id": "999", "granular_scopes": [{"scope": "whatsapp_business_management", "target_ids": [WABA]}]}},
                {"data": {"is_valid": True, "app_id": "1407102551140162", "granular_scopes": [{"scope": "whatsapp_business_management", "target_ids": WABA}]}}, {"error": {"code": 190}}):
        w.graph.debug_override = odd
        r = w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
        assert r.status_code == 409 and r.json()["error"]["code"] == "whatsapp_signup_invalid", odd   # expired, another app's, a bare string of ids, an error body: a clean refusal, never a 500
    assert w.repo.account is None and w.graph.subscribed == set()


def test_a_reconnect_that_fails_to_record_keeps_the_live_subscription(w: World, monkeypatch: pytest.MonkeyPatch) -> None:
    w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert WABA in w.graph.subscribed

    def boom(*a: object, **k: object) -> None:
        raise RuntimeError("db down")

    monkeypatch.setattr(w.repo, "account_save", boom)
    with pytest.raises(RuntimeError):
        w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert WABA in w.graph.subscribed, "an already connected business keeps its subscription when a second attempt fails"


def test_a_number_kept_on_the_whatsapp_business_app_is_recorded_as_coexistence_and_the_default_is_cloud_api(w: World) -> None:
    """Planner, 19 Nov 2026: the browser says which Meta event ended the signup; the app-onboarding one means the shop keeps its WhatsApp Business app on this number."""
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", BODY).status_code == 200
    assert w.repo.account is not None and w.repo.account["coexistence"] is False, "without the field: cloud_api, as before"
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "coexistence": True}).status_code == 200
    assert w.repo.account is not None and w.repo.account["coexistence"] is True
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", {**BODY, "coexistence": "yes please"}).status_code == 422, "a typed boolean, nothing else"


def test_a_version_5_payload_names_the_account_by_messaging_account_ids_and_the_number_is_found(w: World) -> None:
    """Embedded Signup v5 (20 Oct 2026): `messaging_account_ids` instead of `waba_id`, `is_on_biz_app` instead of the event name; the number may not be named: the account's only number is used."""
    body = {"messaging_account_ids": ["999999999999999", WABA], "code": BODY["code"], "is_on_biz_app": True}
    r = w.call("POST", T + "/whatsapp/connect", "a_owner", body)
    assert r.status_code == 200, r.text
    account = w.repo.account
    assert account is not None and account["waba_id"] == WABA and account["phone_number_id"] == PNID and account["coexistence"] is True, "the shared account, its one number, coexistence from is_on_biz_app"
    w.repo.account = None
    foreign = w.call("POST", T + "/whatsapp/connect", "a_owner", {"messaging_account_ids": ["999999999999999"], "code": BODY["code"]})
    assert foreign.status_code == 409 and foreign.json()["error"]["code"] == "whatsapp_signup_invalid" and w.repo.account is None, "an account the signup did not share is refused"
    w.graph.waba_phones[WABA] = {PNID, "200000000000999"}
    two = w.call("POST", T + "/whatsapp/connect", "a_owner", {"messaging_account_ids": [WABA], "code": BODY["code"]})
    assert two.status_code == 409 and two.json()["error"]["code"] == "whatsapp_no_access", "two numbers and none named: we do not guess"
    none = w.call("POST", T + "/whatsapp/connect", "a_owner", {"code": BODY["code"]})
    assert none.status_code == 422, "an account id is required"


def test_the_launch_extras_follow_the_version_of_the_configuration(w: World) -> None:
    from app.whatsapp.routes import _launch_extras

    assert _launch_extras("v5") == {"setup": {}, "version": "v5"}
    assert _launch_extras("v4") == {"setup": {}, "featureType": "whatsapp_business_app_onboarding", "sessionInfoVersion": "3"}


# ---- 19-20 Nov 2026 (owner's standing OK): our templates go to the connected account for review as soon as Connect worked
def test_after_connect_the_catalogue_is_made_and_every_draft_goes_to_the_connected_account_for_review(w: World) -> None:
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", BODY).status_code == 200
    templates = w.call("GET", T + "/whatsapp/templates", "a_owner").json()["templates"]
    assert len(templates) == 42 and {t["status"] for t in templates} == {"submitted"}, "every English and Telugu catalogue message (24 new + the first set) was sent for review, nothing of theirs stays a draft"
    assert len(w.graph.templates_created) == 42
    assert {t["language"] for t in templates} == {"en", "te"}, "only the languages a native reader has checked"
    assert not any(t["name"] in ("payment_reminder", "consent_ask", "platform_alert") for t in templates), "the hidden and the owner-gated ones are never sent automatically"


def test_connecting_again_sends_nothing_twice(w: World) -> None:
    w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    before = len(w.graph.templates_created)
    w.call("POST", T + "/whatsapp/connect", "a_owner", BODY)
    assert len(w.graph.templates_created) == before


def test_the_switch_off_sends_nothing_and_a_stop_in_meta_never_fails_the_connect(w: World) -> None:
    object.__setattr__(w.runtime, "auto_templates", False)
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", BODY).status_code == 200
    assert w.graph.templates_created == [] and w.call("GET", T + "/whatsapp/templates", "a_owner").json()["templates"] == []
    object.__setattr__(w.runtime, "auto_templates", True)
    w.repo.account = None

    def boom(*a: object, **k: object) -> object:
        raise RuntimeError("meta exploded")

    object.__setattr__(w.graph, "create_template", boom)
    assert w.call("POST", T + "/whatsapp/connect", "a_owner", BODY).status_code == 200, "the connect stands: the owner can press 'Send drafts to WhatsApp for review'"
