"""Send ONE test lead through a workspace's own Website form on STAGING, for the lead_ack after-hours test (owner, 17 Nov 2026).

Run it yourself, in your own terminal (in Claude Code: `! python3 -I scripts/staging_website_lead.py --i-know-this-is-staging`).
Two values are typed at HIDDEN prompts: the Website form's webhook address (Settings > Lead sources > Website form > Copy the webhook address; it holds a secret) and the sandbox phone number. Neither is printed, stored,
written to a file or sent anywhere but to the form address you typed. The address must be this staging API's own: the script refuses any other host.

What it does: one POST to the form address with a clearly named test lead ("Sandbox test (lead_ack)") and the number you typed. The workspace's standing rule for the Website form takes it from there (after hours: the
approved first WhatsApp message, here lead_ack). The recipient fence (WHATSAPP_ALLOWED_RECIPIENTS) still decides who can be written to: a number outside it is refused by the API itself.
It prints the HTTP status only. Exit 0 = the form accepted the lead.
"""

from __future__ import annotations

import argparse
import getpass
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

STAGING_HOSTS = {"sme-api-620338396268.asia-south1.run.app", "sme-api-xdnvxjiara-el.a.run.app", "api.staging.stack19.com", "staging.stack19.com"}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--i-know-this-is-staging", action="store_true", required=True)
    args = ap.parse_args()
    if not args.i_know_this_is_staging:
        return 2
    url = getpass.getpass("Website form webhook address (hidden): ").strip()
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in STAGING_HOSTS or not parts.path.startswith("/"):
        print("refused: that is not a staging form address (https, this staging's own host)")
        return 2
    number = getpass.getpass("Sandbox phone number, digits with the country code (hidden): ").strip()
    digits = re.sub(r"[^0-9]", "", number)
    if not 10 <= len(digits) <= 15:
        print("refused: the number does not look right")
        return 2
    body = json.dumps({"name": "Sandbox test (lead_ack)", "phone": "+" + digits, "message": "Sandbox test of the after-hours first WhatsApp message"}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"the form answered HTTP {resp.status}")
            return 0 if 200 <= resp.status < 300 else 1
    except urllib.error.HTTPError as exc:
        print(f"the form answered HTTP {exc.code}")
        return 1
    except urllib.error.URLError:
        print("the form could not be reached")
        return 1


if __name__ == "__main__":
    sys.exit(main())
