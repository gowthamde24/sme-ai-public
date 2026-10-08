"""quote_text 1.2.0 through the real API (real JWT verification, real PostgREST, real database functions, the REAL pinned engine, mapper and text renderer).

  * a product named with a joiner (U+200D / U+200C) after an Indic letter or mark: the quote is approved and its customer text renders, with the joiner intact and `renderer_version == "1.2.0"`;
  * a product named with a joiner between Latin letters: the quote is approved (the database accepts the name) and its text is refused with `quote_text_refused`, the approval standing;
  * the shipping lines of the text follow the policy: a policy with no shipping fee prints none, a policy with a fee prints the three lines.
Nothing here sends anything. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

from typing import Any

import pytest
from conftest import bearer
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient
from quote_support import QuoteWorld

SELLER = "TG"
TELUGU = "\u0c15\u0c4d\u200d\u0c37"  # KA, virama, ZWJ, SSA
MALAYALAM_CHILLU = "\u0d28\u0d4d\u200d"  # NA, virama, ZWJ (a chillu at the end of a word)
LATIN_WITH_JOINER = "Syn\u200dthetic latin"
MAPPER = {
    "saree_type_to_categories": {
        "kanjivaram": ["kanjivaram"],
        "banarasi": ["banarasi"],
        "paithani": ["paithani"],
    },
    "fabric_to_values": {},
    "colour_to_values": {},
}
SHIPPING_PREFIXES = ("Shipping net", "GST on shipping", "Shipping total")


@pytest.fixture(scope="module")
def qj(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=0)
    q.add_product("QJ-TELUGU", f"{TELUGU} {MALAYALAM_CHILLU} pattu", category="kanjivaram")  # 0
    q.add_product("QJ-LATIN", LATIN_WITH_JOINER, category="banarasi")  # 1
    q.add_product("QJ-PLAIN", "Synthetic plain", category="paithani")  # 2
    q.price_version(
        [q.item(0, 400000, 4, 500), q.item(1, 310000, 4, 500), q.item(2, 280000, 4, 1200)]
    )
    q.policy_version(seller_state=SELLER)  # no shipping fee: the policy of the first two tests
    q.mapper_config(MAPPER)
    return q


def url(qj: QuoteWorld, path: str) -> str:
    return f"/v1/tenants/{qj.t.id}{path}"


def approved_quote(qj: QuoteWorld, client: TestClient, saree: str, product: int) -> tuple[str, Any]:
    """A confirmed requirement, one pick, a draft and an approval THROUGH THE API. Returns (quote id, the approval response)."""
    eid, _ = qj.requirement([(saree, 20)])
    picked = client.post(
        url(qj, f"/enquiries/{eid}/picks"),
        json={"line": 1, "product_id": qj.products[product], "qty": 20, "sale_unit": "piece"},
        headers=bearer(qj.sales),
    )
    assert picked.status_code == 200, picked.text
    made = client.post(
        url(qj, f"/enquiries/{eid}/quotes"),
        json={"id": uid(), "customer_kind": "new", "delivery_state": "MH"},
        headers=bearer(qj.sales),
    )
    assert made.status_code == 201, made.text
    qid = made.json()["id"]
    approval = client.post(url(qj, f"/quotes/{qid}/approve"), headers=bearer(qj.admin))
    assert approval.status_code == 200 and approval.json()["status"] == "approved", approval.text
    return qid, approval


def test_a_product_name_with_a_joiner_after_an_indic_letter_renders_with_renderer_1_2_0(
    qj: QuoteWorld, client: TestClient
) -> None:
    qid, approval = approved_quote(qj, client, "kanjivaram", 0)
    name = f"{TELUGU} {MALAYALAM_CHILLU} pattu"
    out = approval.json()
    assert out["text_error"] is None and out["text"]["renderer_version"] == "1.2.0"
    got = client.get(url(qj, f"/quotes/{qid}/text"), headers=bearer(qj.sales))
    assert got.status_code == 200, got.text
    text = got.json()
    assert (
        text["renderer_version"] == "1.2.0"
        and text["sent_by_system"] is False
        and len(text["canonical_hash"]) == 64
    )
    lines = text["text"].split("\n")
    assert name in lines  # on a line of its own, both joiners intact
    assert "\u200d" in text["text"]
    assert all(len(x) <= 60 for x in lines)
    assert (
        got.json() == out["text"]
    )  # the approval's text and the text endpoint are the same render
    assert (
        client.get(
            url(qj, f"/quotes/{qid}/text?expected_engine_hash={'0' * 64}&approved=true"),
            headers=bearer(qj.sales),
        ).json()
        == text
    )


def test_a_product_name_with_a_joiner_between_latin_letters_is_refused_and_the_approval_stands(
    qj: QuoteWorld, client: TestClient
) -> None:
    qid, approval = approved_quote(qj, client, "banarasi", 1)
    assert approval.json()["text"] is None and approval.json()["text_error"] == "quote_text_refused"
    got = client.get(url(qj, f"/quotes/{qid}/text"), headers=bearer(qj.sales))
    assert got.status_code == 409 and got.json()["error"]["code"] == "quote_text_refused"
    assert "\u200d" not in got.text and "Syn" not in got.text
    row = client.get(url(qj, f"/quotes/{qid}"), headers=bearer(qj.sales)).json()
    assert row["status"] == "approved" and row["outcome"] == "approved"


def test_the_shipping_lines_of_the_text_follow_the_policy(
    qj: QuoteWorld, client: TestClient
) -> None:
    # the policy in force has no shipping fee: no shipping line
    qid, _ = approved_quote(qj, client, "paithani", 2)
    lines = (
        client.get(url(qj, f"/quotes/{qid}/text"), headers=bearer(qj.sales))
        .json()["text"]
        .split("\n")
    )
    assert not [x for x in lines if x.startswith(SHIPPING_PREFIXES)]
    # a policy with a flat fee of 50.00 and 18% tax on it: the three lines come back, in order, with the worked amounts
    qj.policy_version(seller_state=SELLER, shipping_flat_fee_paise=5000, shipping_tax_bps=1800)
    qid2, _ = approved_quote(qj, client, "paithani", 2)
    got = client.get(url(qj, f"/quotes/{qid2}/text"), headers=bearer(qj.sales))
    assert got.status_code == 200 and got.json()["renderer_version"] == "1.2.0"
    lines2 = got.json()["text"].split("\n")
    start = [i for i, x in enumerate(lines2) if x.startswith("Shipping net")]
    assert len(start) == 1
    assert lines2[start[0] : start[0] + 3] == [
        "Shipping net: ₹50.00",
        "GST on shipping (18%): ₹9.00",
        "Shipping total: ₹59.00",
    ]
