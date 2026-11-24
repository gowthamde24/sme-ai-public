#!/usr/bin/env python3
"""VoiceLink CALL DETAIL (C1, 28 Nov 2026): read ONE call's record (`GET /call-log/details?call_id=...`) and print the NAMES of its fields, so the webhook parser can be built from the real shape. Read-only.

  VOICELINK_USERNAME=... VOICELINK_PASSWORD=... services/ai-api/.venv/bin/python scripts/voicelink_call_detail.py <call_id or unique_id>

Prints every field name with its type; the VALUE only for the fields that carry no personal data (a status, a type, a duration, a cost, a time, an id of ours). Never a phone number, a name, a token, a recording address
or any other value. The login comes from the two environment variables or from hidden prompts."""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))

from app.telephony.voicelink_api import VoicelinkApi, VoicelinkError

SAFE = frozenset({
    "call_status", "call_type", "bot_type", "bot_id", "did_id", "client_id", "carrier_id", "reseller_id", "direction", "status", "status_label", "duration", "billsec", "talk_time", "total_cost", "cost", "rate",
    "created_at", "updated_at", "answered_at", "ended_at", "start_time", "end_time", "hangup_cause", "hangup_by", "end_reason", "disposition", "pulse", "pulses", "recording_status", "is_recorded", "call_recording",
    "disconnect_reason", "hangup_reason", "call_answered_time", "call_end_time", "call_duration", "talk_duration", "bot_name", "bot_type_label", "currency_symbol",
})


def show(name: str, value: Any, indent: int = 2) -> None:
    pad = " " * indent
    if isinstance(value, dict):
        print(f"{pad}{name}: object")
        for key in sorted(value):
            show(str(key), value[key], indent + 2)
    elif isinstance(value, list):
        print(f"{pad}{name}: list of {len(value)}" + (f" (first is {type(value[0]).__name__})" if value else ""))
        if value and isinstance(value[0], dict):
            for key in sorted(value[0]):
                show(str(key), value[0][key], indent + 2)
    elif name in SAFE:
        print(f"{pad}{name}: {type(value).__name__} = {value!r}")
    else:
        text = str(value)
        print(f"{pad}{name}: {type(value).__name__}" + (f" (length {len(text)})" if isinstance(value, str) else ""))


def recording_link(data: Any) -> str | None:
    """The first string under a key that names a recording and looks like a web address (any depth). Never printed."""
    if isinstance(data, dict):
        for key, value in data.items():
            if "record" in str(key).lower() and isinstance(value, str) and value.startswith(("http://", "https://")):
                return value
        for value in data.values():
            found = recording_link(value)
            if found:
                return found
    elif isinstance(data, list):
        for value in data:
            found = recording_link(value)
            if found:
                return found
    return None


def check_open(link: str | None) -> None:
    """Is the recording address open to anyone who has it? One HEAD request WITHOUT any login (28 Nov 2026, for the privacy text). Prints only the answer, the status number, whether it is https, and a hint of
    the kind of host (never the address, never the file name, never the content)."""
    import urllib.error
    import urllib.request
    from urllib.parse import urlparse

    if not link:
        print("recording address: none in this record (the call was not recorded, or VoiceLink keeps it elsewhere)")
        return
    host = urlparse(link).hostname or ""
    kind = "amazon storage" if host.endswith(".amazonaws.com") else "voicelink domain" if host == "voicelink.co.in" or host.endswith(".voicelink.co.in") else "another host"
    request = urllib.request.Request(link, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=20) as reply:  # noqa: S310 - the address comes from VoiceLink's own record
            status = reply.status
    except urllib.error.HTTPError as exc:
        status = exc.code
    except Exception as exc:  # noqa: BLE001
        print(f"recording address: could not be checked ({exc.__class__.__name__})")
        return
    verdict = "OPEN to anyone who has the address" if status == 200 else "NOT open without a login" if status in (401, 403) else "unclear"
    print(f"recording address: https={link.startswith('https://')} host kind={kind} status without login={status}: {verdict}")


def main(argv: list[str]) -> int:
    if len(argv) != 2 and not (len(argv) == 3 and argv[2] == "--check-recording-open"):
        print("usage: voicelink_call_detail.py <call_id> [--check-recording-open]", file=sys.stderr)
        return 2
    user = os.environ.get("VOICELINK_USERNAME") or getpass.getpass("VoiceLink username (hidden): ")
    password = os.environ.get("VOICELINK_PASSWORD") or getpass.getpass("VoiceLink password (hidden): ")
    try:
        data = VoicelinkApi(user, password).call_details(argv[1])
    except VoicelinkError as exc:
        print(f"stopped: {exc.reason}" + (f" (status {exc.status})" if exc.status else ""))
        return 1
    if not data:
        print("VoiceLink returned no record for that id (not found in this account).")
        return 1
    print("call record fields:")
    for key in sorted(data):
        show(str(key), data[key])
    if len(argv) == 3:
        check_open(recording_link(data))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
