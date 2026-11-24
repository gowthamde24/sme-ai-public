#!/usr/bin/env python3
"""VoiceLink DIAGNOSIS (C1, 28 Nov 2026): why does a call to our number not reach our bot? Read-only: it logs in and reads our numbers, their routing and our bots; nothing is changed, bought or called.

Prints, per number: its last 4 digits, status, expiry, auto-renew, client and the routing (inbound 3 = WebSocket bot is the one we need; status 1 = active); per bot: name, status label, the host and path
of both addresses, and for the token inside them only its LENGTH and the first 8 characters of its SHA-256 (compare with `gcloud secrets versions access latest --secret sme-voicelink-ws-token --project
stack19-production | tr -d '\\r\\n' | shasum -a 256 | cut -c1-8`). Never a password, never the token itself, never a full number. The login is typed at HIDDEN prompts (or VOICELINK_USERNAME /
VOICELINK_PASSWORD in your own shell).

  services/ai-api/.venv/bin/python scripts/voicelink_diagnose.py

What to look for: the bot's status is Active; the number's routing has inbound 3 and status 1; the token fingerprint equals the secret's; the number is not expired; the host is our API's host. VoiceLink offers no read for
the list of calls: the Reports page of the portal shows the last calls (a call that never reached us still has a line there)."""

from __future__ import annotations

import getpass
import hashlib
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))

from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError, recording_on


def address(url: str) -> str:
    """host + path with the secret token replaced by its length and fingerprint."""
    parts = urlsplit(url)
    segments = parts.path.rstrip("/").split("/")
    token = segments[-1] if segments else ""
    shown = "/".join(segments[:-1]) + f"/<token len={len(token)} sha8={hashlib.sha256(token.encode()).hexdigest()[:8]}>" if token else parts.path
    return f"{parts.scheme}://{parts.netloc}{shown}"


def main() -> int:
    user = os.environ.get("VOICELINK_USERNAME") or getpass.getpass("VoiceLink username (hidden): ")
    password = os.environ.get("VOICELINK_PASSWORD") or getpass.getpass("VoiceLink password (hidden): ")
    api = VoicelinkApi(user, password)
    try:
        wallet = api.wallet()
        print(f"login: ok, wallet {wallet.balance:g} {wallet.currency}")
        print("numbers:")
        for d in api.purchased_dids():
            routing = d.get("call_routing") if isinstance(d.get("call_routing"), dict) else {}
            print(f"  ...{str(d.get('did_number'))[-4:]} {d.get('type_label')} status={d.get('status')} user_status={d.get('user_status')} expired={d.get('is_expired')} expiry={d.get('expiry_date')} auto_renew={d.get('auto_renew')} recording={'ON' if recording_on(d) else 'off'} client={d.get('client_id')} routing: inbound={routing.get('for_inbound_call')} outbound={routing.get('for_outbound_call')} status={routing.get('status')}")
        print("routings:")
        for r in api.call_routings():
            print(f"  ...{str(r.get('did_number'))[-4:]} inbound={r.get('for_inbound_call')} outbound={r.get('for_outbound_call')} status={r.get('status')} ({r.get('status_label')})")
        print("bots:")
        for b in api.websocket_bots():
            print(f"  {b.get('bot_name')}: status={b.get('status')} ({b.get('status_label')}) client={b.get('client_id')}")
            print(f"    websocket: {address(str(b.get('websocket_url') or ''))}")
            print(f"    webhook  : {address(str(b.get('webhook_url') or ''))}")
    except VoicelinkError as exc:
        print(f"stopped: {exc.reason}" + (f" (status {exc.status})" if exc.status else ""))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
