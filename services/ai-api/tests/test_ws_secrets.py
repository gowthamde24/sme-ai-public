"""A workspace's own keys (owner decision, 5 Nov 2026): Secret Manager, one secret per workspace and kind (sme-ws-<workspace>-<kind>). "Set up IndiaMART with my key" -> the secure card -> the key goes
straight to POST /assistant/secrets/{request_id} (Owner, 15 minutes, once) -> Secret Manager; the database keeps the name, the last four and a fingerprint. The key is NEVER in a turn, the model's input,
a log, an error or an answer. A pull uses the workspace's own key when it saved one."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest

from app.assistant_work.store import PlanExpiredError, PlanStateError
from app.config import ConfigurationError, Settings
from app.crm.repository import NotFoundError
from app.tenancy.repository import Forbidden
from app.workspace_secrets import (
    FakeSecretStore,
    GcpSecretStore,
    SecretStoreError,
    WorkspaceSecrets,
    clean_value,
    last4,
)
from app.workspace_secrets_wiring import build_workspace_secrets
from tests.aw_fakes import _uid
from tests.fakes import TENANT_A, auth
from tests.test_aw_files import BASE, cards_of, events
from tests.test_aw_router import world

KEY = "mR9xQ2vL7pK4wZ8nB3tY6hJ1cF5gD0sA"   # an invented CRM key
ROUTE = {"decision": "do", "action": "source_key", "args": {"source": "IndiaMART"}}


class FakeRpc:
    """The four database functions, as the migration says (Owner opens and saves, the caller's own request, 15 minutes, once; Owner and Admin read where the key is)."""

    def __init__(self) -> None:
        self.requests: dict[str, dict[str, Any]] = {}
        self.rows: dict[tuple[str, str], dict[str, Any]] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def _gate(self, token: str, roles: tuple[str, ...]) -> str:
        who = _uid(token)
        if who not in roles:
            raise Forbidden("42501")
        return who

    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append((function, args))
        t = args["p_tenant_id"]
        if function == "secret_request_open":
            who = self._gate(token, ("a_owner",))
            rid = str(uuid.uuid4())
            self.requests[rid] = {"tenant": t, "kind": args["p_kind"], "by": who, "expires": datetime.now(UTC) + timedelta(minutes=15), "used": False}
            row = self.rows.get((t, args["p_kind"]))
            return {"request_id": rid, "kind": args["p_kind"], "expires_at": self.requests[rid]["expires"].isoformat(), "saved": {"last4": row["last4"]} if row else None}
        if function == "secret_request_use":
            who = self._gate(token, ("a_owner",))
            r = self.requests.get(args["p_request_id"])
            if r is None or r["tenant"] != t or r["by"] != who:
                raise NotFoundError("23503")
            if r["used"]:
                raise PlanStateError("SM981")
            if r["expires"] <= datetime.now(UTC):
                raise PlanExpiredError("SM982")
            r["used"] = True
            return {"kind": r["kind"], "secret_name": f"sme-ws-{t}-{r['kind'].replace('_key', '')}"}
        if function == "workspace_secret_record":
            self._gate(token, ("a_owner",))
            self.rows[(t, args["p_kind"])] = {"secret_name": args["p_secret_name"], "last4": args["p_last4"], "fingerprint": args["p_fingerprint"]}
            return {"kind": args["p_kind"], "last4": args["p_last4"]}
        raise AssertionError(function)

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        assert function == "workspace_secret_get"
        self._gate(token, ("a_owner", "a_admin"))
        row = self.rows.get((args["p_tenant_id"], args["p_kind"]))
        return dict(row, kind=args["p_kind"]) if row else None


def secrets_world(*answers: Any) -> tuple[Any, Any, FakeRpc, FakeSecretStore]:
    client, llm, *_ = world(*answers)
    rpc, store = FakeRpc(), FakeSecretStore()
    secrets = WorkspaceSecrets("http://rest.invalid", "anon", store, b"test-fp-key", rpc=rpc)  # type: ignore[arg-type]
    object.__setattr__(client.app.state.runtime, "workspace_secrets", secrets)
    return client, llm, rpc, store


def say(client: Any, text: str, user: str = "a_owner") -> list[tuple[str, dict[str, Any]]]:
    body = {"message_id": str(uuid.uuid4()), "conversation_id": None, "text": text, "language": "en"}
    return events(client.post(f"{BASE}/turns", json=body, headers=auth(user)))


def card_for(client: Any) -> dict[str, Any]:
    (card,) = cards_of(say(client, "set up IndiaMART with my key"))
    return card


def save(client: Any, request_id: str, body: Any, user: str = "a_owner") -> Any:
    return client.post(f"{BASE}/secrets/{request_id}", content=json.dumps(body), headers={**auth(user), "Content-Type": "application/json"})


# ============================================================================ the card and the save
def test_set_up_indiamart_with_my_key_is_the_secure_card_and_the_key_goes_to_secret_manager_only() -> None:
    client, llm, rpc, store = secrets_world(ROUTE, ROUTE)
    card = card_for(client)
    assert card["kind"] == "secret" and card["secret"] == "indiamart_key" and card["saved"] is None and uuid.UUID(card["request_id"]) and "CRM key" in card["hint"]
    got = save(client, card["request_id"], {"value": f"  {KEY}  "})
    assert got.status_code == 200 and got.json() == {"saved": True, "last4": KEY[-4:]}, got.text
    name = f"sme-ws-{TENANT_A.id}-indiamart"
    assert store.secrets == {name: [KEY]}, "Secret Manager has it, trimmed, under the workspace's own name"
    row = rpc.rows[(str(TENANT_A.id), "indiamart_key")]
    assert row["secret_name"] == name and row["last4"] == KEY[-4:] and len(row["fingerprint"]) == 16 and KEY not in json.dumps(list(rpc.rows.values())), "the database: where, the last four, a fingerprint"
    again = card_for(client)
    assert again["saved"] == {"last4": KEY[-4:]}, "the next card says a key is saved (its last four only)"


def test_a_request_is_good_once_for_15_minutes_and_only_for_the_owner_who_asked() -> None:
    client, _, rpc, store = secrets_world(ROUTE, ROUTE)
    rid = card_for(client)["request_id"]
    assert save(client, rid, {"value": KEY}).status_code == 200
    used = save(client, rid, {"value": KEY + "x"})
    assert used.status_code == 409 and used.json()["error"]["code"] == "secret_request_used"
    rid2 = card_for(client)["request_id"]
    rpc.requests[rid2]["expires"] = datetime.now(UTC) - timedelta(seconds=1)
    late = save(client, rid2, {"value": KEY})
    assert late.status_code == 410 and late.json()["error"]["code"] == "secret_request_expired"
    assert save(client, str(uuid.uuid4()), {"value": KEY}).status_code == 404
    assert save(client, rid2, {"value": KEY}, user="a_admin").status_code == 403, "Owner only"
    assert store.secrets[f"sme-ws-{TENANT_A.id}-indiamart"] == [KEY]


def test_only_the_owner_gets_the_card() -> None:
    client, *_ = secrets_world(ROUTE)
    evs = say(client, "set up IndiaMART with my key", user="a_admin")
    assert cards_of(evs) == [] and "Only the owner" in "".join(d.get("delta", "") for n, d in evs if n == "text")


def test_a_refused_value_is_never_echoed_and_the_key_is_never_logged_or_in_the_chat(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, llm, _, _ = secrets_world(ROUTE)
    evs = say(client, "set up IndiaMART with my key")
    rid = cards_of(evs)[0]["request_id"]
    bad = "short key with spaces " + KEY
    for body in ({"value": bad}, {"value": KEY, "extra": 1}, {"value": 12345678}, ["x"]):
        r = save(client, rid, body)
        assert r.status_code == 422 and KEY not in r.text and "spaces" not in r.text.split('"message"')[0], r.text
    assert save(client, rid, {"value": KEY}).status_code == 200
    seen = " ".join(rec.getMessage() for rec in caplog.records)
    assert KEY not in seen and KEY[-12:] not in seen, "never in a log line"
    assert all(KEY not in json.dumps(d) for _, d in evs)
    assert all(KEY not in str(r) for r in llm.requests), "never in the model's input"


def test_not_switched_on_says_not_yet_with_the_lead_sources_link() -> None:
    client, *_ = world(ROUTE)
    (card,) = cards_of(say(client, "set up IndiaMART with my key"))
    assert card["kind"] == "cant_do" and card["screen"]["href"] == "/lead-sources"
    assert save(client, str(uuid.uuid4()), {"value": KEY}).status_code == 503


@pytest.mark.parametrize("text", ["set up IndiaMART with my key", "add my IndiaMART CRM key", "connect IndiaMART", "IndiaMART API key is ready"])
def test_the_words_that_route_to_the_card(text: str) -> None:
    from app.assistant_work.router import check, touches

    assert touches(text)
    assert check(ROUTE, text).args == {"source": "indiamart"}
    assert check({**ROUTE, "args": {"source": "JustDial"}}, "set up JustDial with my key").decision == "clarify", "IndiaMART only, for now"


# ============================================================================ the pull with the workspace's own key
def test_a_pull_uses_the_workspaces_own_key_when_it_saved_one(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.lead_sources import indiamart as lsi

    client, _, rpc, store = secrets_world(ROUTE)
    runtime = client.app.state.runtime
    used: list[str] = []

    class Pull:
        def __init__(self, key: str) -> None:
            used.append(key)

    monkeypatch.setattr("app.connectors.indiamart.IndiaMartPull", Pull)
    owner = auth("a_owner")["Authorization"].split(" ", 1)[1]
    with pytest.raises(Exception) as none:   # no key saved and no installation connector: as before (404)
        lsi._source(runtime, owner, TENANT_A.id)  # noqa: SLF001
    assert getattr(none.value, "status_code", None) == 404
    rid = card_for(client)["request_id"]
    assert save(client, rid, {"value": KEY}).status_code == 200
    repo, source = lsi._source(runtime, owner, TENANT_A.id)  # noqa: SLF001
    assert isinstance(source, Pull) and used == [KEY] and repo is runtime.workspace_secrets.connectors
    store.secrets.clear()
    monkeypatch.setattr(store, "access", lambda name: (_ for _ in ()).throw(SecretStoreError("read_refused")))
    with pytest.raises(Exception) as unreadable:
        lsi._source(runtime, owner, TENANT_A.id)  # noqa: SLF001
    assert getattr(unreadable.value, "code", None) == "indiamart_key_unreadable"


# ============================================================================ Secret Manager over REST
def test_secret_manager_create_add_and_destroy_the_older_versions_and_read_back() -> None:
    seen: list[tuple[str, str]] = []
    versions = ["projects/p/secrets/sme-ws-x-indiamart/versions/1"]

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path))
        if "metadata.google.internal" in str(req.url):
            assert req.headers["Metadata-Flavor"] == "Google"
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        assert req.headers["Authorization"] == "Bearer tok"
        if req.method == "POST" and req.url.path.endswith("/secrets"):
            body = json.loads(req.content)
            assert req.url.params["secretId"] == "sme-ws-x-indiamart" and body["replication"]["userManaged"]["replicas"] == [{"location": "asia-south1"}]
            return httpx.Response(409)
        if req.url.path.endswith(":addVersion"):
            assert base64.b64decode(json.loads(req.content)["payload"]["data"]).decode() == KEY
            versions.append("projects/p/secrets/sme-ws-x-indiamart/versions/2")
            return httpx.Response(200, json={"name": versions[-1]})
        if req.method == "GET" and req.url.path.endswith("/versions"):
            return httpx.Response(200, json={"versions": [{"name": v} for v in versions]})
        if req.url.path.endswith(":destroy"):
            return httpx.Response(200, json={})
        if req.url.path.endswith("latest:access"):
            return httpx.Response(200, json={"payload": {"data": base64.b64encode(KEY.encode()).decode()}})
        return httpx.Response(500)

    store = GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(handler)))
    store.put("sme-ws-x-indiamart", KEY)
    assert ("POST", "/v1/projects/p/secrets/sme-ws-x-indiamart/versions/1:destroy") in seen and not any(p.endswith("versions/2:destroy") for _, p in seen), "only the newest key is kept"
    assert store.access("sme-ws-x-indiamart") == KEY and "project" not in repr(store).replace("<project>", "")


def test_secret_manager_refusals_are_closed_words_never_the_key(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)

    def handler(req: httpx.Request) -> httpx.Response:
        if "metadata.google.internal" in str(req.url):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        return httpx.Response(403, json={"error": {"message": f"denied for {KEY}"}})

    store = GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(SecretStoreError) as e:
        store.put("sme-ws-x-indiamart", KEY)
    assert str(e.value) == "create_refused" and KEY not in caplog.text
    no_identity = GcpSecretStore("project-2757c07e", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(404))))
    with pytest.raises(SecretStoreError, match="no_identity"):
        no_identity.access("sme-ws-x-indiamart")


# ============================================================================ small parts
def test_the_value_rules_and_the_last_four() -> None:
    assert clean_value(f" {KEY}\n") == KEY and clean_value("abc") is None and clean_value("has space inside") is None and clean_value(None) is None and clean_value("x" * 201) is None
    assert last4(KEY) == KEY[-4:] and last4("abcd1234") == "", "a short key shows nothing"


def test_the_wiring() -> None:
    assert build_workspace_secrets(Settings(), "http://rest", "anon") is None
    assert build_workspace_secrets(Settings(workspace_secrets="fake"), "http://rest", "anon") is not None
    with pytest.raises(ConfigurationError, match="SUPPRESSION_HMAC_KEY"):
        build_workspace_secrets(Settings(workspace_secrets="gcp", workspace_secrets_project="project-2757c07e-37d2-4167-88f"), "http://rest", "anon")
    with pytest.raises(ConfigurationError, match="project id"):
        build_workspace_secrets(Settings(workspace_secrets="gcp", workspace_secrets_project="Bad Project", suppression_hmac_key="k" * 32), "http://rest", "anon")  # type: ignore[arg-type]
    with pytest.raises(ConfigurationError, match="off, fake or gcp"):
        build_workspace_secrets(Settings(workspace_secrets="vault"), "http://rest", "anon")
