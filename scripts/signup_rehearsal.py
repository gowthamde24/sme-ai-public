"""SIGN-UP OPENING REHEARSAL on STAGING data (26 Nov 2026): a full self-serve sign-up against the local API (./run-local-api.sh: SIGNUP_OPEN, PRICING_V2, the fake phone sender), the staging database.

  python3 -I scripts/signup_rehearsal.py --i-know-this-is-staging [--api-url http://localhost:8000]

It opens the database switch (`signup.settings.open`) and the e-mail-only mode for the run and puts BOTH back as it found them, even when a check fails. A new synthetic account is made through the auth admin API with
its e-mail ALREADY CONFIRMED: the confirmation mail itself (Supabase Auth through Resend) is NOT exercised here; that needs a mailbox somebody can read (see reports/signup-opening-package.md). Prints PASS / FAIL with the numbers."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FAILS: list[str] = []
LINES: list[str] = []


def say(ok: bool, step: str, expected: Any, got: Any) -> None:
    line = f"{'PASS' if ok else 'FAIL'}  {step}: expected {expected}, got {got}"
    print(line)
    LINES.append(line)
    if not ok:
        FAILS.append(step)


def sql(statement: str) -> str:
    if (ROOT / "supabase" / ".temp" / "project-ref").read_text().strip() != ss.STAGING_REF:
        raise ss.SeedError("this checkout is not linked to the staging project")
    out = subprocess.run(["supabase", "db", "query", "--linked", statement], cwd=ROOT, capture_output=True, text=True, timeout=180, check=False)  # noqa: S603, S607
    return out.stdout + out.stderr


def settings() -> dict[str, Any]:
    import json

    t = sql("select open, phone_required, email_only_paise, email_only_daily_cap, trial_daily_cap from signup.settings")
    return dict(json.loads(t[t.index("{") : t.rindex("}") + 1])["rows"][0])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api-url", default="http://localhost:8000")
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    a = ap.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging")
        return 2
    s = ss.Seeder("https://sme-api-620338396268.asia-south1.run.app")
    s.api = a.api_url.rstrip("/")
    saved = settings()
    print("settings found:", saved)
    try:
        sql("update signup.settings set open = true, phone_required = false")
        stamp = time.strftime("%m%d%H%M%S")
        email = f"signup-rehearsal-{stamp}@demo.example.test"
        password = ss.new_password()
        terms = s.terms()
        s.create_user(email, password, {"terms_version": terms["terms"], "business_name": "Rehearsal Silks"})
        token = s.sign_in(email, password)["access_token"]
        st, status = s.call(token, "GET", "/v1/signup/status")
        say(st == 200 and status.get("open") is True and status.get("email_confirmed") is True and status.get("phone_required") is False and status.get("trial_claimed") is False, "1 status: open, e-mail confirmed, phone not required, nothing claimed yet", "open, confirmed, no phone needed", {k: status.get(k) for k in ("open", "email_confirmed", "phone_required", "consent_done", "trial_claimed")})
        for kind, key in (("terms", "terms_version"), ("privacy", "privacy_version"), ("aup", "aup_version")):
            c, _ = s.call(token, "POST", "/v1/signup/consent", {"kind": kind, "version": status[key]})
            say(c == 200, f"2 consent: {kind}", 200, c)
        bad, _ = s.call(token, "POST", "/v1/signup/consent", {"kind": "terms", "version": "2000-01"})
        say(bad == 422, "2d an old version never counts", 422, bad)
        st, setup = s.call(token, "POST", "/v1/account/setup", {"business_type": "textiles", "language": "en", "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
        tenant = str(setup["tenant_id"]) if st == 200 and isinstance(setup, dict) else ""
        say(bool(tenant), "3 first run: the workspace is made (Saree shop)", "a workspace", st)
        t = f"/v1/tenants/{tenant}"
        _, bal0 = s.call(token, "GET", f"{t}/billing/balance")
        say(int(bal0.get("balance_paise", -1)) == 0, "4 before the claim the balance is zero", 0, bal0.get("balance_paise"))
        c, claim = s.call(token, "POST", f"{t}/billing/trial-claim")
        say(c == 200 and claim.get("granted") is True and int(claim.get("balance_paise", 0)) == int(saved["email_only_paise"]), "5 the e-mail-only trial is granted once", f"granted, {saved['email_only_paise']} paise", {k: claim.get(k) for k in ("granted", "reason", "balance_paise")})
        c, again = s.call(token, "POST", f"{t}/billing/trial-claim")
        say(c == 200 and again.get("granted") is False and again.get("reason") in ("already_granted", "email_used"), "5b a second claim gives nothing (the same identity already had its credit)", "already_granted or email_used", again.get("reason"))
        # a new account with the phone step required and no phone: refused with its closed word
        sql("update signup.settings set phone_required = true")
        email2 = f"signup-rehearsal-{stamp}b@demo.example.test"
        s.create_user(email2, password, {"terms_version": terms["terms"], "business_name": "Rehearsal Two"})
        token2 = s.sign_in(email2, password)["access_token"]
        for kind, key in (("terms", "terms_version"), ("privacy", "privacy_version"), ("aup", "aup_version")):
            s.call(token2, "POST", "/v1/signup/consent", {"kind": kind, "version": status[key]})
        st2, setup2 = s.call(token2, "POST", "/v1/account/setup", {"business_type": "textiles", "language": "en", "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
        t2 = f"/v1/tenants/{setup2['tenant_id']}" if st2 == 200 and isinstance(setup2, dict) else ""
        c, ref = s.call(token2, "POST", f"{t2}/billing/trial-claim")
        say(c == 200 and ref.get("granted") is False and ref.get("reason") == "phone_not_verified", "6 with the phone step required, no phone: no credit (phone_not_verified)", "phone_not_verified", ref.get("reason"))
        # the Add credits path: what the screen gets
        c, opts = s.call(token, "GET", f"{t}/billing/credits/topup-options")
        say(c == 200 and isinstance(opts, dict), "7 'Add credits' options", "HTTP 200", f"{c}: mode={opts.get('mode') if isinstance(opts, dict) else '?'}, checkout_ready={opts.get('checkout_ready') if isinstance(opts, dict) else '?'}, presets={len(opts.get('presets', [])) if isinstance(opts, dict) else '?'}")
        c, order = s.call(token, "POST", f"{t}/billing/credits/topups", {"amount_rupees": 100})
        print("   top-up order:", c, {k: order.get(k) for k in ("mode", "provider", "key_id", "amount_paise")} if isinstance(order, dict) else order)
        LINES.append(f"   top-up order: HTTP {c}, mode {order.get('mode') if isinstance(order, dict) else '?'}")
    finally:
        sql(f"update signup.settings set open = {str(saved['open']).lower()}, phone_required = {str(saved['phone_required']).lower()}")
        back = settings()
        print("settings put back:", back)
        say(back["open"] == saved["open"] and back["phone_required"] == saved["phone_required"], "9 the switches are back as found", f"open={saved['open']}, phone_required={saved['phone_required']}", f"open={back['open']}, phone_required={back['phone_required']}")
    print("RESULT:", "ALL PASS" if not FAILS else "FAILED: " + ", ".join(FAILS))
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
