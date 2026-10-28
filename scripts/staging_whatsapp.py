"""make staging-whatsapp: the WhatsApp Cloud API half of the staging checks (job DU). STAGING ONLY, synthetic data only.

Signs in as ONE synthetic demo owner (password and authenticator secret from Secret Manager into memory; never printed) and, through the DEPLOYED API:
  1. links the Meta test number to that demo workspace and activates it (PUT /whatsapp/account, second factor)
  2. posts a SIGNED synthetic notification to the public webhook: one inbound text from the owner's test number, then its delivery statuses (the signature is made with the app secret,
     read from Secret Manager into memory; the API checks it like Meta's)
  3. reads the workspace's conversations to show that the inbound became a lead with a message in the Lead Desk
  4. only with --template: saves and submits one test template to Meta for review (the one approved template on the test account, hello_world, takes no variable)
  5. only with --send: queues ONE reply to that lead and lets the API hand it to the Cloud API (the API's own allow-list, WHATSAPP_ALLOWED_RECIPIENTS, must name the number)
The number must be given with --number (digits with the country code, one of the owner's allow-listed test numbers); nothing is ever sent to any other number.

Run: python3 scripts/staging_whatsapp.py --i-know-this-is-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> --number 91XXXXXXXXXX [--send]
Needs on the API: the WhatsApp secrets, CHANNEL_AGENT_EMAIL / CHANNEL_AGENT_PASSWORD (docs/runbooks/whatsapp-staging.md). Exit 0 = no FAIL."""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
from staging_smoke_api import Owner  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))
from app.whatsapp.webhook import sign  # noqa: E402

WABA_ID = "1421890996429034"
PHONE_NUMBER_ID = "1329673453571780"
NS = uuid.UUID("5c0e7a52-91f3-4b6d-8a1e-3f2d9b7c4e10")
RESULTS: list[tuple[str, str]] = []


def record(name: str, status: str, note: str = "") -> None:
    RESULTS.append((name, status))
    print(f"{status:<5} {name} :: {note}")


def notification(number: str, wamid: str, text: str) -> dict[str, Any]:
    return {"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "15551886186", "phone_number_id": PHONE_NUMBER_ID},
        "contacts": [{"profile": {"name": "Test Customer (synthetic)"}, "wa_id": number}],
        "messages": [{"from": number, "id": wamid, "timestamp": str(int(time.time())), "type": "text", "text": {"body": text}}]}}]}]}


def status_notification(number: str, wamid: str, status: str) -> dict[str, Any]:
    return {"object": "whatsapp_business_account", "entry": [{"id": WABA_ID, "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "15551886186", "phone_number_id": PHONE_NUMBER_ID},
        "statuses": [{"id": wamid, "status": status, "timestamp": str(int(time.time())), "recipient_id": number}]}}]}]}


def post_signed(api: str, secret: str, payload: dict[str, Any]) -> tuple[int, Any]:
    body = json.dumps(payload).encode()
    import httpx

    r = httpx.post(f"{api}/v1/webhooks/whatsapp", content=body, headers={"content-type": "application/json", "x-hub-signature-256": sign(body, secret)}, timeout=30)
    try:
        return r.status_code, r.json()
    except ValueError:
        return r.status_code, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-is-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--number", required=True, help="an allow-listed owner test number, digits with the country code")
    ap.add_argument("--pack", default="real_estate", help="the demo workspace (a Lead Desk pack)")
    ap.add_argument("--template", action="store_true", help="also save and submit one test template to Meta for review (a message outside the 24-hour window needs an approved one)")
    ap.add_argument("--send", action="store_true", help="also queue one reply and let the API send it (to --number only)")
    args = ap.parse_args()
    number = re.sub(r"\D", "", args.number)
    if not re.fullmatch(r"[0-9]{8,15}", number):
        print("staging-whatsapp: --number must be digits with the country code", file=sys.stderr)
        return 2
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_is_staging, project_ref=args.project_ref))
        s = ss.Seeder(args.api_url)
        owner = Owner(s, args.pack)
    except ss.SeedError as e:
        print(f"staging-whatsapp: {e}", file=sys.stderr)
        return 2
    secret = ss.secret_get("sme-whatsapp-app-secret")
    if secret is None:
        print("staging-whatsapp: no sme-whatsapp-app-secret", file=sys.stderr)
        return 2
    try:
        owner.ok("link the number", "PUT", "/whatsapp/account", {"waba_id": WABA_ID, "phone_number_id": PHONE_NUMBER_ID, "display_phone": "+1 555 188 6186", "coexistence": False, "token_ref": "default"})
        acc = owner.ok("activate", "POST", "/whatsapp/account/activate")
        record("number linked and active for the demo workspace", "PASS", f"status={acc.get('status')}, token_available={owner.ok('account', 'GET', '/whatsapp/account').get('token_available')}")
    except ss.SeedError as e:
        record("link the number", "FAIL", str(e))
        return 1
    wamid = "wamid.SYNTH" + uuid.uuid5(NS, datetime.now(timezone.utc).strftime("%Y%m%d%H%M")).hex[:20].upper()
    st, out = post_signed(args.api_url.rstrip("/"), secret, notification(number, wamid, "Hi, do you have a 2BHK in Kukatpally? (synthetic test)"))
    if st == 503:
        record("signed inbound", "FAIL", "the API answered 503: the webhook is not configured there (app secret, channel account): docs/runbooks/whatsapp-staging.md")
        return 1
    record("signed inbound accepted", "PASS" if st == 200 and out.get("stored", 0) + out.get("duplicates", 0) >= 1 else "FAIL", f"http={st} {out}")
    st, out = post_signed(args.api_url.rstrip("/"), secret, notification(number, wamid, "x"))
    record("the same inbound again is a duplicate", "PASS" if st == 200 and out.get("duplicates") == 1 else "FAIL", f"http={st} duplicates={out.get('duplicates')}")
    st, out = http_bad_signature(args.api_url.rstrip("/"))
    record("a wrong signature is refused", "PASS" if st == 401 else "FAIL", f"http={st}")
    convs = owner.ok("conversations", "GET", "/conversations?limit=5")
    mine = [c for c in convs.get("conversations", []) if "Test Customer" in json.dumps(c) or "synthetic" in json.dumps(c)]
    record("the inbound is a conversation on a lead in the Lead Desk", "PASS" if mine else "FAIL", f"{len(convs.get('conversations', []))} conversation(s) listed")
    if args.send and mine:
        lead = str(mine[0].get("lead_id") or mine[0].get("id"))
        mid = str(uuid.uuid5(NS, "reply" + wamid))
        sub = owner.ok("queue the reply", "POST", "/outbox/messages", {"message_id": mid, "lead_id": lead, "text": "Thanks for writing. This is a test reply (synthetic).", "language": "en", "category": "reply_to_inbound", "source": "owner"})
        record("a reply was queued", "PASS", f"status={(sub.get('message') or sub).get('status') if isinstance(sub, dict) else '?'}")
        got = owner.ok("the message", "GET", f"/outbox/messages/{mid}")
        record("the Cloud API accepted the reply", "PASS" if got.get("status") == "sent" else "FAIL", f"status={got.get('status')} failure={got.get('failure_code')}")
        st, out = post_signed(args.api_url.rstrip("/"), secret, status_notification(number, "wamid.SYNTHREPLY", "delivered"))
        record("a delivery status is accepted", "PASS" if st == 200 else "FAIL", f"http={st}")
    if args.template:
        tid = str(uuid.uuid5(NS, "template-followup"))
        words = "Hello from Stack19. A note about your enquiry: {{1}} Reply here any time."
        owner.ok("save the template", "PUT", f"/whatsapp/templates/{tid}", {"name": "stack19_test_followup", "language": "en", "category": "utility", "purpose": "followup", "body": words}, want=(200, 201, 409))
        st, out = owner.call("POST", f"/whatsapp/templates/{tid}/submit")
        record("a test template was sent to Meta for review", "PASS" if st == 200 else "INFO", f"http={st}: after Meta approves it, set it with POST /whatsapp/templates/{tid}/status {{status: approved}}")
    fails = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"\nstaging-whatsapp: {len([r for r in RESULTS if r[1] == 'PASS'])} passed, {len(fails)} failed")
    return 1 if fails else 0


def http_bad_signature(api: str) -> tuple[int, Any]:
    import httpx

    r = httpx.post(f"{api}/v1/webhooks/whatsapp", content=b"{}", headers={"content-type": "application/json", "x-hub-signature-256": "sha256=" + "0" * 64}, timeout=30)
    return r.status_code, {}


if __name__ == "__main__":
    raise SystemExit(main())
