"""Credits top-up on the real local stack (migrations 20261231992200 and 20261231992210): the same payment settling from many connections at once credits exactly once, with exactly one invoice and no hole in
the invoice numbers; two different payments racing for one order credit one; the amount that must equal the order's total; a failure recorded while a payment settles never un-pays it. Real Postgres and PostgREST
(PostgREST runs every call in its own transaction, so these are true concurrent transactions); the caller is the workspace Owner with a real token. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import operator_sql
from conftest import Stack, User


def rpc(stack: Stack, user: User, name: str, body: dict[str, Any]) -> httpx.Response:
    return httpx.post(f"{stack.rest}/rpc/{name}", headers=stack.headers(user.token), json=body, timeout=30)


def make_order(stack: Stack, owner: User, tenant: str, order: str, paise: int = 100000) -> dict[str, Any]:
    r = rpc(stack, owner, "pricing_order_create", {"p_tenant_id": tenant, "p_order_id": order, "p_purpose": "topup", "p_amount_paise": paise, "p_plan_id": None, "p_interval": None})
    assert r.status_code == 200, r.text
    return dict(r.json())


def balance(tenant: str) -> int:
    return int(operator_sql.sql(f"select pricing.balance_of('{tenant}')"))


def test_the_same_payment_from_many_connections_credits_once(eval_world: Any, stack: Stack) -> None:
    owner, tenant = eval_world.a.users["owner"], eval_world.a.id
    order = f"order_CC{uuid.uuid4().hex[:12]}"
    pay = f"pay_CC{uuid.uuid4().hex[:12]}"
    made = make_order(stack, owner, tenant, order, 100000)
    assert made["total_paise"] == 118000 and made["gst_paise"] == 18000

    def settle(_: int) -> httpx.Response:
        return rpc(stack, owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": order, "p_payment_ref": pay})

    with ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(settle, range(24)))
    assert [r.status_code for r in results] == [200] * 24, [r.text for r in results if r.status_code != 200][:2]
    assert sum(1 for r in results if r.json()["settled"] is True) == 1 and sum(1 for r in results if r.json()["replayed"] is True) == 23
    assert balance(tenant) == 100000, "the BASE amount, once"
    assert operator_sql.sql(f"select count(*) from pricing.wallet_lots where tenant_id = '{tenant}' and source = 'topup' and ref = '{pay}'") == "1"
    assert operator_sql.sql(f"select count(*) from pricing.invoices where tenant_id = '{tenant}' and ref = '{pay}'") == "1"


def test_two_different_payments_racing_for_one_order_credit_one(eval_world: Any, stack: Stack) -> None:
    owner, tenant = eval_world.a.users["owner"], eval_world.a.id
    order = f"order_TW{uuid.uuid4().hex[:12]}"
    before = balance(tenant)
    make_order(stack, owner, tenant, order, 50000)
    pays = [f"pay_TW{uuid.uuid4().hex[:12]}" for _ in range(2)]

    def settle(pay: str) -> httpx.Response:
        return rpc(stack, owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": order, "p_payment_ref": pay})

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(settle, pays))
    assert [r.status_code for r in results] == [200, 200]
    assert sorted(r.json()["settled"] for r in results) == [False, True]
    assert balance(tenant) == before + 50000
    assert operator_sql.sql(f"select count(*) from pricing.orders where order_id = '{order}' and status = 'paid'") == "1"


def test_invoice_numbers_have_no_gaps_when_payments_settle_at_once(eval_world: Any, stack: Stack) -> None:
    owner, tenant = eval_world.a.users["owner"], eval_world.a.id
    orders = [(f"order_GP{uuid.uuid4().hex[:12]}", f"pay_GP{uuid.uuid4().hex[:12]}") for _ in range(10)]
    for order, _ in orders:
        make_order(stack, owner, tenant, order, 20000)

    def settle(pair: tuple[str, str]) -> httpx.Response:
        return rpc(stack, owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": pair[0], "p_payment_ref": pair[1]})

    with ThreadPoolExecutor(max_workers=10) as pool:
        assert [r.status_code for r in pool.map(settle, orders)] == [200] * 10
    refs = ",".join(f"'{p}'" for _, p in orders)
    numbers = operator_sql.sql(f"select string_agg(split_part(number, '-', 3)::int::text, ',' order by number) from pricing.invoices where ref in ({refs})").split(",")
    ints = [int(n) for n in numbers]
    assert len(ints) == 10 and len(set(ints)) == 10 and ints == list(range(ints[0], ints[0] + 10)), ints
    fy = operator_sql.sql("select pricing.fy_of(now())")
    assert int(operator_sql.sql(f"select last_no from pricing.invoice_counters where series = 'INV' and fy = '{fy}'")) >= ints[-1]
    assert operator_sql.sql(f"select count(*) from pricing.invoices where number ~ '^S19-{fy}-[0-9]{{6}}$' and ref in ({refs})") == "10"


def test_the_paid_amount_must_equal_the_order_and_a_failure_never_unpays(eval_world: Any, stack: Stack) -> None:
    owner, tenant = eval_world.a.users["owner"], eval_world.a.id
    order = f"order_AM{uuid.uuid4().hex[:12]}"
    pay = f"pay_AM{uuid.uuid4().hex[:12]}"
    before = balance(tenant)
    make_order(stack, owner, tenant, order, 100000)
    short = rpc(stack, owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": order, "p_payment_ref": pay, "p_paid_paise": 117999})
    assert short.status_code == 200 and short.json()["reason"] == "amount_mismatch" and balance(tenant) == before
    ok = rpc(stack, owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": order, "p_payment_ref": pay, "p_paid_paise": 118000})
    assert ok.json()["settled"] is True and balance(tenant) == before + 100000

    def fail(_: int) -> httpx.Response:
        return rpc(stack, owner, "pricing_order_failed", {"p_order_id": order, "p_code": "payment_failed"})

    with ThreadPoolExecutor(max_workers=6) as pool:
        assert all(r.json()["reason"] == "already_paid" for r in pool.map(fail, range(6)))
    assert operator_sql.sql(f"select status from pricing.orders where order_id = '{order}'") == "paid"


def test_another_business_cannot_settle_or_fail_our_order(eval_world: Any, stack: Stack) -> None:
    a_owner, b_owner, tenant = eval_world.a.users["owner"], eval_world.b.users["owner"], eval_world.a.id
    order = f"order_XB{uuid.uuid4().hex[:12]}"
    make_order(stack, a_owner, tenant, order, 10000)
    assert rpc(stack, b_owner, "pricing_order_settle", {"p_tenant_id": tenant, "p_order_id": order, "p_payment_ref": f"pay_XB{uuid.uuid4().hex[:12]}"}).status_code in (401, 403)
    assert rpc(stack, b_owner, "pricing_order_failed", {"p_order_id": order, "p_code": "payment_failed"}).json()["reason"] == "unknown_order"
    assert operator_sql.sql(f"select status from pricing.orders where order_id = '{order}'") == "created"
