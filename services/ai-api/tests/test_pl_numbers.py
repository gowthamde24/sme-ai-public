"""The Owner's list of phones a test call may go to, masked (10-11 Nov 2026, asked for by the web lane): ids and masks only, the full number never leaves the server; `to_id` places the call."""

# ruff: noqa: E501

from __future__ import annotations

from tests.fakes import TENANT_A, auth, make_client
from tests.test_pl_inbound import OWNER
from tests.test_pl_outbound import outbound_service, placer

LIST = f"/v1/tenants/{TENANT_A.id}/calls/test-numbers"
PLACE = f"/v1/tenants/{TENANT_A.id}/calls/place"
OTHER = "+919876543210"


def world(numbers: frozenset[str] = frozenset({OWNER, OTHER})):  # type: ignore[no-untyped-def]
    out, repo, api = placer(numbers=numbers)
    svc = outbound_service()
    svc.outbound = out
    client, _ = make_client(phone_inbound=svc)
    return client, api


def test_the_list_has_stable_ids_and_masks_and_never_a_full_number() -> None:
    client, _ = world()
    r = client.get(LIST, headers=auth("a_owner"))
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    items = r.json()["items"]
    assert len(items) == 2 and len({i["id"] for i in items}) == 2
    for item in items:
        assert set(item) <= {"id", "masked", "label"} and item["masked"].startswith("+91 ••••• ") and len(item["masked"].rsplit(" ", 1)[1]) == 5
    assert OWNER not in r.text and OTHER not in r.text and OWNER[3:] not in r.text, "no full number, no middle digits"
    assert client.get(LIST, headers=auth("a_owner")).json() == r.json(), "stable between requests"


def test_only_the_owner_sees_the_list_and_an_off_deployment_says_so() -> None:
    client, _ = world()
    for role in ("a_admin", "a_sales", "a_viewer"):
        assert client.get(LIST, headers=auth(role)).status_code == 403
    off, _ = make_client(phone_inbound=outbound_service())
    assert off.get(LIST, headers=auth("a_owner")).status_code == 503


def test_to_id_places_the_call_to_that_number_only() -> None:
    client, api = world()
    items = client.get(LIST, headers=auth("a_owner")).json()["items"]
    for item in items:
        r = client.post(PLACE, json={"to_id": item["id"], "goal": "Ask whether the saree order has arrived and book a visit."}, headers=auth("a_owner"))
        assert r.status_code == 202, r.text
    assert sorted(c["to"] for c in api.placed) == sorted([OWNER, OTHER])


def test_an_unknown_id_or_both_or_neither_is_a_form_error() -> None:
    client, api = world()
    r = client.post(PLACE, json={"to_id": "0" * 16}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error" and r.json()["error"]["fields"] == ["to_id"]
    good = client.get(LIST, headers=auth("a_owner")).json()["items"][0]["id"]
    assert client.post(PLACE, json={"to": OWNER, "to_id": good}, headers=auth("a_owner")).status_code == 422
    assert client.post(PLACE, json={}, headers=auth("a_owner")).status_code == 422
    assert api.placed == []
    assert client.post(PLACE, json={"to": OWNER}, headers=auth("a_owner")).status_code == 202, "a typed number still works (the gate decides)"


def test_the_ids_differ_between_deployments_so_they_cannot_be_looked_up_elsewhere() -> None:
    a, _ = world()
    b, _ = world()
    assert a.get(LIST, headers=auth("a_owner")).json() != b.get(LIST, headers=auth("a_owner")).json()
