"""T009 step 3, on the real stack: the quote API end to end through OUR application (real JWT verification, real PostgREST, real database functions, the REAL pinned engine,
mapper and text renderer).

Every new read and every new write is exercised here with the people who may and may not use it:
  reads  : quote-setup, the enquiry's quotes, the tenant's quotes, one quote, the customer text;
  writes : pick, create a draft, approve, reject, withdraw.
Who may do what is checked on each: a Viewer is refused every quote read (403), a Sales user cannot approve or withdraw (403), an Owner or Admin without a second factor gets
mfa_required, an Admin gets owner_approval_required on a flagged quote, and a second tenant's owner sees nothing (404 / an empty list). Nothing here sends anything.
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
from typing import Any

import operator_sql
import pytest
from conftest import aal1_token, bearer
from crm_support import World
from evidence_support import pg, uid
from fastapi.testclient import TestClient
from quote_support import QuoteWorld

SELLER = "TG"  # a real ISO 3166-2:IN code: the API validates the delivery state against the real list
MAPPER = {
    "saree_type_to_categories": {"kanjivaram": ["kanjivaram"], "banarasi": ["banarasi"]},
    "fabric_to_values": {},
    "colour_to_values": {},
}


@pytest.fixture(scope="module")
def qa(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=0)
    q.add_product("QA-KANJI", "Synthetic kanjivaram", category="kanjivaram")  # 0
    q.add_product("QA-BANAR", "Synthetic banarasi", category="banarasi")  # 1
    q.add_product("QA-OTHER", "Synthetic other", category="paithani")  # 2
    q.price_version(
        [
            q.item(0, 400000, 4, 500, [{"min_qty": 10, "unit_price_paise": 380000}]),
            q.item(1, 310000, 4, 500),
            q.item(2, 280000, 4, 1200),
        ]
    )
    q.policy_version(seller_state=SELLER)
    q.mapper_config(MAPPER)
    return q


def url(qa: QuoteWorld, path: str) -> str:
    return f"/v1/tenants/{qa.t.id}{path}"


def h(user: Any) -> dict[str, str]:
    return bearer(user)


def h1(qa: QuoteWorld, user: Any) -> dict[str, str]:
    """A password-only (aal1) session of the same person."""
    return {"Authorization": f"Bearer {aal1_token(qa.w.stack, user)}"}


def ready(qa: QuoteWorld, client: TestClient, lines: list[tuple[str, int, int]]) -> tuple[str, str]:
    """A confirmed requirement with a pick per line made THROUGH THE API. Lines are (saree type, quantity, product index). Returns (enquiry id, requirement id)."""
    eid, requirement = qa.requirement([(saree, qty) for saree, qty, _ in lines])
    for n, (_, qty, product) in enumerate(lines, start=1):
        r = client.post(
            url(qa, f"/enquiries/{eid}/picks"),
            json={"line": n, "product_id": qa.products[product], "qty": qty, "sale_unit": "piece"},
            headers=h(qa.sales),
        )
        assert r.status_code == 200, r.text
    return eid, requirement


def make_draft(
    qa: QuoteWorld,
    client: TestClient,
    eid: str,
    *,
    kind: str = "new",
    state: str = "MH",
    quote: str | None = None,
    user: Any = None,
) -> Any:
    return client.post(
        url(qa, f"/enquiries/{eid}/quotes"),
        json={"id": quote or uid(), "customer_kind": kind, "delivery_state": state},
        headers=h(user or qa.sales),
    )


def code(r: Any) -> str:
    return str(r.json()["error"]["code"])


# ----------------------------------------------------------------------------- reads: who may see what
def test_a_viewer_reads_no_quote_surface_and_a_second_tenant_sees_nothing(
    qa: QuoteWorld, client: TestClient
) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    made = make_draft(qa, client, eid)
    assert made.status_code == 201, made.text
    qid = made.json()["id"]
    paths = [
        f"/enquiries/{eid}/quote-setup",
        f"/enquiries/{eid}/quotes",
        "/quotes",
        f"/quotes/{qid}",
        f"/quotes/{qid}/text",
    ]
    for path in paths:
        viewer = client.get(url(qa, path), headers=h(qa.viewer))
        assert viewer.status_code == 403 and code(viewer) == "forbidden", path  # a Viewer reads no price and no total
        anon = client.get(url(qa, path))
        assert anon.status_code == 401, path
    # the other workspace's owner: a member of ANOTHER tenant gets the same 404 as an unknown tenant, on every path
    other = qa.w.b.users["owner"]
    for path in paths:
        r = client.get(url(qa, path), headers=h(other))
        assert r.status_code == 404 and code(r) == "not_found", path
    # ... and on their OWN path they cannot reach this tenant's ids either (404, the same body), and their lists are empty
    b = qa.w.b
    assert (
        client.get(f"/v1/tenants/{b.id}/quotes/{qid}", headers=h(b.users["owner"])).status_code
        == 404
    )
    assert (
        client.get(
            f"/v1/tenants/{b.id}/enquiries/{eid}/quote-setup", headers=h(b.users["owner"])
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"/v1/tenants/{b.id}/enquiries/{eid}/quotes", headers=h(b.users["owner"])
        ).status_code
        == 404
    )
    empty = client.get(f"/v1/tenants/{b.id}/quotes", headers=h(b.users["owner"]))
    assert empty.status_code == 200 and empty.json() == []
    # malformed ids look like unknown ones
    assert client.get(url(qa, "/quotes/not-a-uuid"), headers=h(qa.owner)).status_code == 404


def test_the_setup_shows_lines_suggestions_the_price_list_and_what_is_missing(
    qa: QuoteWorld, client: TestClient
) -> None:
    eid, requirement = qa.requirement([("kanjivaram", 20), ("banarasi", 5)])
    r = client.get(url(qa, f"/enquiries/{eid}/quote-setup"), headers=h(qa.sales))
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["requirement_id"] == requirement and s["requirement_status"] == "confirmed"
    assert s["missing"] == [] and s["seller_state"] == SELLER and "delivery_state" in s["required_inputs"]
    assert s["mapper_version"] and len(s["delivery_states"]) == 36 and s["delivery_states"]["TG"] == "Telangana"
    assert [p["sku"] for p in s["price_list"]] == ["QA-BANAR", "QA-KANJI", "QA-OTHER"]
    one, two = s["lines"]
    assert one["line_no"] == 1 and one["quotable"] is True and one["quantity"] == 20 and one["pick"] is None
    assert one["suggestion"]["status"] == "matched" and [c["sku"] for c in one["suggestion"]["candidates"]] == ["QA-KANJI"]
    assert two["suggestion"]["status"] == "matched" and [c["sku"] for c in two["suggestion"]["candidates"]] == ["QA-BANAR"]
    assert one["summary"][0].startswith("Saree type:")
    # an enquiry without a requirement: nothing is invented, and what is missing is said
    bare = uid()
    assert (
        pg(qa.w.stack, qa.sales, "POST", "/enquiries", json={"id": bare, "tenant_id": qa.t.id, "lead_id": qa.t.rows["leads"]["id"], "channel": "email",
            "received_at": "2026-10-05T10:00:00+00:00", "body": "Synthetic bare enquiry"}, representation=False).status_code == 201
    )  # fmt: skip
    s2 = client.get(url(qa, f"/enquiries/{bare}/quote-setup"), headers=h(qa.sales)).json()
    assert s2["requirement_id"] is None and "no_requirement" in s2["missing"] and s2["lines"] == []


# ----------------------------------------------------------------------------- writes: pick
def test_picks_manual_suggested_replayed_and_refused(qa: QuoteWorld, client: TestClient) -> None:
    eid, requirement = qa.requirement([("kanjivaram", 20), ("banarasi", 5)])
    body = {"line": 1, "product_id": qa.products[0], "qty": 20, "sale_unit": "piece"}
    path = url(qa, f"/enquiries/{eid}/picks")
    assert client.post(path, json=body, headers=h(qa.viewer)).status_code == 403
    first = client.post(path, json=body, headers=h(qa.sales))
    assert first.status_code == 200 and first.json()["source"] == "manual" and first.json()["replayed"] is False
    assert client.post(path, json=body, headers=h(qa.sales)).json()["replayed"] is True
    # a pick taken from the mapper's suggestion: the SERVER records the mapper's own hash (the client sends none)
    sug = client.post(path, json={**body, "line": 2, "product_id": qa.products[1], "qty": 5, "from_suggestion": True}, headers=h(qa.sales))
    assert sug.status_code == 200 and sug.json()["source"] == "mapper_suggestion", sug.text
    row = json.loads(operator_sql.sql(f"select row_to_json(p) from (select source::text, suggestion_sha256 from public.requirement_line_picks where requirement_id = '{requirement}' and line_no = 2) p"))
    assert row["source"] == "mapper_suggestion" and len(row["suggestion_sha256"]) == 64
    mine = json.loads(operator_sql.sql(f"select row_to_json(p) from (select source::text, suggestion_sha256 from public.requirement_line_picks where requirement_id = '{requirement}' and line_no = 1) p"))
    assert mine == {"source": "manual", "suggestion_sha256": None}
    # a product the mapper does NOT suggest for that line cannot be claimed as a suggestion
    other = client.post(path, json={**body, "product_id": qa.products[2], "from_suggestion": True}, headers=h(qa.sales))
    assert other.status_code == 422 and code(other) == "suggestion_changed"
    # by hand it is allowed (a person's choice); the client cannot send a hash or a source at all
    assert client.post(path, json={**body, "product_id": qa.products[2]}, headers=h(qa.sales)).status_code == 200
    smuggled = client.post(path, json={**body, "source": "mapper_suggestion", "suggestion_sha256": "0" * 64}, headers=h(qa.sales))
    assert smuggled.status_code == 422
    # refused by the database and mapped to a fixed answer: a quantity that changes the customer's, a unit the list does not sell, an unknown product, a line that does not exist
    assert client.post(path, json={**body, "qty": 19}, headers=h(qa.sales)).status_code == 422
    assert client.post(path, json={**body, "sale_unit": "set"}, headers=h(qa.sales)).status_code in (422, 409)
    assert client.post(path, json={**body, "product_id": uid()}, headers=h(qa.sales)).status_code == 422
    assert client.post(path, json={**body, "line": 4}, headers=h(qa.sales)).status_code == 422
    assert client.post(path, json={**body, "line": 6}, headers=h(qa.sales)).status_code == 422
    # no requirement confirmed: nothing to pick for
    draft_eid, _ = qa.requirement([("kanjivaram", 20)], confirm=False)
    notyet = client.post(url(qa, f"/enquiries/{draft_eid}/picks"), json=body, headers=h(qa.sales))
    assert notyet.status_code == 409 and code(notyet) == "requirement_not_confirmed"
    # another workspace's owner cannot pick on this enquiry
    assert client.post(f"/v1/tenants/{qa.w.b.id}/enquiries/{eid}/picks", json=body, headers=h(qa.w.b.users["owner"])).status_code == 404


# ----------------------------------------------------------------------------- writes: create a draft
def test_a_draft_has_the_databases_figures_and_the_flags(qa: QuoteWorld, client: TestClient) -> None:
    eid, requirement = ready(qa, client, [("kanjivaram", 20, 0), ("banarasi", 5, 1)])
    qid = uid()
    r = make_draft(qa, client, eid, quote=qid)
    assert r.status_code == 201, r.text
    q = r.json()
    assert q["id"] == qid and q["status"] == "draft" and q["outcome"] == "draft" and q["requirement_id"] == requirement
    # 20 at the break price 380,000 and 5 at 310,000, 5% GST on both, no freight (the synthetic policy): the engine's figures, verified by the database
    assert (q["merchandise_net_paise"], q["item_tax_paise"], q["total_paise"]) == (9_150_000, 457_500, 9_607_500)
    assert q["advance_paise"] + q["balance_paise"] == q["total_paise"] and q["advance_paise"] == 4_803_750
    assert q["delivery_state"] == "MH" and q["gst_supply"] == "inter_state"  # the seller is TG
    assert q["engine_flags"] == [] and q["review_flags"] == [] and q["needs_owner_approval"] is False
    assert [(x["sku"], x["qty"], x["unit_price_applied_paise"], x["price_break_min_qty"]) for x in q["lines"]] == [("QA-KANJI", 20, 380000, 10), ("QA-BANAR", 5, 310000, None)]
    assert q["unquoted_lines"] == [] and q["engine_version"] and len(q["canonical_hash"]) == 64
    assert "request_text" not in q and "result_text" not in q
    row = qa.quote_row(qid)
    assert (row["total_paise"], row["merchandise_net_paise"], row["status"]) == (9_607_500, 9_150_000, "draft")
    # an exact retry replays (200, the same quote); the same id with another delivery state is a conflict, nothing is overwritten
    again = make_draft(qa, client, eid, quote=qid)
    assert again.status_code == 200 and again.json()["id"] == qid
    clash = make_draft(qa, client, eid, quote=qid, state="KA")
    assert clash.status_code in (409, 422), clash.text
    assert qa.quote_row(qid)["status"] == "draft"
    # a SECOND draft supersedes the first, quote numbers go up
    second = make_draft(qa, client, eid, state="KA")
    assert second.status_code == 201 and second.json()["quote_no"] > q["quote_no"]
    assert client.get(url(qa, f"/quotes/{qid}"), headers=h(qa.sales)).json()["outcome"] == "superseded"
    # listings: this enquiry's quotes and the tenant's, newest first, no figures beyond the summary
    listed = client.get(url(qa, f"/enquiries/{eid}/quotes"), headers=h(qa.sales)).json()
    assert [x["id"] for x in listed][:2] == [second.json()["id"], qid]
    assert set(listed[0]) == {"id", "quote_no", "enquiry_id", "status", "outcome", "customer_kind", "valid_until", "total_paise", "needs_owner_approval", "created_at"}
    tenant_wide = client.get(url(qa, "/quotes?limit=2"), headers=h(qa.owner)).json()
    assert len(tenant_wide) == 2 and tenant_wide[0]["id"] == second.json()["id"]
    assert client.get(url(qa, "/quotes?limit=51"), headers=h(qa.owner)).status_code == 422


def test_a_draft_is_refused_without_what_it_needs_and_never_with_a_made_up_input(
    qa: QuoteWorld, client: TestClient
) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    assert make_draft(qa, client, eid, user=qa.viewer).status_code == 403
    for bad in ("ZZ", "TS", "tg", "T", "", "TGX", "  "):  # TS is the vehicle code, not the ISO one: the real list only
        r = client.post(url(qa, f"/enquiries/{eid}/quotes"), json={"id": uid(), "customer_kind": "new", "delivery_state": bad}, headers=h(qa.sales))
        assert r.status_code == 422, bad
    assert make_draft(qa, client, eid, kind="vip").status_code == 422
    for field in ("total_paise", "unit_price", "price", "request_text", "result_text", "needs_owner_approval", "tenant_id", "status"):  # nothing priced or decided comes from a body
        r = client.post(url(qa, f"/enquiries/{eid}/quotes"), json={"id": uid(), "customer_kind": "new", "delivery_state": "MH", field: 1}, headers=h(qa.sales))
        assert r.status_code == 422, field
    # a line without a pick, a requirement that is not confirmed
    unpicked, _ = qa.requirement([("kanjivaram", 20), ("banarasi", 5)])
    assert client.post(url(qa, f"/enquiries/{unpicked}/picks"), json={"line": 1, "product_id": qa.products[0], "qty": 20, "sale_unit": "piece"}, headers=h(qa.sales)).status_code == 200
    r = make_draft(qa, client, unpicked)
    assert r.status_code == 422 and code(r) == "quote_input_missing"
    unconfirmed, _ = qa.requirement([("kanjivaram", 20)], confirm=False)
    r = make_draft(qa, client, unconfirmed)
    assert r.status_code == 409 and code(r) == "requirement_not_confirmed"
    # another workspace's owner cannot make a quote of this enquiry
    assert client.post(f"/v1/tenants/{qa.w.b.id}/enquiries/{eid}/quotes", json={"id": uid(), "customer_kind": "new", "delivery_state": "MH"}, headers=h(qa.w.b.users["owner"])).status_code == 404


def test_a_requirement_with_a_quote_cannot_be_discarded_until_it_is_rejected_or_withdrawn(
    qa: QuoteWorld, client: TestClient
) -> None:
    eid, requirement = ready(qa, client, [("kanjivaram", 20, 0)])
    qid = make_draft(qa, client, eid).json()["id"]
    r = client.post(url(qa, f"/requirements/{requirement}/discard"), headers=h(qa.sales))
    assert r.status_code == 409 and code(r) == "quote_depends"  # SM212, fixed message
    assert client.post(url(qa, f"/quotes/{qid}/reject"), json={"code": "customer_changed"}, headers=h(qa.owner)).status_code == 200
    assert client.post(url(qa, f"/requirements/{requirement}/discard"), headers=h(qa.sales)).status_code == 200


# ----------------------------------------------------------------------------- writes: approve, with its text
def test_approval_is_the_owners_or_admins_with_a_second_factor_and_renders_the_text_from_the_stored_row(
    qa: QuoteWorld, client: TestClient
) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0), ("banarasi", 5, 1)])
    qid = make_draft(qa, client, eid).json()["id"]
    approve = url(qa, f"/quotes/{qid}/approve")
    # a draft has no customer text
    early = client.get(url(qa, f"/quotes/{qid}/text"), headers=h(qa.sales))
    assert early.status_code == 409 and code(early) == "quote_not_approved"
    # who may not: Sales and Viewer (403), an Owner / Admin with a password only (mfa_required); nothing changes
    assert client.post(approve, headers=h(qa.sales)).status_code == 403
    assert client.post(approve, headers=h(qa.viewer)).status_code == 403
    for person in (qa.owner, qa.admin):
        r = client.post(approve, headers=h1(qa, person))
        assert r.status_code == 403 and code(r) == "mfa_required"
    assert qa.quote_row(qid)["status"] == "draft"
    assert client.post(f"/v1/tenants/{qa.w.b.id}/quotes/{qid}/approve", headers=h(qa.w.b.users["owner"])).status_code == 404
    # an Admin with a second factor approves an unflagged quote; the text comes with the approval
    ok = client.post(approve, headers=h(qa.admin))
    assert ok.status_code == 200, ok.text
    out = ok.json()
    assert out["status"] == "approved" and out["replayed"] is False and out["text_error"] is None
    text = out["text"]
    assert text["sent_by_system"] is False and text["renderer_version"] and len(text["canonical_hash"]) == 64
    assert "₹96,075.00" in text["text"] and "Synthetic kanjivaram" in text["text"] and "Synthetic banarasi" in text["text"] and "Reference: Q-" in text["text"]
    assert "An advance is payable before dispatch" in text["text"].replace("\n", " ") and "GST is shown separately as a line." in text["text"]
    assert "QA-KANJI" not in text["text"]  # the customer sees the product name, never our internal sku
    assert all(len(line) <= 60 for line in text["text"].split("\n")) and text["line_count"] == len(text["text"].split("\n"))
    assert "CANARY" not in text["text"] and "@" not in text["text"]  # no contact detail is ever in the customer text
    # the stored row is approved by that Admin, and the text endpoint renders the SAME text again (nothing in the request chooses what is rendered)
    row = client.get(url(qa, f"/quotes/{qid}"), headers=h(qa.sales)).json()
    assert row["status"] == "approved" and row["approved_by"] and row["approved_at"]
    got = client.get(url(qa, f"/quotes/{qid}/text"), headers=h(qa.sales))
    assert got.status_code == 200 and got.json() == text
    assert client.get(url(qa, f"/quotes/{qid}/text?expected_engine_hash={'0' * 64}&approved=true"), headers=h(qa.sales)).json() == text
    # the same person's retry replays; a draft cannot be approved twice by someone else
    again = client.post(approve, headers=h(qa.admin))
    assert again.status_code == 200 and again.json()["replayed"] is True
    other = client.post(approve, headers=h(qa.owner))
    assert other.status_code == 409 and code(other) == "quote_not_draft"


def test_a_flagged_quote_is_the_owners_alone(qa: QuoteWorld, client: TestClient) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    r = make_draft(qa, client, eid, kind="repeat")
    assert r.status_code == 201, r.text
    q = r.json()
    assert q["needs_owner_approval"] is True and "REPEAT_CUSTOMER_CLAIMED" in q["review_flags"]
    approve = url(qa, f"/quotes/{q['id']}/approve")
    refused = client.post(approve, headers=h(qa.admin))
    assert refused.status_code == 403 and code(refused) == "owner_approval_required"
    assert qa.quote_row(q["id"])["status"] == "draft"
    assert client.post(approve, headers=h(qa.owner)).status_code == 200


def test_a_quote_whose_inputs_moved_is_refused_not_approved(qa: QuoteWorld, client: TestClient) -> None:
    # the person changes a pick after the draft: the approver's recomputation from the CURRENT picks no longer matches the draft's hash
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    qid = make_draft(qa, client, eid).json()["id"]
    swap = client.post(url(qa, f"/enquiries/{eid}/picks"), json={"line": 1, "product_id": qa.products[2], "qty": 20, "sale_unit": "piece"}, headers=h(qa.sales))
    assert swap.status_code == 200
    r = client.post(url(qa, f"/quotes/{qid}/approve"), headers=h(qa.owner))
    assert r.status_code == 409 and code(r) == "quote_mismatch"
    assert qa.quote_row(qid)["status"] == "draft"
    # a requirement that is no longer the quote's (here: its pick restored but the draft was made for the other product) stays refused too; a NEW draft works
    fresh = make_draft(qa, client, eid)
    assert fresh.status_code == 201 and fresh.json()["lines"][0]["sku"] == "QA-OTHER"
    assert client.post(url(qa, f"/quotes/{fresh.json()['id']}/approve"), headers=h(qa.owner)).status_code == 200


# ----------------------------------------------------------------------------- writes: reject and withdraw
def test_rejection_rules(qa: QuoteWorld, client: TestClient) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    qid = make_draft(qa, client, eid).json()["id"]
    path = url(qa, f"/quotes/{qid}/reject")
    assert client.post(path, json={"code": "wrong_prices"}, headers=h(qa.viewer)).status_code == 403
    assert client.post(path, json={"code": "nonsense"}, headers=h(qa.owner)).status_code == 422
    assert client.post(path, json={"code": "wrong_prices"}, headers=h(qa.sales)).status_code == 403  # Sales may only WITHDRAW their own draft
    assert client.post(f"/v1/tenants/{qa.w.b.id}/quotes/{qid}/reject", json={"code": "other"}, headers=h(qa.w.b.users["owner"])).status_code == 404
    own = client.post(path, json={"code": "withdrawn"}, headers=h(qa.sales))
    assert own.status_code == 200 and own.json() == {"quote_id": qid, "status": "rejected", "replayed": False}
    assert client.post(path, json={"code": "withdrawn"}, headers=h(qa.sales)).json()["replayed"] is True
    gone = client.get(url(qa, f"/quotes/{qid}"), headers=h(qa.owner)).json()
    assert gone["outcome"] == "rejected" and gone["reject_code"] == "withdrawn" and gone["rejected_by"]
    late = client.post(url(qa, f"/quotes/{qid}/approve"), headers=h(qa.owner))
    assert late.status_code == 409 and code(late) == "quote_not_draft"
    # an Owner rejects any draft, with any reason; an approved quote cannot be rejected (it is withdrawn instead)
    other, _ = ready(qa, client, [("banarasi", 5, 1)])
    q2 = make_draft(qa, client, other).json()["id"]
    assert client.post(url(qa, f"/quotes/{q2}/reject"), json={"code": "wrong_prices"}, headers=h(qa.owner)).status_code == 200
    third, _ = ready(qa, client, [("banarasi", 5, 1)])
    q3 = make_draft(qa, client, third).json()["id"]
    assert client.post(url(qa, f"/quotes/{q3}/approve"), headers=h(qa.owner)).status_code == 200
    r = client.post(url(qa, f"/quotes/{q3}/reject"), json={"code": "other"}, headers=h(qa.owner))
    assert r.status_code == 409 and code(r) == "quote_not_draft"


def test_withdrawing_an_approved_quote(qa: QuoteWorld, client: TestClient) -> None:
    eid, requirement = ready(qa, client, [("kanjivaram", 20, 0)])
    qid = make_draft(qa, client, eid).json()["id"]
    path = url(qa, f"/quotes/{qid}/withdraw")
    body = {"code": "price_changed"}
    # only an approved quote can be withdrawn
    r = client.post(path, json=body, headers=h(qa.owner))
    assert r.status_code == 409 and code(r) == "quote_not_approved"
    assert client.post(url(qa, f"/quotes/{qid}/approve"), headers=h(qa.owner)).status_code == 200
    # Sales and Viewer cannot; an Owner / Admin with a password only meet mfa_required; a made-up reason is invalid; another workspace sees nothing
    assert client.post(path, json=body, headers=h(qa.sales)).status_code == 403
    assert client.post(path, json=body, headers=h(qa.viewer)).status_code == 403
    for person in (qa.owner, qa.admin):
        m = client.post(path, json=body, headers=h1(qa, person))
        assert m.status_code == 403 and code(m) == "mfa_required"
    assert client.post(path, json={"code": "because"}, headers=h(qa.owner)).status_code == 422
    assert client.post(f"/v1/tenants/{qa.w.b.id}/quotes/{qid}/withdraw", json=body, headers=h(qa.w.b.users["owner"])).status_code == 404
    assert client.get(url(qa, f"/quotes/{qid}"), headers=h(qa.sales)).json()["status"] == "approved"
    done = client.post(path, json=body, headers=h(qa.admin))
    assert done.status_code == 200 and done.json() == {"quote_id": qid, "status": "superseded", "replayed": False}
    assert client.post(path, json=body, headers=h(qa.admin)).json()["replayed"] is True
    shown = client.get(url(qa, f"/quotes/{qid}"), headers=h(qa.sales)).json()
    assert shown["status"] == "superseded" and shown["outcome"] == "withdrawn" and shown["withdraw_code"] == "price_changed" and shown["withdrawn_by"] and shown["withdrawn_at"]
    # a withdrawn quote has no customer text and cannot be approved again; the requirement can now be discarded
    gone = client.get(url(qa, f"/quotes/{qid}/text"), headers=h(qa.sales))
    assert gone.status_code == 409 and code(gone) == "quote_not_approved"
    assert client.post(url(qa, f"/quotes/{qid}/approve"), headers=h(qa.owner)).status_code == 409
    assert client.post(url(qa, f"/requirements/{requirement}/discard"), headers=h(qa.sales)).status_code == 200


def test_a_newer_price_list_makes_an_older_draft_stale(qa: QuoteWorld, client: TestClient) -> None:
    eid, _ = ready(qa, client, [("kanjivaram", 20, 0)])
    qid = make_draft(qa, client, eid).json()["id"]
    qa.price_version(
        [qa.item(0, 410000, 4, 500), qa.item(1, 310000, 4, 500), qa.item(2, 280000, 4, 1200)]
    )  # a new version in force today
    r = client.post(url(qa, f"/quotes/{qid}/approve"), headers=h(qa.owner))
    assert r.status_code == 409 and code(r) == "quote_stale"
    assert qa.quote_row(qid)["status"] == "draft"
