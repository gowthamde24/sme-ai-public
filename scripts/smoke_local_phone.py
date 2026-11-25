"""LOCAL smoke of the phone side against the local API (./run-local-api.sh) and its FAKE VoiceLink (scripts/fake_voicelink.py): number picker, business KYC per client, buy-first-verify-after.

  python3 scripts/smoke_local_phone.py --i-know-this-is-staging [--api-url http://localhost:8000] [--fake-url http://127.0.0.1:8099] [--pack textiles]

Signs in as the synthetic demo owner of STAGING (like smoke_batch.py), then: lists numbers for sale; starts the business KYC (a fake VoiceLink client); sends the steps and two tiny documents; submits;
claims a number BEFORE the approval (state kyc_pending); approves at the fake; claims again if the first was refused. No real VoiceLink client, number or money is touched: the API must be the local one
started by run-local-api.sh (VOICELINK_API_BASE points at the fake). The demo workspace keeps the fake client and number afterwards (staging data only)."""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke_batch as sb  # noqa: E402

PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


def fake(base: str, method: str, path: str) -> dict:
    req = urllib.request.Request(base + path, method=method, data=b"" if method == "POST" else None)
    with urllib.request.urlopen(req, timeout=10) as r:  # noqa: S310
        return json.loads(r.read())


def db_count(sql: str) -> int:
    """One count from the staging database (this checkout must be linked to it); -1 when it cannot be read."""
    ref_file = sb.ROOT / "supabase" / ".temp" / "project-ref"
    if not ref_file.exists() or ref_file.read_text().strip() != sb.STAGING_REF:
        return -1
    r = sb.subprocess.run(["supabase", "db", "query", "--linked", sql], cwd=sb.ROOT, capture_output=True, text=True, timeout=120)
    for line in r.stdout.splitlines():
        if '"n"' in line:
            return int(line.split(":")[1].strip().rstrip(","))
    return -1


def picker_switch(value: bool) -> bool | None:
    """STAGING only (the checkout must be linked to it): flips ops.picker_settings.enabled, the platform switch of the number picker, and returns what it was (None when it cannot be read or set)."""
    ref_file = sb.ROOT / "supabase" / ".temp" / "project-ref"
    if not ref_file.exists() or ref_file.read_text().strip() != sb.STAGING_REF:
        return None
    def q(sql: str) -> str | None:
        r = sb.subprocess.run(["supabase", "db", "query", "--linked", sql], cwd=sb.ROOT, capture_output=True, text=True, timeout=120)
        return r.stdout if r.returncode == 0 else None
    before = q("select enabled from ops.picker_settings")
    if before is None:
        return None
    was = '"enabled": true' in before
    if q(f"update ops.picker_settings set enabled = {'true' if value else 'false'}") is None:
        return None
    return was


def cleanup(tenant: str, fake_base: str, number: str) -> None:
    """Deletes what THIS run made in the staging database, so the demo workspace can pick a number again. Only when the VoiceLink behind the API is the fake one (its state lists the bought number and the client);
    only this workspace's rows; only the fake purchase (order number FAKE-...), the fake client id the fake server knows and the line row of that number; and only an alert this run raised (last 30 minutes)."""
    ref_file = sb.ROOT / "supabase" / ".temp" / "project-ref"
    if not ref_file.exists() or ref_file.read_text().strip() != sb.STAGING_REF:
        print("cleanup skipped: this checkout is not linked to staging")
        return
    try:
        state = fake(fake_base, "GET", "/_fake/state")
    except OSError:
        print("cleanup skipped: the fake VoiceLink is not answering, so these rows cannot be proven fake")
        return
    digits = number.lstrip("+")
    clients = [int(k) for k in state.get("clients", {}) if int(k) > 1]
    if digits not in state.get("bought", []) or not clients or not re.fullmatch(r"\+91[0-9]{10}", number) or not re.fullmatch(r"[0-9a-f-]{36}", tenant):
        print("cleanup skipped: nothing of this run is in the fake VoiceLink")
        return
    ids = ",".join(str(c) for c in clients)
    sql = (f"with a as (delete from ops.number_purchases where tenant_id = '{tenant}' and number = '{number}' and order_number like 'FAKE-%' returning 1), "
           f"l as (delete from public.phone_numbers where tenant_id = '{tenant}' and number = '{number}' and provider = 'voicelink' returning 1), "
           f"b as (delete from telephony.business_clients where tenant_id = '{tenant}' and client_id in ({ids}) returning 1), "
           f"w as (delete from telephony.line_waits where tenant_id = '{tenant}' returning 1), "
           f"n as (delete from admin.alerts where kind = 'telephony_setting' and detail like 'Number picker:%' and created_at > now() - interval '30 minutes' returning 1) "
           "select (select count(*) from a) as purchases, (select count(*) from l) as lines, (select count(*) from b) as clients, (select count(*) from n) as alerts")
    r = sb.subprocess.run(["supabase", "db", "query", "--linked", sql], cwd=sb.ROOT, capture_output=True, text=True, timeout=120)
    try:
        fake(fake_base, "POST", "/_fake/reset")   # the fake forgets this run's client, e-mail and purchase too
    except OSError:
        pass
    print("cleanup of this run's fake rows:", "done" if r.returncode == 0 else "FAILED", "|", " ".join(l.strip() for l in r.stdout.splitlines() if any(k in l for k in ("purchases", "lines", "clients", "alerts"))))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api-url", default="http://localhost:8000")
    p.add_argument("--fake-url", default="http://127.0.0.1:8099")
    p.add_argument("--pack", default="textiles")
    p.add_argument("--i-know-this-is-staging", action="store_true")
    p.add_argument("--keep-rows", action="store_true", help="leave the fake client, purchase and line this run made in the staging database (default: delete them at the end)")
    p.add_argument("--open-picker", action="store_true", help="turn the platform switch of the number picker ON on staging for this run and put it back after")
    a = p.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging (this signs in to the STAGING project)")
        return 2
    was = picker_switch(True) if a.open_picker else None
    print(("picker switch on staging was " + ("on" if was else "off") + ", turned on for this run") if was is not None else "picker switch left as it is")
    try:
        return body(a, "verify-first")
    finally:
        if was is not None and not was:
            picker_switch(False)
            print("picker switch put back to off")


def body(a: argparse.Namespace, order: str) -> int:
    print(f"\n=== order: {order} (the only path for a new number) ===")
    try:
        fake(a.fake_url, "POST", "/_fake/reset")   # the fake starts from nothing
    except OSError:
        pass
    run = sb.Run(a.api_url, a.pack)
    say = sb.say
    t = run.t
    st, out = run.call("GET", f"{t}/numbers/available?type=mobile&prefix=9001")
    offers = out.get("numbers", []) if isinstance(out, dict) else []
    why = (out.get("error") or {}).get("reason") if isinstance(out, dict) and isinstance(out.get("error"), dict) else None
    say("PASS" if st == 200 and offers else "FAIL", "1 numbers for sale", f"HTTP {st}, {len(offers)} offered, code {sb.code_of(out)}, reason {why}")
    if not offers:
        return 1
    claimed = offers[0]["number"]
    try:
        return steps(run, a, offers, claimed, order == "verify-first")
    finally:
        if not a.keep_rows:
            cleanup(run.tenant, a.fake_url, claimed)


def steps(run: sb.Run, a: argparse.Namespace, offers: list, claimed: str, verify_first: bool) -> int:   # type: ignore[type-arg]
    say = sb.say
    t = run.t
    st0, out0 = run.call("POST", f"{t}/numbers/claim", {"number": claimed, "type": "mobile"})   # nothing is bought before the KYC: a plain 409 kyc_required
    why0 = (out0.get("error") or {}).get("reason") if isinstance(out0, dict) and isinstance(out0.get("error"), dict) else None
    say("PASS" if st0 == 409 and why0 == "kyc_required" else "FAIL", "1b a purchase before the KYC is refused", f"HTTP {st0}, reason {why0}")
    # no free channel at VoiceLink (the fake's pool is all on our own client, as on the real account): the business WAITS for its line, it is not turned away
    stw, outw = run.call("POST", f"{t}/phone-kyc/business/start")
    say("PASS" if stw == 201 and isinstance(outw, dict) and outw.get("state") == "waiting_for_line" and "short while" in str(outw.get("words")) else "FAIL", "2a no free channel: the business waits", f"HTTP {stw}, state {outw.get('state') if isinstance(outw, dict) else '?'}")
    waits = db_count(f"select count(*) as n from telephony.line_waits where tenant_id = '{run.tenant}'")
    say("PASS" if waits == 1 else "FAIL", "2b the staff alert has its row (no_free_channels)", f"{waits} waiting")
    stw2, outw2 = run.call("GET", f"{t}/phone-kyc/business")
    say("PASS" if stw2 == 200 and outw2.get("state") == "waiting_for_line" else "FAIL", "2c the Owner's poll still waits (nothing is free)", f"state {outw2.get('state') if isinstance(outw2, dict) else '?'}")
    fake(a.fake_url, "POST", "/_fake/add-channel?n=1")   # the staff bought a channel at VoiceLink
    stw3, outw3 = run.call("GET", f"{t}/phone-kyc/business")
    say("PASS" if stw3 == 200 and outw3.get("state") == "created" and db_count(f"select count(*) as n from telephony.line_waits where tenant_id = '{run.tenant}'") == 0 else "FAIL", "2d the next poll makes the client and the wait ends", f"state {outw3.get('state') if isinstance(outw3, dict) else '?'}")
    st, out = run.call("GET", f"{t}/phone-kyc/business")
    say("PASS" if st == 200 else "FAIL", "2 KYC status", f"HTTP {st}, state {out.get('state') if isinstance(out, dict) else '?'}")
    if isinstance(out, dict) and out.get("state") == "verified":
        say("SKIP", "3-8 KYC steps", "this workspace is already verified at the fake")
    else:
        for name, path, body in (
            ("3 start", "/start", None),
            ("4 details", "/details", {"account_type": "business", "business_name": "Smoke Textiles", "full_name": "Smoke Owner", "phone": "+919876500001", "billing_address": "12 Market Road, Hyderabad", "state": "Telangana", "city": "Hyderabad", "pincode": "500001", "accept_terms": True}),
            ("5 pan", "/pan", {"pan_number": "ABCDE1234F", "holder_name": "Smoke Owner"}),
            ("6 aadhaar link", "/aadhaar", None),
            ("7a document pan", "/documents", {"document_type": "pan", "content_type": "image/png", "content_base64": PNG}),
            ("7b document aadhaar", "/documents", {"document_type": "aadhaar", "content_type": "image/png", "content_base64": PNG}),
            ("8 submit", "/submit", None),
        ):
            st, out = run.call("POST", f"{t}/phone-kyc/business{path}", body)
            say("PASS" if st in (200, 201) else "FAIL", f"KYC {name}", f"HTTP {st}, code {sb.code_of(out)}")
    def approve() -> None:
        state = fake(a.fake_url, "GET", "/_fake/state")
        clients = sorted(int(k) for k in state["clients"] if int(k) > 1)
        if clients:
            fake(a.fake_url, "POST", f"/_fake/approve/{clients[-1]}")
            say("PASS", "10 approved at the fake", f"client {clients[-1]} (this stands for VoiceLink's own review)")

    def verified() -> None:
        st2, out2 = run.call("GET", f"{t}/phone-kyc/business")
        say("PASS" if st2 == 200 and out2.get("state") == "verified" else "FAIL", "11 KYC now verified", f"HTTP {st2}, state {out2.get('state') if isinstance(out2, dict) else '?'}")

    if verify_first:   # the second path: the whole verification BEFORE any number is bought; the purchase then starts with calls ON
        approve()
        verified()
    st, out = run.call("POST", f"{t}/numbers/claim", {"number": claimed, "type": "mobile"})
    first = out.get("state") if isinstance(out, dict) else None
    allowed = ("ready",) if verify_first else ("kyc_pending", "ready", "getting_ready")
    say("PASS" if st == 201 and first in allowed else "FAIL", "9 claim " + ("after the KYC (verify first)" if verify_first else "before approval (buy first)"), f"HTTP {st}, state {first}, code {sb.code_of(out)}")
    if not verify_first:
        approve()
        verified()
    st, out = run.call("GET", f"{t}/numbers")
    rows = out.get("numbers", []) if isinstance(out, dict) else []
    want = "calls_on" if verify_first else None
    ok = st == 200 and bool(rows) and (want is None or rows[0].get("state") == want)
    say("PASS" if ok else "FAIL", "12 my numbers", f"HTTP {st}, {len(rows)} number(s), state {rows[0].get('state') if rows else None}" + (f" (want {want})" if want else ""))
    print(f"\n{sb.RESULTS.count('PASS')} PASS, {sb.RESULTS.count('FAIL')} FAIL, {sb.RESULTS.count('SKIP')} SKIP")
    return 1 if "FAIL" in sb.RESULTS else 0


if __name__ == "__main__":
    sys.exit(main())
