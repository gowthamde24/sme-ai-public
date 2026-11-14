#!/usr/bin/env python3
"""Add the WhatsApp TEST recipients of staging (owner, 14 Nov 2026): the API and the worker refuse every number that is not on WHATSAPP_ALLOWED_RECIPIENTS (the fence in app/whatsapp/adapter.py), while Meta's own
test-recipient list (you, your brother, your mother, Kalyani once she is verified there) is longer. Run it yourself, in the terminal (`! python3 scripts/staging_whatsapp_recipients.py` inside Claude Code):

  * every number is asked for with a HIDDEN prompt (nothing you type is shown, written to a file or sent to the chat); a blank line skips that person;
  * the numbers already on the fence are read from the worker job and kept; only new ones are added;
  * it shows only HOW MANY numbers there will be and the last two digits of each, asks for a "yes", checks the call log (tools/calllog.sh 15: no live call is running) and then updates the worker job and the
    API service, nothing else (a new revision of the API, no code change);
  * a number must ALSO be a verified test recipient in Meta's App dashboard (WhatsApp -> API setup -> "To"); the fence only lets it through our side.
It never touches TELEPHONY_SANDBOX_NUMBERS (the numbers calls may ring): that list lives in Secret Manager and has its own scripts."""

from __future__ import annotations

import getpass
import json
import re
import subprocess
import sys
from pathlib import Path

PROJECT = "project-2757c07e-37d2-4167-88f"
REGION = "asia-south1"
KEY = "WHATSAPP_ALLOWED_RECIPIENTS"
CALLLOG = Path.home() / "Desktop" / "stack19-jobs" / "tools" / "calllog.sh"
WHO = ("your own number", "your brother's number", "your mother's number", "Kalyani's number (only once she is verified in Meta's list)")


def digits(raw: str) -> str | None:
    """A mobile number as Meta writes it (91 and ten digits), or None."""
    d = re.sub(r"\D", "", raw)
    if len(d) == 10 and d[0] in "6789":
        d = "91" + d
    if len(d) == 11 and d[0] == "0":
        d = "91" + d[1:]
    return d if len(d) == 12 and d.startswith("91") and d[2] in "6789" else None


def gcloud(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["gcloud", *args, "--project", PROJECT, "--region", REGION], capture_output=True, text=True, check=False)


def current() -> list[str]:
    out = gcloud("run", "jobs", "describe", "sme-worker", "--format=json")
    if out.returncode != 0:
        sys.exit("could not read the worker job (are you signed in to gcloud?)")
    env = json.loads(out.stdout)["spec"]["template"]["spec"]["template"]["spec"]["containers"][0].get("env", [])
    raw = next((e.get("value", "") for e in env if e["name"] == KEY), "")
    return [d for d in (digits(part) for part in re.split(r"[;,]", raw)) if d]


def main() -> int:
    have = current()
    print(f"The fence has {len(have)} number(s) now (ending {', '.join(n[-2:] for n in have) or '-'}). Nothing you type below is shown.")
    added: list[str] = []
    for who in WHO:
        raw = getpass.getpass(f"{who} (blank = skip): ").strip()
        if not raw:
            continue
        number = digits(raw)
        if number is None:
            print("  that is not a mobile number (10 digits, optional +91): skipped")
        elif number in have or number in added:
            print("  already on the list: skipped")
        else:
            added.append(number)
    if not added:
        print("Nothing to add.")
        return 0
    final = have + added
    print(f"After this the fence has {len(final)} numbers (ending {', '.join(n[-2:] for n in final)}); {len(added)} new.")
    if input("Apply to the staging worker and API? Type yes: ").strip().lower() != "yes":
        print("Cancelled; nothing changed.")
        return 1
    if CALLLOG.exists() and subprocess.run([str(CALLLOG), "15"], check=False).returncode != 0:
        print("A live call may be running (calllog.sh 15): try again in a few minutes.")
        return 1
    value = f"^@^{KEY}=" + ";".join(final)   # gcloud's own delimiter syntax: the value holds ;
    for kind, name in (("jobs", "sme-worker"), ("services", "sme-api")):
        done = gcloud("run", kind, "update", name, f"--update-env-vars={value}")
        print(f"  {name}: {'updated' if done.returncode == 0 else 'FAILED: ' + done.stderr.strip().splitlines()[-1][:160]}")
        if done.returncode != 0:
            return 1
    print("Done. Add the same numbers as test recipients in Meta's dashboard if you have not.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
