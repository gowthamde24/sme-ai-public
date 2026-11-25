"""LOCAL smoke of the phone side against the local API (./run-local-api.sh) and its FAKE VoiceLink (scripts/fake_voicelink.py): number picker, business KYC per client, buy-first-verify-after.

  python3 scripts/smoke_local_phone.py --i-know-this-is-staging [--api-url http://localhost:8000] [--fake-url http://127.0.0.1:8099] [--pack textiles]

Signs in as the synthetic demo owner of STAGING (like smoke_batch.py), then: lists numbers for sale; starts the business KYC (a fake VoiceLink client); sends the steps and two tiny documents; submits;
claims a number BEFORE the approval (state kyc_pending); approves at the fake; claims again if the first was refused. No real VoiceLink client, number or money is touched: the API must be the local one
started by run-local-api.sh (VOICELINK_API_BASE points at the fake). The demo workspace keeps the fake client and number afterwards (staging data only)."""

from __future__ import annotations

import argparse
import base64
import json
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


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api-url", default="http://localhost:8000")
    p.add_argument("--fake-url", default="http://127.0.0.1:8099")
    p.add_argument("--pack", default="textiles")
    p.add_argument("--i-know-this-is-staging", action="store_true")
    p.add_argument("--open-picker", action="store_true", help="turn the platform switch of the number picker ON on staging for this run and put it back after")
    a = p.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging (this signs in to the STAGING project)")
        return 2
    was = picker_switch(True) if a.open_picker else None
    print(("picker switch on staging was " + ("on" if was else "off") + ", turned on for this run") if was is not None else "picker switch left as it is")
    try:
        return body(a)
    finally:
        if was is not None and not was:
            picker_switch(False)
            print("picker switch put back to off")


def body(a: argparse.Namespace) -> int:
    run = sb.Run(a.api_url, a.pack)
    say = sb.say
    t = run.t
    st, out = run.call("GET", f"{t}/numbers/available?type=mobile&prefix=9001")
    offers = out.get("numbers", []) if isinstance(out, dict) else []
    why = (out.get("error") or {}).get("reason") if isinstance(out, dict) and isinstance(out.get("error"), dict) else None
    say("PASS" if st == 200 and offers else "FAIL", "1 numbers for sale", f"HTTP {st}, {len(offers)} offered, code {sb.code_of(out)}, reason {why}")
    if not offers:
        return 1
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
    st, out = run.call("POST", f"{t}/numbers/claim", {"number": offers[0]["number"], "type": "mobile"})
    first = out.get("state") if isinstance(out, dict) else None
    say("PASS" if st == 201 and first in ("kyc_pending", "ready", "getting_ready") else "FAIL", "9 claim before approval", f"HTTP {st}, state {first}, code {sb.code_of(out)}")
    state = fake(a.fake_url, "GET", "/_fake/state")
    clients = sorted(int(k) for k in state["clients"] if int(k) > 1)
    if clients:
        fake(a.fake_url, "POST", f"/_fake/approve/{clients[-1]}")
        say("PASS", "10 approved at the fake", f"client {clients[-1]} (this stands for VoiceLink's own review)")
    st, out = run.call("GET", f"{t}/phone-kyc/business")
    say("PASS" if st == 200 and out.get("state") == "verified" else "FAIL", "11 KYC now verified", f"HTTP {st}, state {out.get('state') if isinstance(out, dict) else '?'}")
    st, out = run.call("GET", f"{t}/numbers")
    say("PASS" if st == 200 and out.get("numbers") else "FAIL", "12 my numbers", f"HTTP {st}, {len(out.get('numbers', [])) if isinstance(out, dict) else 0} number(s)")
    print(f"\n{sb.RESULTS.count('PASS')} PASS, {sb.RESULTS.count('FAIL')} FAIL, {sb.RESULTS.count('SKIP')} SKIP")
    return 1 if "FAIL" in sb.RESULTS else 0


if __name__ == "__main__":
    sys.exit(main())
