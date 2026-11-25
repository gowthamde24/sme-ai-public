"""TWO-INSTANCE COORDINATION PROOF on STAGING data (26 Nov 2026): the live-call count, the concurrent-call limit and whisper / hang-up across two API instances, through the real database functions.

  PYTHONPATH=services/ai-api <venv>/bin/python scripts/capacity_coordination.py --i-know-this-is-staging

Two "instances" are two independent copies of what an API process holds for this (`LiveCalls` + `RpcCommandStore` with its own database client and the system account's token), run against the staging database:
instance B holds two calls; instance A holds none. It proves (1) both see the same platform count, (2) the deployment limit (`TELEPHONY_MAX_CONCURRENT`, 2 here) refuses a third call on A while B holds two, (3) a whisper and a
hang-up asked on A reach the call held by B within the wait, (4) a call nobody holds, or a call of another workspace, is refused. The calls are synthetic rows of ONE synthetic workspace; they end at the close. Nothing is dialled."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import asyncio
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

from app.rpc_base import RpcClient  # noqa: E402
from app.telephony import cross, gate  # noqa: E402
from app.telephony.live import LiveCalls  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LINES: list[str] = []
FAILS: list[str] = []


def say(ok: bool, step: str, expected: Any, got: Any) -> None:
    line = f"{'PASS' if ok else 'FAIL'}  {step}: expected {expected}, got {got}"
    print(line)
    LINES.append(line)
    if not ok:
        FAILS.append(step)


def sql(statement: str) -> None:
    if (ROOT / "supabase" / ".temp" / "project-ref").read_text().strip() != ss.STAGING_REF:
        raise ss.SeedError("this checkout is not linked to the staging project")
    out = subprocess.run(["supabase", "db", "query", "--linked", statement], cwd=ROOT, capture_output=True, text=True, timeout=180, check=False)  # noqa: S603, S607
    if out.returncode != 0 and '"rows"' not in out.stdout + out.stderr:
        raise ss.SeedError("a database statement failed: " + (out.stdout + out.stderr)[-300:])


class Line:
    """What an instance holds of a call it runs: whispers it was told and whether it was hung up."""

    def __init__(self) -> None:
        self.whispers: list[str] = []
        self.hung: list[str] = []
        self.transcript: list[Any] = []

    async def hang_up(self, reason: str) -> None:
        self.hung.append(reason)


async def main_async(api: str) -> int:
    s = ss.Seeder(api)
    password = ss.secret_get("sme-charging-proof-password")
    if password is None:
        raise ss.SeedError("no synthetic-owner password in Secret Manager (run scripts/charging_proof.py once)")
    email = f"capacity-proof-{time.strftime('%m%d%H%M%S')}@demo.example.test"
    terms = s.terms()
    s.create_user(email, password, {"terms_version": terms["terms"], "business_name": "Capacity proof"})
    token = s.sign_in(email, password)["access_token"]
    st, setup = s.call(token, "POST", "/v1/account/setup", {"business_type": "textiles", "language": "en", "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
    tenant = uuid.UUID(str(setup["tenant_id"])) if st == 200 and isinstance(setup, dict) else None
    if tenant is None:
        raise ss.SeedError(f"setup failed (HTTP {st})")
    sched = s.sign_in(ss.SCHEDULER_EMAIL, ss.secret_get("sme-scheduler-password") or "")["access_token"]
    rest = f"{s.sb}/rest/v1"
    store_a = cross.RpcCommandStore(RpcClient(rest, s.pub), lambda: sched, per_workspace=True)   # instance A: its own client
    store_b = cross.RpcCommandStore(RpcClient(rest, s.pub), lambda: sched, per_workspace=True)   # instance B: another one
    live_a, live_b = LiveCalls(), LiveCalls()
    base = store_a.live_count()
    print(f"workspace {tenant}; platform live calls before: {base}")
    ids = [uuid.uuid4(), uuid.uuid4()]
    lines = [Line(), Line()]
    for cid, line in zip(ids, lines):
        sql(f"insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, simulated, purpose, answered_at, created_at) values ('{cid}', '{tenant}', 'inbound', 'in_progress', 'voicelink', false, false, 'inbound', now(), now())")
        live_b.add(tenant, cid, line)   # type: ignore[arg-type]
    try:
        # 1. both instances read the same platform count and the same per-workspace count
        ca, cb = store_a.live_count(), store_b.live_count()
        say(ca == cb == base + 2, "1a both instances count the same platform total", base + 2, f"A={ca}, B={cb}")
        ta, tb = store_a.live_by_tenant().get(str(tenant)), store_b.live_by_tenant().get(str(tenant))
        say(ta == tb == 2, "1b ... and the same 2 live calls for this workspace", 2, f"A={ta}, B={tb}")
        say(live_a.local_count() == 0 and live_b.local_count() == 2, "1c A holds none itself, B holds both", "0 / 2", f"{live_a.local_count()} / {live_b.local_count()}")
        # 2. the deployment limit counts the whole platform: A refuses a third call while B holds two
        live_a.platform_live, live_a.platform_at = ca, time.monotonic()
        settings = gate.Settings(mode="live", live_confirmed=True, max_concurrent=max(2, base + 2))
        facts = gate.InboundFacts(to_number="+919000000001", now=datetime.now(UTC), line_known=True, inbound_on=True, active_calls_total=live_a.count())
        decision = gate.check_inbound(settings, facts)
        say(isinstance(decision, gate.Refused) and decision.reason == "too_many_calls", f"2a with the platform at its limit ({settings.max_concurrent}) A refuses the next call (too_many_calls) though A holds none", "too_many_calls", getattr(decision, "reason", "allowed"))
        # (the same decision with only A's own count, as a single-instance deployment would make it, would let it in)
        solo = gate.check_inbound(settings, gate.InboundFacts(to_number="+919000000001", now=datetime.now(UTC), line_known=True, inbound_on=True, active_calls_total=0))
        say(not isinstance(solo, gate.Refused), "2b without the platform count (one instance's own view) the same call would be let in: this is what CALL_COORDINATION prevents", "allowed", "allowed" if not isinstance(solo, gate.Refused) else solo.reason)
        # 3. whisper and hang-up asked on A reach the call B holds
        stop = asyncio.Event()

        async def b_loop() -> None:
            while not stop.is_set():
                await cross.apply_commands(live_b, store_b)
                await asyncio.sleep(cross.BUSY_S)

        task = asyncio.create_task(b_loop())
        try:
            t0 = time.monotonic()
            ok = await cross.ask_other_instance(store_a, token, tenant, ids[0], "whisper", "offer a small discount")
            took = time.monotonic() - t0
            say(ok is True and lines[0].whispers == ["offer a small discount"], f"3a a whisper asked on A is done by B (took {took:.1f} s of the {cross.WAIT_S} s wait)", "True, whisper delivered", f"{ok}, {lines[0].whispers}")
            t0 = time.monotonic()
            ok2 = await cross.ask_other_instance(store_a, token, tenant, ids[1], "hang_up", None)
            took2 = time.monotonic() - t0
            say(ok2 is True and len(lines[1].hung) == 1, f"3b a hang-up asked on A is done by B (took {took2:.1f} s)", "True, hung up", f"{ok2}, {lines[1].hung}")
            ghost = await cross.ask_other_instance(store_a, token, tenant, uuid.uuid4(), "whisper", "x")
            say(ghost is False, "4a a call nobody holds (or not live) is refused, not left waiting", False, ghost)
            other = uuid.uuid4()
            try:
                cross_ws = await cross.ask_other_instance(store_a, token, other, ids[0], "whisper", "x")
            except Exception:  # noqa: BLE001
                cross_ws = False
            say(cross_ws is False, "4b a whisper for another workspace's id is refused", False, cross_ws)
        finally:
            stop.set()
            await task
    finally:
        for cid in ids:
            sql(f"update public.phone_calls set state = 'completed', ended_at = now(), duration_s = 0, end_reason = 'stopped' where id = '{cid}'")
        after = store_a.live_count()
        say(after == base, "5 the synthetic calls are ended: the platform count is back", base, after)
    print("RESULT:", "ALL PASS" if not FAILS else "FAILED: " + ", ".join(FAILS))
    return 0 if not FAILS else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", default="https://sme-api-620338396268.asia-south1.run.app")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    return asyncio.run(main_async(a.api_url))


if __name__ == "__main__":
    sys.exit(main())
