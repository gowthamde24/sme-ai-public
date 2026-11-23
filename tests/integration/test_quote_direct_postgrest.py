"""T009 part 2 on the real stack: picks, draft quotes, approval, rejection and the discard block, attacked straight through PostgREST (our API is skipped).

  * who may do what: Sales+ pick and create, Owner / Admin approve (second factor), Owner alone for a flagged quote, a stranger / Viewer / anon nothing,
    and every refusal before the role is proven is the SAME 42501;
  * the database does not trust the caller's numbers (a tampered total, a tampered request, a hidden flag, a request that carries a cost);
  * nobody writes quotes, lines or picks directly; a Viewer reads none of them; internal functions are not exposed;
  * a draft AND an approved quote block discard_requirement (SM212).
All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from conftest import aal1_token
from crm_support import World
from evidence_support import code_of, pg, uid
from quote_support import QuoteWorld, rpc

from app.quotes import engine_port


@pytest.fixture(scope="module")
def qw(eval_world: World) -> QuoteWorld:
    q = QuoteWorld(eval_world, eval_world.a, n_products=4)
    q.price_version(
        [
            q.item(0, 400000, 4, 500, [{"min_qty": 10, "unit_price_paise": 380000}]),
            q.item(1, 310000, 4, 500),
            q.item(2, 280000, 4, 1200),
        ]
    )
    q.policy_version()
    return q


def ready(qw: QuoteWorld, lines: list[tuple[str, int, int]]) -> str:
    """A confirmed requirement with a pick per line: lines are (saree type, quantity, product index). Returns the requirement id."""
    _, requirement = qw.requirement([(saree, qty) for saree, qty, _ in lines])
    for n, (_, qty, product) in enumerate(lines, start=1):
        assert qw.pick(requirement, n, product, qty).status_code == 200
    return requirement


def payload(
    qw: QuoteWorld, requirement: str, kind: str = "new"
) -> tuple[dict[str, Any], dict[str, Any]]:
    request = qw.build(requirement, kind)["request"]
    return request, engine_port.run_quote(request)


def create_with(
    qw: QuoteWorld,
    requirement: str,
    request: dict[str, Any],
    result: dict[str, Any],
    *,
    token: str | None = None,
    kind: str = "new",
    quote: str | None = None,
) -> httpx.Response:
    return rpc(qw.w, token or qw.sales.token, "create_quote_draft", p_quote_id=quote or uid(), p_requirement_id=requirement, p_customer_kind=kind, p_delivery_state="TS",
               p_engine_version=engine_port.engine_version(), p_request_text=engine_port.canonical_json(request), p_result_text=engine_port.canonical_json(result))  # fmt: skip


def test_sales_creates_a_draft_and_the_figures_are_the_databases(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 20, 0), ("banarasi", 5, 1)])
    r = qw.create(requirement)
    assert (
        r.status_code == 200
        and r.json()["replayed"] is False
        and r.json()["needs_owner_approval"] is False
    ), r.text
    row = qw.quote_row(r.json()["quote_id"])
    assert (
        row["merchandise_net_paise"] == 20 * 380000 + 5 * 310000 == 9_150_000
    )  # the break applies to line 1 only; exact totals are pinned in pgTAP 58 and by the engine equivalence test
    assert (
        row["total_paise"] == row["merchandise_net_paise"] + row["item_tax_paise"]
        and row["shipping_net_paise"] == 0
    )
    lines = pg(
        qw.w.stack,
        qw.owner,
        "GET",
        f"/quote_lines?quote_id=eq.{r.json()['quote_id']}&select=sku,qty,unit_price_applied_paise,price_break_min_qty&order=line_no",
    ).json()
    assert [(x["qty"], x["unit_price_applied_paise"], x["price_break_min_qty"]) for x in lines] == [
        (20, 380000, 10),
        (5, 310000, None),
    ]
    assert qw.create(requirement, quote=r.json()["quote_id"]).json()["replayed"] is True


def test_a_quote_needs_a_person_confirmed_pick_for_every_line(qw: QuoteWorld) -> None:
    _, requirement = qw.requirement([("kanjivaram", 5), ("banarasi", 5)])
    assert qw.pick(requirement, 1, 0, 5).status_code == 200  # line 2 has no pick
    r = rpc(qw.w, qw.sales.token, "create_quote_draft", p_quote_id=uid(), p_requirement_id=requirement, p_customer_kind="new", p_delivery_state="TS",
            p_engine_version="1.1.0", p_request_text=json.dumps({"as_of": __import__("quote_support").today()}), p_result_text="{}")  # fmt: skip
    assert code_of(r) == "SM217" and r.json()["message"] == "quote input missing", (
        r.text
    )  # nothing is guessed


def test_the_database_does_not_trust_the_callers_numbers(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    request, result = payload(qw, requirement)
    canary = "CANARY-9917"
    forged: list[tuple[str, dict[str, Any], dict[str, Any]]] = []
    low = json.loads(json.dumps(result))
    low["totals"]["total"] -= 1
    forged.append(("total", request, low))
    cheap = json.loads(json.dumps(request))
    cheap["price_list"][0]["unit_price"] = 1
    forged.append(("price", cheap, result))
    cost = json.loads(json.dumps(request))
    cost["price_list"][0]["cost"] = 5
    forged.append(("cost", cost, result))
    hidden = json.loads(json.dumps(result))
    hidden["flags"] = {"needs_owner_approval": True, "reasons": [{"code": "CREDIT_LIMIT_EXCEEDED"}]}
    forged.append(("flag", request, hidden))
    extra = json.loads(json.dumps(result))
    extra[canary] = 1
    forged.append(("extra key", request, extra))
    for name, rq, rs in forged:
        r = create_with(qw, requirement, rq, rs)
        assert (
            code_of(r) == "SM216"
            and r.json()["message"] == "quote does not match its recomputation"
        ), (name, r.text)
        assert canary not in r.text, name
    assert (
        pg(qw.w.stack, qw.owner, "GET", f"/quotes?requirement_id=eq.{requirement}&select=id").json()
        == []
    )


def test_who_may_create_and_who_gets_the_identical_refusal(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 8, 0)])
    request, result = payload(qw, requirement)
    stranger, viewer = qw.w.b.users["owner"], qw.viewer
    refused = [
        create_with(qw, requirement, request, result, token=u.token) for u in (stranger, viewer)
    ]
    assert (
        all(
            r.status_code == refused[0].status_code and r.json() == refused[0].json()
            for r in refused
        )
        and code_of(refused[0]) == "42501"
    )
    anon = rpc(
        qw.w,
        None,
        "create_quote_draft",
        p_quote_id=uid(),
        p_requirement_id=requirement,
        p_customer_kind="new",
        p_delivery_state="TS",
        p_engine_version="1.1.0",
        p_request_text="{}",
        p_result_text="{}",
    )
    assert anon.status_code in (401, 403)
    assert (
        code_of(create_with(qw, requirement, request, result, token=qw.owner.token)) == ""
    )  # an Owner may create too: control


def test_approval_rules(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    created = qw.create(requirement)
    quote = created.json()["quote_id"]
    weak_owner, weak_admin, weak_sales = (
        aal1_token(qw.w.stack, u) for u in (qw.owner, qw.admin, qw.sales)
    )
    assert (
        code_of(qw.approve(quote, token=qw.sales.token)) == "42501"
        and code_of(qw.approve(quote, token=qw.viewer.token)) == "42501"
    )
    assert code_of(qw.approve(quote, token=qw.w.b.users["owner"].token)) == "42501"
    assert (
        code_of(qw.approve(quote, token=weak_owner)) == "SM306"
        and code_of(qw.approve(quote, token=weak_admin)) == "SM306"
    )
    assert code_of(qw.approve(quote, token=weak_sales)) == "42501"  # the role is proven first
    wrong = rpc(qw.w, qw.admin.token, "approve_quote", p_quote_id=quote, p_recomputed_hash="0" * 64)
    assert code_of(wrong) == "SM216"
    ok = qw.approve(quote, token=qw.admin.token)
    assert (
        ok.status_code == 200
        and ok.json()["status"] == "approved"
        and ok.json()["replayed"] is False
    )
    assert qw.approve(quote, token=qw.admin.token).json()["replayed"] is True
    assert code_of(qw.approve(quote, token=qw.owner.token)) == "SM214"


def test_a_flagged_quote_needs_the_owner_not_an_admin(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 2, 0)])  # below the minimum order quantity of 4
    created = qw.create(requirement)
    assert created.json()["needs_owner_approval"] is True
    quote = created.json()["quote_id"]
    assert (
        qw.approve(quote, token=qw.admin.token).json()["message"] == "quote needs owner approval"
        and code_of(qw.approve(quote, token=qw.admin.token)) == "SM218"
    )
    assert qw.approve(quote, token=qw.owner.token).status_code == 200


def test_nobody_writes_quotes_lines_or_picks_directly_and_a_viewer_reads_none(
    qw: QuoteWorld,
) -> None:
    for table in ("requirement_line_picks", "quotes", "quote_lines"):
        owner = qw.owner
        assert pg(
            qw.w.stack, owner, "POST", f"/{table}", json={"tenant_id": qw.t.id}
        ).status_code in (401, 403), table
        for method in ("PATCH", "DELETE"):
            r = pg(
                qw.w.stack,
                owner,
                method,
                f"/{table}?tenant_id=eq.{qw.t.id}",
                json={"created_at": "2020-01-01T00:00:00Z"} if method == "PATCH" else None,
            )
            assert r.status_code in (401, 403) or r.json() in ([], None), (table, method, r.text)
        assert pg(qw.w.stack, qw.viewer, "GET", f"/{table}?select=id").json() == [], table
        assert pg(qw.w.stack, qw.w.b.users["owner"], "GET", f"/{table}?select=id").json() == [], (
            table
        )
        assert pg(qw.w.stack, qw.sales, "GET", f"/{table}?select=id").json() != [], table
        assert pg(qw.w.stack, None, "GET", f"/{table}?select=id").status_code in (401, 403), table
    for fn in (
        "quote_build",
        "quote_round",
        "quote_request_hash",
        "quote_result_flags",
        "quote_guard_update",
    ):
        assert rpc(qw.w, qw.owner.token, fn).status_code in (404, 401, 403), fn


def test_a_draft_and_an_approved_quote_block_discard_until_the_draft_is_withdrawn(
    qw: QuoteWorld,
) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    quote = qw.create(requirement).json()["quote_id"]
    blocked = rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement)
    assert (
        code_of(blocked) == "SM212"
        and blocked.json()["message"] == "a quote depends on this requirement"
    )
    assert qw.approve(quote).status_code == 200
    assert (
        code_of(rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement))
        == "SM212"
    )  # an approved quote blocks it for good
    requirement2 = ready(qw, [("banarasi", 8, 1)])
    quote2 = qw.create(requirement2).json()["quote_id"]
    assert (
        code_of(rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement2))
        == "SM212"
    )
    assert (
        rpc(qw.w, qw.sales.token, "reject_quote", p_quote_id=quote2, p_code="withdrawn").status_code
        == 200
    )
    freed = rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement2)
    assert freed.status_code == 200 and freed.json()["status"] == "discarded"


def test_rejection_and_withdrawal_rules(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    mine = qw.create(requirement, token=qw.sales.token).json()["quote_id"]
    assert (
        code_of(rpc(qw.w, qw.sales.token, "reject_quote", p_quote_id=mine, p_code="wrong_prices"))
        == "42501"
    )  # Sales may only withdraw
    assert (
        code_of(rpc(qw.w, qw.viewer.token, "reject_quote", p_quote_id=mine, p_code="withdrawn"))
        == "42501"
    )
    assert (
        code_of(
            rpc(
                qw.w,
                qw.w.b.users["owner"].token,
                "reject_quote",
                p_quote_id=mine,
                p_code="withdrawn",
            )
        )
        == "42501"
    )
    assert (
        code_of(rpc(qw.w, qw.admin.token, "reject_quote", p_quote_id=mine, p_code="nonsense"))
        == "22023"
    )
    done = rpc(qw.w, qw.sales.token, "reject_quote", p_quote_id=mine, p_code="withdrawn")
    assert done.status_code == 200 and done.json()["status"] == "rejected"
    assert (
        code_of(rpc(qw.w, qw.admin.token, "reject_quote", p_quote_id=mine, p_code="other"))
        == "SM214"
    )


def test_a_repeat_customer_claim_needs_the_owner(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    created = qw.create(requirement, kind="repeat")
    assert created.status_code == 200 and created.json()["needs_owner_approval"] is True
    quote = created.json()["quote_id"]
    assert "REPEAT_CUSTOMER_CLAIMED" in qw.quote_row(quote)["review_flags"]
    assert code_of(qw.approve(quote, token=qw.admin.token)) == "SM218"
    assert qw.approve(quote, token=qw.owner.token).status_code == 200


def test_withdrawal_rules(qw: QuoteWorld) -> None:
    requirement = ready(qw, [("kanjivaram", 12, 0)])
    quote = qw.create(requirement).json()["quote_id"]
    weak_owner, weak_sales = (aal1_token(qw.w.stack, u) for u in (qw.owner, qw.sales))
    assert code_of(qw.withdraw(quote)) == "SM214"  # a draft cannot be withdrawn
    assert qw.approve(quote).status_code == 200
    stranger = qw.w.b.users["owner"].token
    assert [
        code_of(qw.withdraw(quote, token=t)) for t in (qw.sales.token, qw.viewer.token, stranger)
    ] == ["42501"] * 3
    assert (
        qw.withdraw(quote, token=stranger).json() == qw.withdraw(uid(), token=stranger).json()
    )  # a foreign quote and an unknown one: the identical refusal
    assert (
        code_of(qw.withdraw(quote, token=weak_owner)) == "SM306"
        and code_of(qw.withdraw(quote, token=weak_sales)) == "42501"
    )
    assert code_of(qw.withdraw(quote, code="nonsense")) == "22023"
    assert (
        code_of(rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement))
        == "SM212"
    )  # approved: still blocked
    done = qw.withdraw(quote, "customer_cancelled", token=qw.admin.token)
    assert (
        done.status_code == 200
        and done.json()["replayed"] is False
        and done.json()["status"] == "superseded"
    )
    assert qw.withdraw(quote, "customer_cancelled", token=qw.admin.token).json()["replayed"] is True
    assert (
        code_of(qw.withdraw(quote, "customer_cancelled", token=qw.owner.token)) == "SM214"
    )  # another person's identical request is not a replay
    assert code_of(qw.approve(quote)) == "SM214"
    freed = rpc(qw.w, qw.sales.token, "discard_requirement", p_requirement_id=requirement)
    assert freed.status_code == 200 and freed.json()["status"] == "discarded"
    row = qw.quote_row(quote)
    assert row["status"] == "superseded"
