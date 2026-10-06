"""T008 commit 5, on the real stack: the whole review flow through OUR API. A person pastes an enquiry (stripped and scrubbed before it is stored),
a requirement run proposes fields, a person confirms / corrects / rejects / adds fields, the screen's view shows flags and derived questions, the
requirement is confirmed on type + quantity alone and requirement_v1 then shows exactly the accepted fields. Roles, tenants and the fixed
errors are checked on every step."""

# ruff: noqa: E501, S608, F811

from __future__ import annotations

import time
from typing import Any

import pytest
from conftest import bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from test_requirement_e2e import (
    api,  # noqa: F401  (the module fixture: the API with agents on and the requirement agent enabled)
)

RAW = (
    "Hello,​\nNeed  20 kanjivaram   sarees in red and 10 banarasi sarees in blue.\n"
    "Deliver to Hyderabad by 15 November 2026. Budget Rs 5,000 per piece. 30 days credit please.\n"
    "Call me on +91 98765 43210 or write to buyer@example.com. GSTIN 29ABCDE1234F1Z5."
)


def lead_of(t: Tenant) -> str:
    return str(t.rows["leads"]["id"])


def capture(
    client: TestClient, t: Tenant, text: str = RAW, user: str = "sales", **over: Any
) -> Any:
    body = {
        "id": uid(),
        "channel": "whatsapp",
        "received_at": "2026-10-05T10:00:00+00:00",
        "text": text,
        **over,
    }
    return client.post(
        f"/v1/tenants/{t.id}/leads/{lead_of(t)}/enquiries", json=body, headers=bearer(t.users[user])
    )


def view(client: TestClient, t: Tenant, enquiry: str, user: str = "viewer") -> dict[str, Any]:
    r = client.get(
        f"/v1/tenants/{t.id}/enquiries/{enquiry}/requirement", headers=bearer(t.users[user])
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def run_agent(client: TestClient, t: Tenant, enquiry: str) -> dict[str, Any]:
    r = client.post(
        f"/v1/tenants/{t.id}/agent-runs",
        json={"id": uid(), "agent": "requirement", "target_kind": "enquiry", "target_id": enquiry},
        headers=bearer(t.users["sales"]),
    )
    assert r.status_code == 202, r.text
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        run = client.get(
            f"/v1/tenants/{t.id}/agent-runs/{r.json()['id']}", headers=bearer(t.users["sales"])
        ).json()
        if run["status"] != "running":
            assert run["status"] == "succeeded", run
            return dict(run)
        time.sleep(0.2)
    pytest.fail("the run did not finish")


def decide(
    client: TestClient, t: Tenant, field: str, body: dict[str, Any], user: str = "sales"
) -> Any:
    return client.post(
        f"/v1/tenants/{t.id}/requirement-fields/{field}/decision",
        json=body,
        headers=bearer(t.users[user]),
    )


def by_key(v: dict[str, Any]) -> dict[tuple[int | None, str], dict[str, Any]]:
    return {(f["line_no"], f["field_key"]): f for f in v["fields"]}


def test_the_whole_flow_from_paste_to_a_confirmed_requirement(
    api: tuple[TestClient, World],
) -> None:  # noqa: F811
    client, w = api
    t = w.a
    # 1. paste: the contact details and the invisible character never reach the database
    r = capture(client, t)
    assert r.status_code == 201, r.text
    out = r.json()
    eid = out["enquiry"]["id"]
    assert out["text_changed"] is True and out["truncated"] is False
    body = out["enquiry"]["body"]
    assert (
        "98765" not in body
        and "buyer@example.com" not in body
        and "​" not in body
        and body.count("[contact removed]") == 2
    )
    assert "GSTIN 29ABCDE1234F1Z5" in body and "Rs 5,000" in body and "15 November 2026" in body
    stored = pg(
        w.stack, t.users["owner"], "GET", f"/enquiries?id=eq.{eid}&select=body,subject"
    ).json()
    assert stored == [{"body": body, "subject": None}]
    again = client.post(
        f"/v1/tenants/{t.id}/leads/{lead_of(t)}/enquiries",
        json={
            "id": eid,
            "channel": "whatsapp",
            "received_at": "2026-10-05T10:00:00+00:00",
            "text": RAW,
        },
        headers=bearer(t.users["sales"]),
    )
    assert (
        again.status_code == 200 and again.json()["enquiry"]["id"] == eid
    )  # an exact retry is a replay
    listed = client.get(
        f"/v1/tenants/{t.id}/leads/{lead_of(t)}/enquiries", headers=bearer(t.users["viewer"])
    ).json()
    assert eid in [e["id"] for e in listed]

    # 2. nothing proposed yet: everything is asked
    v0 = view(client, t, eid)
    assert (
        v0["requirement"] is None
        and v0["confirmable"] is False
        and v0["questions"][0]["code"] == "missing_saree_type"
    )

    # 3. the agent proposes; every proposal is unreviewed
    run_agent(client, t, eid)
    v1 = view(client, t, eid)
    assert (
        v1["requirement"]["status"] == "draft"
        and v1["confirmable"] is False
        and v1["ready_for_quote"] is False
    )
    fields = by_key(v1)
    assert (
        fields[(1, "saree_type")]["display"] == "Kanjivaram"
        and fields[(1, "quantity")]["display"] == "20 pieces"
    )
    assert (
        fields[(None, "budget")]["display"] == "Rs 5,000 per piece"
        and fields[(None, "deadline")]["display"] == "15 November 2026"
    )
    assert all(f["state"] == "proposed" and f["created_via"] == "agent" for f in v1["fields"])
    assert {q["code"] for q in v1["questions"]} == set() or all(
        q["code"].startswith(("missing_", "confirm_")) for q in v1["questions"]
    )

    # 4. roles: a viewer reads and cannot decide; another workspace sees nothing
    assert (
        decide(
            client, t, fields[(1, "saree_type")]["id"], {"decision": "confirm"}, "viewer"
        ).status_code
        == 403
    )
    assert (
        decide(
            client, w.b, fields[(1, "saree_type")]["id"], {"decision": "confirm"}, "sales"
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/v1/tenants/{w.b.id}/enquiries/{eid}/requirement", headers=bearer(w.b.users["viewer"])
        ).status_code
        == 404
    )

    # 5. a person decides: confirm the type, CORRECT the quantity in their own words, reject the city
    assert (
        decide(client, t, fields[(1, "saree_type")]["id"], {"decision": "confirm"}).json()["state"]
        == "confirmed"
    )
    corrected = decide(
        client, t, fields[(1, "quantity")]["id"], {"decision": "correct", "value": "2 dozen"}
    )
    assert corrected.status_code == 200 and corrected.json()["state"] == "corrected"
    refused = decide(
        client,
        t,
        fields[(1, "quantity")]["id"],
        {"decision": "correct", "value": "ten thousand and one pieces please"},
    )
    assert refused.status_code == 422 and "ten thousand" not in refused.text
    over = decide(
        client, t, fields[(1, "quantity")]["id"], {"decision": "correct", "value": "10001"}
    )
    assert over.status_code == 422 and over.json()["error"]["code"] == "value_not_accepted"
    assert (
        decide(client, t, fields[(None, "delivery_city")]["id"], {"decision": "reject"}).json()[
            "state"
        ]
        == "rejected"
    )
    v2 = view(client, t, eid)
    assert (
        by_key(v2)[(1, "quantity")]["display"] == "24 pieces"
        and by_key(v2)[(1, "quantity")]["state"] == "corrected"
    )
    assert (
        v2["confirmable"] is True and v2["ready_for_quote"] is False
    )  # the city is rejected; the deadline and payment terms are only proposed
    assert ("missing", "delivery_city") in {(f["kind"], f["field_key"]) for f in v2["flags"]}
    assert "missing_delivery_city" in {q["code"] for q in v2["questions"]}

    # 6. a rejected slot is not "added to": a person CORRECTS the rejected field instead (the slot holds one field); a quote that is not in the text is refused
    add_url = f"/v1/tenants/{t.id}/enquiries/{eid}/requirement-fields"
    taken = client.post(
        add_url,
        json={"field": "delivery_city", "value": "Hyderabad", "quote": "Deliver to Hyderabad"},
        headers=bearer(t.users["sales"]),
    )
    assert taken.status_code == 422 and taken.json()["error"]["code"] == "invalid_value"
    assert (
        client.post(
            add_url,
            json={"field": "delivery_city", "value": "Pune", "quote": "not in the text"},
            headers=bearer(t.users["sales"]),
        ).json()["error"]["code"]
        == "quote_not_found"
    )
    assert (
        decide(
            client,
            t,
            fields[(None, "delivery_city")]["id"],
            {"decision": "correct", "value": "Hyderabad"},
        ).json()["state"]
        == "corrected"
    )
    assert (
        view(client, t, eid)["confirmable"] is True
        and view(client, t, eid)["ready_for_quote"] is False
    )
    for key in ((None, "deadline"), (None, "payment_terms"), (2, "saree_type"), (2, "quantity")):
        assert decide(client, t, fields[key]["id"], {"decision": "confirm"}).status_code == 200
    v3 = view(client, t, eid)
    assert v3["confirmable"] is True and v3["ready_for_quote"] is True, v3[
        "flags"
    ]  # the stricter flag: city, deadline and payment terms too

    # 7. confirm: type + quantity are enough; the viewer cannot
    rid = v2["requirement"]["id"]
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["viewer"])
        ).status_code
        == 403
    )
    done = client.post(
        f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["sales"])
    )
    assert done.status_code == 200 and done.json()["status"] == "confirmed", done.text
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["owner"])
        ).json()["replayed"]
        is True
    )
    frozen = decide(client, t, fields[(None, "deadline")]["id"], {"decision": "confirm"})
    assert frozen.status_code == 409 and frozen.json()["error"]["code"] == "requirement_not_draft"
    again_run = client.post(
        f"/v1/tenants/{t.id}/agent-runs",
        json={"id": uid(), "agent": "requirement", "target_kind": "enquiry", "target_id": eid},
        headers=bearer(t.users["sales"]),
    )
    assert (
        again_run.status_code == 409
        and again_run.json()["error"]["code"] == "requirement_confirmed"
    )

    # 8. requirement_v1: exactly the accepted fields of the confirmed requirement
    contract = pg(
        w.stack,
        t.users["viewer"],
        "GET",
        f"/requirement_v1?requirement_id=eq.{rid}&select=field_key,line_no,value_code,value_int,state",
    ).json()
    assert {(c["field_key"], c["line_no"]) for c in contract} == {
        ("saree_type", 1),
        ("quantity", 1),
        ("saree_type", 2),
        ("quantity", 2),
        ("delivery_city", None),
        ("deadline", None),
        ("payment_terms", None),
    }
    assert next(c for c in contract if c["field_key"] == "quantity")["value_int"] == 24
    assert (
        pg(
            w.stack,
            w.b.users["owner"],
            "GET",
            f"/requirement_v1?requirement_id=eq.{rid}&select=field_key",
        ).json()
        == []
    )

    # 9. discard, and the enquiry can be extracted again
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{rid}/discard", headers=bearer(t.users["sales"])
        ).json()["status"]
        == "discarded"
    )
    assert view(client, t, eid)["requirement"] is None
    run_agent(client, t, eid)
    assert view(client, t, eid)["requirement"]["status"] == "draft"


def test_a_manual_field_added_to_a_draft_is_theirs_and_makes_it_confirmable(
    api: tuple[TestClient, World],
) -> None:  # noqa: F811
    client, w = api
    t = w.a
    eid = capture(client, t, "Need 5 paithani sarees to Pune by 20 November 2026").json()[
        "enquiry"
    ]["id"]
    base = f"/v1/tenants/{t.id}/enquiries/{eid}/requirement-fields"
    h = bearer(t.users["sales"])
    r1 = client.post(
        base,
        json={"line": 1, "field": "saree_type", "value": "Paithani", "quote": "paithani"},
        headers=h,
    )
    r2 = client.post(
        base,
        json={"line": 1, "field": "quantity", "value": "5", "quote": "Need 5 paithani"},
        headers=h,
    )
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    v = view(client, t, eid)
    assert v["requirement"]["created_via"] == "manual" and v["confirmable"] is True
    assert all(f["state"] == "corrected" and f["created_via"] == "manual" for f in v["fields"])
    assert (
        client.post(
            base,
            json={"line": 1, "field": "saree_type", "value": "Paithani", "quote": "paithani"},
            headers=h,
        ).json()["replayed"]
        is True
    )
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{v['requirement']['id']}/confirm", headers=h
        ).json()["status"]
        == "confirmed"
    )
    after = client.post(base, json={"field": "delivery_city", "value": "Pune"}, headers=h)
    assert after.status_code == 409 and after.json()["error"]["code"] == "requirement_confirmed"
    # small fix A1: an EXACT retry of a typed field replays even now; anything else is still refused
    exact = {"line": 1, "field": "saree_type", "value": "Paithani", "quote": "paithani"}
    again = client.post(base, json=exact, headers=h)
    assert again.status_code == 200 and again.json()["replayed"] is True
    qty = client.post(
        base,
        json={"line": 1, "field": "quantity", "value": "5", "quote": "Need 5 paithani"},
        headers=h,
    )
    assert qty.status_code == 200 and qty.json()["replayed"] is True
    assert again.json()["requirement_id"] == v["requirement"]["id"]
    changed = client.post(base, json={**exact, "value": "Banarasi"}, headers=h)
    assert changed.status_code == 409 and changed.json()["error"]["code"] == "requirement_confirmed"
    other_quote = client.post(base, json={**exact, "quote": "Need 5 paithani"}, headers=h)
    assert other_quote.status_code == 409, "the same value with another quote is not an exact retry"
    # another person's identical write is not THEIR retry
    admin = client.post(base, json=exact, headers=bearer(t.users["admin"]))
    assert admin.status_code == 409 and admin.json()["error"]["code"] == "requirement_confirmed"
    # a viewer, another workspace's owner and nobody: refused as before
    assert client.post(base, json=exact, headers=bearer(t.users["viewer"])).status_code == 403
    assert client.post(base, json=exact, headers=bearer(w.b.users["owner"])).status_code == 404
    assert client.post(base, json=exact).status_code == 401
    # the retry added nothing
    assert len(view(client, t, eid)["fields"]) == 2


def test_what_capture_refuses_and_hides(api: tuple[TestClient, World]) -> None:  # noqa: F811
    client, w = api
    t = w.a
    assert capture(client, t, "​ ​").status_code == 422
    assert capture(client, t, "ok", user="viewer").status_code == 403
    assert capture(client, w.b, "ok", user="sales").status_code in (200, 201)
    foreign = client.post(
        f"/v1/tenants/{w.b.id}/leads/{lead_of(t)}/enquiries",
        json={
            "id": uid(),
            "channel": "email",
            "received_at": "2026-10-05T10:00:00+00:00",
            "text": "x",
        },
        headers=bearer(w.b.users["sales"]),
    )
    assert foreign.status_code == 404  # tenant A's lead does not exist for tenant B
    long = capture(client, t, "word " * 4000)
    assert (
        long.status_code == 201
        and long.json()["truncated"] is True
        and len(long.json()["enquiry"]["body"]) <= 6000
    )
    indic = capture(client, t, "నమస్కారం 20 సారీలు క్‌ష కావాలి")
    assert indic.status_code == 201 and "‌" not in indic.json()["enquiry"]["body"]


def _post_field(
    client: TestClient, t: Tenant, eid: str, body: dict[str, Any], user: str = "sales"
) -> Any:
    return client.post(
        f"/v1/tenants/{t.id}/enquiries/{eid}/requirement-fields",
        json=body,
        headers=bearer(t.users[user]),
    )


def test_an_exact_retry_on_a_confirmed_requirement_is_matched_on_every_part_of_the_field(
    api: tuple[TestClient, World],
) -> None:  # noqa: F811
    """Small fix A1, mutation pass: the replay compares the slot (key AND line), the person, the value (code, number, basis, text) and the quote. Any difference is refused."""
    client, w = api
    t = w.a
    eid = capture(client, t, "Need 5 paithani sarees for Pune. Banarasi too.").json()["enquiry"][
        "id"
    ]
    fields: list[dict[str, Any]] = [
        {"line": 1, "field": "saree_type", "value": "Paithani", "quote": "paithani"},
        {"line": 1, "field": "quantity", "value": "5", "quote": "Need 5 paithani"},
        {"line": 2, "field": "saree_type", "value": "Banarasi", "quote": "Banarasi"},
        {"field": "delivery_city", "value": "Pune", "quote": "Pune"},
    ]
    for f in fields:
        assert _post_field(client, t, eid, f).status_code == 200, f
    rid = view(client, t, eid)["requirement"]["id"]
    done = client.post(
        f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["sales"])
    )
    assert done.json()["status"] == "confirmed"
    for f in fields:
        again = _post_field(client, t, eid, f)
        assert again.status_code == 200 and again.json()["replayed"] is True, f
    refused: list[dict[str, Any]] = [
        {
            "line": 1,
            "field": "saree_type",
            "value": "Banarasi",
            "quote": "paithani",
        },  # another value
        {
            "line": 1,
            "field": "quantity",
            "value": "6",
            "quote": "Need 5 paithani",
        },  # another number
        {
            "line": 1,
            "field": "quantity",
            "value": "5 sets",
            "quote": "Need 5 paithani",
        },  # the same number, another basis
        {"field": "delivery_city", "value": "Mumbai", "quote": "Pune"},  # another text
        {
            "line": 1,
            "field": "saree_type",
            "value": "Paithani",
            "quote": "Need 5 paithani",
        },  # another quote
        {"line": 1, "field": "saree_type", "value": "Paithani"},  # no quote at all
        {
            "line": 2,
            "field": "saree_type",
            "value": "Paithani",
            "quote": "paithani",
        },  # another LINE: line 1 holds this value, line 2 holds another
        {
            "line": 3,
            "field": "saree_type",
            "value": "Paithani",
            "quote": "paithani",
        },  # a slot that does not exist
        {"field": "budget", "value": "Rs 500 per piece"},  # another key
    ]
    for f in refused:
        r = _post_field(client, t, eid, f)
        assert r.status_code == 409 and r.json()["error"]["code"] == "requirement_confirmed", f
    assert len(view(client, t, eid)["fields"]) == 4, "no retry added anything"


def test_an_exact_retry_with_the_same_span_replays_and_another_span_of_the_same_words_does_not(
    api: tuple[TestClient, World],
) -> None:  # noqa: F811
    """The API finds the span itself, so a different span of the same words reaches the database only through its own function: the database must still refuse it."""
    from quote_support import rpc

    client, w = api
    t = w.a
    body = "Hello.   Need 5 paithani   sarees. Paithani again, to Pune."
    eid = capture(client, t, body).json()["enquiry"]["id"]
    token = t.users["sales"].token

    def add(key: str, line: int | None, start: int, end: int, **value: Any) -> Any:
        return rpc(
            w,
            token,
            "add_requirement_field",
            p_enquiry_id=eid,
            p_line=line,
            p_key=key,
            p_quote=body[start:end],
            p_start=start,
            p_end=end,
            **value,
        )

    first = body.index("paithani")
    second = body.index("Paithani again")
    r1 = add("saree_type", 1, first, first + 8, p_value_code="paithani")
    assert r1.status_code == 200 and r1.json()["replayed"] is False, r1.text
    start = body.index("Need")
    r2 = add("quantity", 1, start, start + 15, p_value_int=5, p_basis="piece")
    assert r2.status_code == 200, r2.text
    rid = r1.json()["requirement_id"]
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["sales"])
        ).json()["status"]
        == "confirmed"
    )
    same = add("saree_type", 1, first, first + 8, p_value_code="paithani")
    assert same.status_code == 200 and same.json()["replayed"] is True
    other = add(
        "saree_type", 1, second, second + 8, p_value_code="paithani"
    )  # "Paithani": the words (case aside) of the same field, at the other place
    assert other.status_code != 200, "another span is not an exact retry"
    # the same words with only the START moved (over spaces the quote ignores), or only the END: the quote's text is the same but it is not the same field
    exact = add("quantity", 1, start, start + 15, p_value_int=5, p_basis="piece")
    assert exact.status_code == 200 and exact.json()["replayed"] is True
    assert (
        add("quantity", 1, start - 3, start + 15, p_value_int=5, p_basis="piece").status_code != 200
    )
    assert add("quantity", 1, start, start + 18, p_value_int=5, p_basis="piece").status_code != 200
    earlier = add("saree_type", 1, first, first + 8, p_value_code="paithani")
    assert earlier.json()["replayed"] is True


def test_a_field_an_agent_proposed_and_a_person_confirmed_is_not_the_persons_own_retry(
    api: tuple[TestClient, World],
) -> None:  # noqa: F811
    """A person who CONFIRMED an agent's field did not type it: writing the same content again after the requirement is confirmed is refused, not replayed."""
    client, w = api
    t = w.a
    eid = capture(client, t).json()["enquiry"]["id"]
    run_agent(client, t, eid)
    fields = by_key(view(client, t, eid))
    saree, qty = fields[(1, "saree_type")], fields[(1, "quantity")]
    for f in (saree, qty):
        assert decide(client, t, f["id"], {"decision": "confirm"}).status_code == 200
    rid = view(client, t, eid)["requirement"]["id"]
    assert (
        client.post(
            f"/v1/tenants/{t.id}/requirements/{rid}/confirm", headers=bearer(t.users["sales"])
        ).json()["status"]
        == "confirmed"
    )
    assert saree["created_via"] == "agent"
    same = _post_field(
        client,
        t,
        eid,
        {
            "line": 1,
            "field": "saree_type",
            "value": saree["value"]["code"],
            "quote": saree["quote"],
        },
    )
    assert same.status_code == 409 and same.json()["error"]["code"] == "requirement_confirmed", (
        same.text
    )
