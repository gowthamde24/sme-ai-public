"""Shared helpers for the order-conversion tests on the real stack (ADR 0021): an approved quote from the REAL quote path, an order policy, an order, and every event run the way the
API will run it: read the order's recorded state with the caller's token (PostgREST), build the request with app/orders/builder.py, run the REAL lifecycle through the adapter, and call
record_order_event with the canonical request and result texts. Nothing here is the API (that comes later): it is the contract the API will follow.
All data is synthetic."""

# ruff: noqa: E501, S608, S603

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

import httpx
import operator_sql
from evidence_support import pg, uid
from quote_support import QuoteWorld, rpc, today

from app.orders import lifecycle_port
from app.orders.builder import OrderEvent, OrderState, build_request


def psql(statement: str, *, timeout: int = 120) -> str:
    """Operator SQL through STDIN (the statement can be larger than one command-line argument: a thousand-entry ledger)."""
    docker = shutil.which("docker")
    assert docker is not None, "docker is required for the integration tests"
    result = subprocess.run(
        [docker, "exec", "-i", operator_sql.container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At"],
        input=statement,
        capture_output=True,
        text=True,
        timeout=timeout,
    )  # fmt: skip
    assert result.returncode == 0, result.stderr.strip()[:400]
    return result.stdout.strip()


@dataclass
class Run:
    """One event as the API would run it."""

    response: httpx.Response
    request: dict[str, Any]
    result: dict[str, Any]
    event_id: str
    occurred_at: str


class OrderWorld:
    """A QuoteWorld (real products, price list, quote policy) plus an order policy, and helpers to make approved quotes, orders and events."""

    def __init__(self, qw: QuoteWorld) -> None:
        self.qw, self.w, self.t = qw, qw.w, qw.t
        self.users = {"owner": qw.owner, "admin": qw.admin, "sales": qw.sales, "viewer": qw.viewer}
        self.policy_id = ""

    # ------------------------------------------------------------------------------ policy and orders
    def policy(self, **over: Any) -> dict[str, Any]:
        body = {
            "advance_required": True,
            "dispatch_requires_advance": True,
            "cancel_allowed_until_state": "in_preparation",
            "allow_zero_value_orders": False,
            **over,
        }
        self.policy_id = uid()
        r = rpc(
            self.w,
            self.qw.owner.token,
            "create_order_policy_version",
            p_version_id=self.policy_id,
            p_tenant_id=self.t.id,
            p_effective_from=today(),
            p_policy=body,
        )
        assert r.status_code == 200, r.text
        return dict(r.json())

    def approved_quote(self, qty: int = 12, product: int = 0) -> str:
        """A quote through the REAL path: a confirmed requirement, a pick, the real engine, create, approve (Owner, aal2)."""
        _, requirement = self.qw.requirement([("kanjivaram", qty)])
        assert self.qw.pick(requirement, 1, product, qty).status_code == 200
        quote = self.qw.create(requirement).json()["quote_id"]
        assert self.qw.approve(quote).status_code == 200
        return str(quote)

    def create_order(
        self,
        quote: str,
        *,
        order_id: str | None = None,
        user: str = "owner",
        token: str | None = None,
    ) -> httpx.Response:
        return rpc(
            self.w,
            token or self.users[user].token,
            "create_order_from_quote",
            p_order_id=order_id or uid(),
            p_quote_id=quote,
        )

    def order(self, qty: int = 12, product: int = 0) -> tuple[str, str]:
        """(order id, quote id): a fresh approved quote and its order."""
        quote = self.approved_quote(qty, product)
        r = self.create_order(quote)
        assert r.status_code == 200, r.text
        return str(r.json()["order_id"]), quote

    # ------------------------------------------------------------------------------ reading the recorded state (the caller's token, like the API)
    def snapshot(self, order: str, user: str = "owner") -> OrderState:
        u = self.users[user]
        o = pg(
            self.w.stack,
            u,
            "GET",
            f"/orders?id=eq.{order}&select=state,order_total_paise,advance_paise,valid_until,policy_version_id",
        )
        assert o.status_code == 200 and len(o.json()) == 1, o.text
        row = o.json()[0]
        p = pg(
            self.w.stack,
            u,
            "GET",
            f"/order_policy_versions?id=eq.{row['policy_version_id']}&select=advance_required,dispatch_requires_advance,cancel_allowed_until_state",
        )
        assert p.status_code == 200 and len(p.json()) == 1, p.text
        pol = p.json()[0]
        e = pg(
            self.w.stack,
            u,
            "GET",
            f"/order_events?order_id=eq.{order}&select=type,seq,amount_paise,ledger_id&order=seq.asc",
        )
        assert e.status_code == 200, e.text
        events = e.json()
        return OrderState(
            state=row["state"],
            order_total_paise=row["order_total_paise"],
            advance_paise=row["advance_paise"],
            valid_until=date.fromisoformat(row["valid_until"]),
            advance_required=pol["advance_required"],
            dispatch_requires_advance=pol["dispatch_requires_advance"],
            cancel_allowed_until_state=pol["cancel_allowed_until_state"],
            payments=tuple(
                (x["ledger_id"], x["amount_paise"]) for x in events if x["type"] == "record_payment"
            ),
            refunds=tuple(
                (x["ledger_id"], x["amount_paise"]) for x in events if x["type"] == "record_refund"
            ),
        )

    # ------------------------------------------------------------------------------ one event, the way the API runs it
    def run_event(
        self,
        order: str,
        user: str,
        type_: str,
        *,
        amount: int | None = None,
        ledger: str | None = None,
        reason: str | None = None,
        event_id: str | None = None,
        as_of: datetime | None = None,
        token: str | None = None,
        state: OrderState | None = None,
        occurred_at: str | None = None,
    ) -> Run:
        """Read the recorded state, build the request, run the REAL lifecycle, call record_order_event. `state` pins a snapshot taken earlier (a stale client)."""
        snap = state or self.snapshot(order, user)
        request = build_request(
            snap, OrderEvent(type_, amount, ledger), as_of=as_of or datetime.now(UTC), role=user
        )
        result = lifecycle_port.run_transition(request)
        return self.call(
            order,
            user,
            type_,
            request,
            result,
            amount=amount,
            ledger=ledger,
            reason=reason,
            event_id=event_id,
            token=token,
            occurred_at=occurred_at,
        )

    def call(
        self,
        order: str,
        user: str,
        type_: str,
        request: dict[str, Any],
        result: dict[str, Any],
        *,
        amount: int | None = None,
        ledger: str | None = None,
        reason: str | None = None,
        event_id: str | None = None,
        token: str | None = None,
        occurred_at: str | None = None,
    ) -> Run:
        eid = event_id or uid()
        moment = occurred_at or datetime.now(UTC).isoformat()
        r = rpc(
            self.w,
            token or self.users[user].token,
            "record_order_event",
            p_event_id=eid,
            p_order_id=order,
            p_type=type_,
            p_occurred_at=moment,
            p_amount_paise=amount,
            p_ledger_id=ledger,
            p_reason_code=reason,
            p_engine_version=lifecycle_port.lifecycle_version(),
            p_request_text=lifecycle_port.canonical_json(request),
            p_result_text=lifecycle_port.canonical_json(result),
        )
        return Run(r, request, result, eid, moment)

    def event_sql(
        self,
        order: str,
        user: str,
        type_: str,
        *,
        amount: int | None = None,
        ledger: str | None = None,
        reason: str | None = None,
        event_id: str | None = None,
    ) -> str:
        """The SQL of an honest call (for a held session): the request is built NOW from the recorded state."""
        snap = self.snapshot(order, user)
        request = build_request(
            snap, OrderEvent(type_, amount, ledger), as_of=datetime.now(UTC), role=user
        )
        result = lifecycle_port.run_transition(request)
        n = "null"

        def lit(v: str | None) -> str:
            return n if v is None else f"'{v}'"

        return (
            f"select public.record_order_event('{event_id or uid()}', '{order}', '{type_}', now(), {amount if amount is not None else n}::bigint, {lit(ledger)}::uuid, {lit(reason)}, "
            f"'{lifecycle_port.lifecycle_version()}', $q${lifecycle_port.canonical_json(request)}$q$, $q${lifecycle_port.canonical_json(result)}$q$)"
        )

    # ------------------------------------------------------------------------------ what the database holds (operator reads)
    def state(self, order: str) -> str:
        return operator_sql.sql(f"select state from public.orders where id = '{order}'").strip()

    def ledger(self, order: str) -> list[dict[str, Any]]:
        raw = operator_sql.sql(
            f"select coalesce(json_agg(e order by seq), '[]') from (select seq, type, new_state, amount_paise, ledger_id from public.order_events where order_id = '{order}') e"
        )
        return list(json.loads(raw))

    def invariants(self, order: str) -> None:
        """The cache equals the ledger, the ledger is gapless, the money conserves."""
        raw = operator_sql.sql(
            f"""select row_to_json(x) from (select o.state::text as state, o.order_total_paise as total, o.closed_at is not null as closed,
                   (select e.new_state::text from public.order_events e where e.order_id = o.id order by e.seq desc limit 1) as last_state,
                   (select count(*) from public.order_events e where e.order_id = o.id) as n, (select max(seq) from public.order_events e where e.order_id = o.id) as max_seq,
                   (select coalesce(sum(amount_paise), 0) from public.order_events e where e.order_id = o.id and type = 'record_payment') as paid,
                   (select coalesce(sum(amount_paise), 0) from public.order_events e where e.order_id = o.id and type = 'record_refund') as refunded
              from public.orders o where o.id = '{order}') x"""
        )
        v = json.loads(raw)
        assert v["state"] == v["last_state"], v
        assert v["n"] == v["max_seq"], v
        assert 0 <= v["paid"] - v["refunded"] <= v["total"], v
        assert v["closed"] == (v["state"] in ("closed_paid", "declined", "expired", "cancelled")), v
