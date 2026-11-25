"""CALL CHARGING PROOF (26 Nov 2026): the wallet pays for calls, end to end, on STAGING data, with the fake VoiceLink and no real call.

  python3 -I scripts/charging_proof.py --i-know-this-is-staging [--api-url http://localhost:8000] [--report reports/charging-proof.md]

The API must be the local one from ./run-local-api.sh (BILLING_CHARGE_CALLS and PRICING_V2 on, the Razorpay TEST webhook secret in its environment, fake VoiceLink and no sending). The script:
  * makes ONE synthetic, billable (NOT billing-exempt) workspace "Charging proof" with its own Owner (an account on the synthetic demo domain; the password lives only in Secret Manager),
  * writes the calls the way the phone server leaves them (a `phone_calls` row, answered seconds) and charges each through the system account's `pricing_charge_call` (the one RPC `CallCharger` makes),
  * credits through the real route (a Razorpay TEST order and the SIGNED webhook), reads the Owner's own balance, statement and invoices through the API,
  * checks the gates the phone lookups use (`app.wallet_gate`) and the worker's reconcile query (`pricing_uncharged_calls`).
Every check prints PASS or FAIL with the exact numbers; the same text is the proof report. Nothing is dialled, nothing is sent, no money moves (test mode)."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
import smoke_batch as sb  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
import time  # noqa: E402

EMAIL = f"charging-proof-{time.strftime('%m%d%H%M%S')}@demo.example.test"   # a new synthetic Owner (and so a new workspace) for every run; they all use the one password in Secret Manager
SECRET = "sme-charging-proof-password"
NAME = "Charging proof"
LINES: list[str] = []
FAILS: list[str] = []


def say(ok: bool, step: str, expected: Any, got: Any) -> None:
    line = f"{'PASS' if ok else 'FAIL'}  {step}: expected {expected}, got {got}"
    print(line)
    LINES.append(line)
    if not ok:
        FAILS.append(step)


def note(text: str) -> None:
    print(text)
    LINES.append(text)


def sql(statement: str) -> list[dict[str, Any]]:
    if (ROOT / "supabase" / ".temp" / "project-ref").read_text().strip() != ss.STAGING_REF:
        raise ss.SeedError("this checkout is not linked to the staging project")
    out = subprocess.run(["supabase", "db", "query", "--linked", statement], cwd=ROOT, capture_output=True, text=True, timeout=180, check=False)  # noqa: S603, S607
    text = out.stdout + out.stderr
    if out.returncode != 0 and '"rows"' not in text:
        raise ss.SeedError("a database statement failed: " + text[-300:])
    body = text[text.index("{") : text.rindex("}") + 1]
    return list(json.loads(body).get("rows", []))


class Proof:
    def __init__(self, api: str) -> None:
        self.s = ss.Seeder("https://sme-api-620338396268.asia-south1.run.app")   # only for its keys and helpers; the API under test is `api`
        self.s.api = api.rstrip("/")
        self.api = self.s.api
        terms = self.s.terms()
        password = ss.secret_get(SECRET)
        if password is None:
            password = ss.new_password()
            ss.secret_put(SECRET, password)
        self.s.create_user(EMAIL, password, {"terms_version": terms["terms"], "business_name": NAME})
        self.token = self.s.sign_in(EMAIL, password)["access_token"]
        st, setup = self.s.call(self.token, "POST", "/v1/account/setup", {"business_type": "textiles", "language": "en", "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
        if st != 200 or not isinstance(setup, dict):
            raise ss.SeedError(f"setup failed (HTTP {st})")
        self.tenant = str(setup["tenant_id"])
        self.t = f"/v1/tenants/{self.tenant}"
        sched_pw = ss.secret_get("sme-scheduler-password")
        if sched_pw is None:
            raise ss.SeedError("no scheduler password in Secret Manager")
        self.sched = self.s.sign_in(ss.SCHEDULER_EMAIL, sched_pw)["access_token"]

    # ---- reads
    def api_get(self, path: str) -> Any:
        return self.s.call(self.token, "GET", path)[1]

    def balance(self) -> dict[str, Any]:
        out = self.api_get(f"{self.t}/billing/balance")
        return out if isinstance(out, dict) else {}

    def lots(self) -> list[tuple[str, int]]:
        rows = sql(f"select source, remaining_paise from pricing.wallet_lots where tenant_id = '{self.tenant}' order by expires_at, created_at")  # noqa: S608
        return [(str(r["source"]), int(r["remaining_paise"])) for r in rows]

    def gate(self) -> dict[str, Any]:
        rows = sql(f"select app.wallet_gate('{self.tenant}') as g")  # noqa: S608
        g = rows[0]["g"]
        return g if isinstance(g, dict) else json.loads(g)

    def owed(self) -> int:
        rows = sql(f"select coalesce((select owed_paise from pricing.debts where tenant_id = '{self.tenant}'), 0) as o")  # noqa: S608
        return int(rows[0]["o"])

    # ---- writes
    def call_row(self, *, direction: str, seconds: int, answered: bool, state: str = "completed", sandbox: bool = False, simulated: bool = False) -> str:
        cid = str(uuid.uuid4())
        ans = "now() - interval '10 minutes'" if answered else "null"
        end = "now() - interval '5 minutes'"
        reason = {"completed": "goodbye", "no_answer": "no_answer", "busy": "busy", "failed": "error"}.get(state, "goodbye")
        sql(
            "insert into public.phone_calls (id, tenant_id, direction, state, provider, sandbox, simulated, purpose, answered_at, ended_at, duration_s, end_reason) "  # noqa: S608
            f"values ('{cid}', '{self.tenant}', '{direction}', '{state}', 'voicelink', {str(sandbox).lower()}, {str(simulated).lower()}, '{'inbound' if direction == 'inbound' else 'sales_followup'}', {ans}, {end}, {seconds}, '{reason}')"
        )
        return cid

    def charge(self, cid: str, seconds: int, answered: bool = True) -> dict[str, Any]:
        url = f"{self.s.sb}/rest/v1/rpc/pricing_charge_call"
        body = json.dumps({"p_tenant_id": self.tenant, "p_call_id": cid, "p_seconds": seconds, "p_answered": answered}).encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={"apikey": self.s.pub, "Authorization": f"Bearer {self.sched}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
                out = json.loads(r.read())
        except urllib.error.HTTPError as exc:
            raise ss.SeedError(f"charge refused: HTTP {exc.code}") from None
        return out if isinstance(out, dict) else {}

    def uncharged(self) -> list[dict[str, Any]]:
        url = f"{self.s.sb}/rest/v1/rpc/pricing_uncharged_calls"
        req = urllib.request.Request(url, data=b'{"p_limit": 200}', method="POST", headers={"apikey": self.s.pub, "Authorization": f"Bearer {self.sched}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            out = json.loads(r.read())
        return [x for x in out if isinstance(x, dict) and str(x.get("tenant_id")) == self.tenant]

    def topup(self, rupees: int) -> dict[str, Any]:
        secret = sb.webhook_secret()
        if secret is None:
            raise ss.SeedError("no BILLING_RAZORPAY_WEBHOOK_SECRET here (the local run sources the owner's test file)")
        st, order = self.s.call(self.token, "POST", f"{self.t}/billing/credits/topups", {"amount_rupees": rupees})
        if st not in (200, 201) or not isinstance(order, dict):
            raise ss.SeedError(f"top-up order HTTP {st}")
        paid = int(order["amount_paise"])
        body = json.dumps({"event": "order.paid", "payload": {"order": {"entity": {"id": order["order_id"], "amount_paid": paid, "notes": {"tenant_id": self.tenant}}}, "payment": {"entity": {"id": "pay_PROOF" + uuid.uuid4().hex[:14], "order_id": order["order_id"], "amount": paid, "notes": {"tenant_id": self.tenant}}}}}).encode()
        sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        st2, _ = sb.raw_post(f"{self.api}/v1/webhooks/razorpay-billing", body, {"Content-Type": "application/json", "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": "proof-" + uuid.uuid4().hex})
        if st2 not in (200, 202):
            raise ss.SeedError(f"signed webhook HTTP {st2}")
        return order


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", default="http://localhost:8000")
    ap.add_argument("--report", default=str(ROOT.parent.parent / "Desktop" / "stack19-jobs" / "reports" / "charging-proof.md"))
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    p = Proof(a.api_url)
    note(f"Workspace: synthetic 'Charging proof' (billable, not exempt), pay-as-you-go plan: Rs 5 a minute = 250 paise per 30-second block. API: {a.api_url} (local, BILLING_CHARGE_CALLS and PRICING_V2 on); data: the staging database.")
    exempt = sql(f"select billing_exempt from public.tenants where id = '{p.tenant}'")[0]["billing_exempt"]  # noqa: S608
    say(exempt is False, "0 the workspace is billable (not billing-exempt)", False, exempt)

    # ---- 1. the trial credit comes first
    sql(f"select pricing.credit('{p.tenant}', 'free_start', 'proof-trial', 3000)")  # noqa: S608   # what the trial claim writes: Rs 30
    say(p.balance().get("balance_paise") == 3000, "1a trial credit Rs 30 in the wallet", 3000, p.balance().get("balance_paise"))
    # a top-up bought later: the trial credit expires first, so it is spent first
    order = p.topup(100)
    bal = p.balance()
    say(int(bal.get("balance_paise", 0)) == 13000, "1b top-up Rs 100 (added before GST) by the SIGNED webhook: balance Rs 130", 13000, bal.get("balance_paise"))
    note(f"   order total {order.get('total_text')} = {order.get('added_text')} added + {order.get('gst_text')} GST; lots (oldest expiry first): {p.lots()}")

    # ---- 2. 30-second blocks, rounded up
    c1 = p.call_row(direction="inbound", seconds=31, answered=True)
    r1 = p.charge(c1, 31)
    say(r1.get("half_minutes") == 2 and r1.get("charged_paise") == 500, "2a inbound answered 31 s = 2 blocks = Rs 5.00", "2 blocks, 500 paise", f"{r1.get('half_minutes')} blocks, {r1.get('charged_paise')} paise")
    c2 = p.call_row(direction="outbound", seconds=70, answered=True)
    r2 = p.charge(c2, 70)
    say(r2.get("half_minutes") == 3 and r2.get("charged_paise") == 750, "2b outbound answered 70 s = 3 blocks = Rs 7.50 (the rate is the same in and out)", "3 blocks, 750 paise", f"{r2.get('half_minutes')} blocks, {r2.get('charged_paise')} paise")
    c3 = p.call_row(direction="outbound", seconds=30, answered=True)
    r3 = p.charge(c3, 30)
    say(r3.get("half_minutes") == 1 and r3.get("charged_paise") == 250, "2c exactly 30 s = 1 block = Rs 2.50", "1 block, 250 paise", f"{r3.get('half_minutes')} block, {r3.get('charged_paise')} paise")
    lots = p.lots()
    say(lots[0] == ("free_start", 3000 - 500 - 750 - 250), "2d the trial credit pays first (the lot that expires first), the top-up is untouched", ("free_start", 1500), lots[0])
    say(lots[1] == ("topup", 10000), "2e ... top-up lot still Rs 100", ("topup", 10000), lots[1])

    # ---- 3. nothing for a call nobody answers
    before = int(p.balance()["balance_paise"])
    for state, seconds, why in (("no_answer", 0, "no answer"), ("busy", 0, "busy"), ("failed", 0, "failed")):
        cid = p.call_row(direction="outbound", seconds=seconds, answered=False, state=state)
        r = p.charge(cid, seconds, answered=False)
        say(r.get("charged_paise") == 0 and r.get("half_minutes") == 0, f"3 {why}: free", "0 paise", f"{r.get('charged_paise')} paise, {r.get('half_minutes')} blocks")
    say(int(p.balance()["balance_paise"]) == before, "3d the balance did not move for unanswered, busy or failed calls", before, p.balance().get("balance_paise"))

    # ---- 4. charged once; tests are free
    again = p.charge(c1, 31)
    say(again.get("replayed") is True and int(p.balance()["balance_paise"]) == before, "4a the same call id again is a replay: no second charge", "replayed, same balance", f"replayed={again.get('replayed')}, balance {p.balance().get('balance_paise')}")
    t1 = p.call_row(direction="outbound", seconds=120, answered=True, sandbox=True)
    rt = p.charge(t1, 120)
    say(rt.get("skipped") == "test_call" and int(p.balance()["balance_paise"]) == before, "4b a sandbox (test) call of 120 s is free", "skipped test_call", rt.get("skipped"))
    t2 = p.call_row(direction="outbound", seconds=120, answered=True, simulated=True)
    rs = p.charge(t2, 120)
    say(rs.get("skipped") == "test_call", "4c a simulated call of 120 s is free", "skipped test_call", rs.get("skipped"))
    # the worker's reconcile: an answered call that ended without a charge is found (not the test calls)
    missed = p.call_row(direction="outbound", seconds=60, answered=True)
    found = [x for x in p.uncharged() if str(x.get("call_id")) == missed]
    say(len(found) == 1 and found[0].get("seconds") == 60, "4d the worker's reconcile finds an answered call that has no charge row", "1 found, 60 s", f"{len(found)} found")
    rm = p.charge(missed, 60)
    say(rm.get("charged_paise") == 500, "4e ... and charges it (60 s = 2 blocks = Rs 5.00)", 500, rm.get("charged_paise"))
    say(not [x for x in p.uncharged() if str(x.get("call_id")) in (t1, t2)], "4f ... and never lists a sandbox or simulated call", "none", "none listed")

    # ---- 5. run the wallet empty with OUTBOUND calls: the wallet never goes below zero, no debt
    bal_now = int(p.balance()["balance_paise"])
    g0 = p.gate()
    say(g0.get("outbound_ok") is True and g0.get("inbound_ok") is True, "5a with credit in the wallet both gates are open", "outbound_ok, inbound_ok", g0)
    cid = p.call_row(direction="outbound", seconds=3600, answered=True)   # a long call: 120 blocks = Rs 300; the wallet holds less
    rl = p.charge(cid, 3600)
    note(f"   an outbound call of 3600 s asks Rs {rl.get('charged_paise', 0) / 100:.2f} with Rs {bal_now / 100:.2f} in the wallet: shortfall {rl.get('shortfall_paise')} paise")
    say(int(p.balance()["balance_paise"]) == 0, "5b the wallet stops at zero, never below", 0, p.balance().get("balance_paise"))
    say(p.owed() == 0, "5c an OUTBOUND call leaves no debt (it was checked before it started)", 0, p.owed())
    g1 = p.gate()
    say(g1.get("outbound_ok") is False, "5d outbound is refused now (wallet_low): the balance is under one minute (Rs 5) and the plan has no included minutes", "outbound_ok false", g1)
    say(g1.get("inbound_ok") is True, "5e inbound is still answered (no debt yet)", "inbound_ok true", g1)

    # ---- 6. inbound past an empty wallet: a debt, up to the floor (Rs 50), then billing_blocked
    done = 0
    guard = 0
    while p.gate().get("inbound_ok") is True and guard < 20:
        cid = p.call_row(direction="inbound", seconds=240, answered=True)   # 8 blocks = Rs 20
        r = p.charge(cid, 240)
        done += 1
        guard += 1
        note(f"   inbound call {done}: 240 s = {r.get('half_minutes')} blocks, asked {r.get('charged_paise')} paise, shortfall {r.get('shortfall_paise')} paise, owed now {p.owed()} paise")
    owed = p.owed()
    g2 = p.gate()
    say(owed >= 5000, "6a debt grows with inbound calls past an empty wallet until it reaches the floor (Rs 50)", ">= 5000 paise", f"{owed} paise after {done} calls")
    say(g2.get("inbound_ok") is False, "6b at the floor the assistant stops taking calls with AI (inbound refused as billing_blocked)", "inbound_ok false", g2)
    say(int(p.balance().get("balance_paise", 0)) == 0 and int(p.balance().get("owed_paise", -1)) == owed, "6c the Owner's balance shows 0 and owes the same amount", f"0 / {owed}", f"{p.balance().get('balance_paise')} / {p.balance().get('owed_paise')}")

    # ---- 7. a top-up pays the debt first
    order2 = p.topup(100)
    bal2 = p.balance()
    expected = 10000 - owed
    say(int(bal2.get("balance_paise", 0)) == expected and int(bal2.get("owed_paise", 0)) == 0, f"7a a Rs 100 top-up pays the debt of {owed} paise first: balance {expected}, owed 0", f"{expected} / 0", f"{bal2.get('balance_paise')} / {bal2.get('owed_paise')}")
    g3 = p.gate()
    say(g3.get("inbound_ok") is True and g3.get("outbound_ok") is True, "7b both gates are open again", "both true", g3)

    # ---- 8. statement and invoices as the Owner reads them
    st = p.api_get(f"{p.t}/billing/credits/statement?limit=100")
    items = st.get("items", []) if isinstance(st, dict) else []
    kinds: dict[str, int] = {}
    for it in items:
        kinds[str(it.get("kind"))] = kinds.get(str(it.get("kind")), 0) + 1
    note(f"   statement: {len(items)} lines {kinds}; opening {st.get('opening_text') if isinstance(st, dict) else '?'}, closing {st.get('closing_text') if isinstance(st, dict) else '?'}")
    usage_total = sum(abs(int(it.get("amount_paise", 0))) for it in items if it.get("kind") == "usage")
    rows = sql(f"select coalesce(sum(charged_paise), 0) as c, coalesce(sum(shortfall_paise), 0) as s from pricing.usage where tenant_id = '{p.tenant}' and kind = 'call'")  # noqa: S608
    asked, short = int(rows[0]["c"]), int(rows[0]["s"])
    charged = asked - short   # what the wallet actually paid: the statement shows money that moved, not the part nobody could pay
    note(f"   usage rows asked {asked} paise; of that {short} paise could not be paid (the outbound call of 3600 s left {int(rl.get('shortfall_paise') or 0)} and three inbound calls left 6000 as a debt); the wallet paid {charged}")
    say(kinds.get("credit", 0) >= 3 and kinds.get("usage", 0) >= 1 and usage_total == int(charged) + owed, "8a the statement lists the credits (trial, top-ups) and the money the calls took (paid from the wallet, plus the debt a top-up paid)", f"credits >= 3, usage sum {int(charged)} + {owed}", f"{kinds}, usage sum {usage_total}")
    closing = int(st.get("closing_paise", -1)) if isinstance(st, dict) else -1
    say(closing == int(p.balance().get("balance_paise", -2)), "8a2 the statement closes at the balance (the debt the second top-up paid is a line of its own)", p.balance().get("balance_paise"), closing)
    debt_lines = [it for it in items if it.get("label") == "Calls taken while your balance was empty"]
    say(len(debt_lines) == 1 and int(debt_lines[0].get("amount_paise", 0)) == -owed, "8a3 ... 'Calls taken while your balance was empty'", -owed, [x.get("amount_paise") for x in debt_lines])
    inv = p.api_get(f"{p.t}/billing/gst-invoices")
    inv_items = inv.get("items", inv) if isinstance(inv, dict) else inv
    n_inv = len(inv_items) if isinstance(inv_items, list) else -1
    say(n_inv == 2, "8b one GST invoice per paid top-up (two top-ups), none for calls or the trial credit", 2, n_inv)
    ok_all = not FAILS
    note(f"RESULT: {'ALL PASS' if ok_all else 'FAILED: ' + ', '.join(FAILS)}")
    out = Path(a.report)
    out.parent.mkdir(parents=True, exist_ok=True)
    header = "# Call charging proof (C1, 26 Nov 2026)\n\nRun on staging data with the local API (BILLING_CHARGE_CALLS and PRICING_V2 on), the fake VoiceLink and no real call; script `scripts/charging_proof.py`. Numbers are paise (100 paise = Rs 1).\n\n```\n"
    out.write_text(header + "\n".join(LINES) + "\n```\n", encoding="utf-8")
    print("wrote", out)
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
