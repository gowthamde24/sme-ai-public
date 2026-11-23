"""Put Resend on the STAGING project's Auth as its SMTP sender (job RESEND, docs/runbooks/email-resend.md).

  python3 -I scripts/apply_auth_smtp.py            DRY RUN (the default): says which settings differ; changes nothing
  python3 -I scripts/apply_auth_smtp.py --apply    writes only these settings: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_admin_email, smtp_sender_name, rate_limit_email_sent

STAGING ONLY: the project reference is fixed below; any other is refused. The Resend API key is read from Google Secret Manager (`sme-resend-api-key`) into memory, sent only to the Supabase Management API as the
SMTP password, and NEVER printed, logged or written to a file (the dry run compares it by presence, not by value: the API does not return it). Uses the `supabase login` session through scripts/sb_mgmt.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sb_mgmt  # noqa: E402

STAGING_REF = "uiallwgywitryxatcqxf"
GCP_PROJECT = "project-2757c07e-37d2-4167-88f"
SECRET = "sme-resend-api-key"
WANTED = {
    "smtp_host": "smtp.resend.com",
    "smtp_port": "465",
    "smtp_user": "resend",
    "smtp_admin_email": "noreply@stack19.com",
    "smtp_sender_name": "Stack19",
    "rate_limit_email_sent": 30,
}


def read_key() -> str:
    done = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret", SECRET, "--project", GCP_PROJECT], capture_output=True, text=True, check=False)
    key = done.stdout.strip()
    if done.returncode != 0 or not key.startswith("re_"):
        raise SystemExit("apply-auth-smtp: could not read the Resend key from Secret Manager (is gcloud logged in?)")
    return key


def main() -> int:
    apply = "--apply" in sys.argv[1:]
    status, current = sb_mgmt.call("GET", f"/v1/projects/{STAGING_REF}/config/auth")
    if status != 200 or not isinstance(current, dict):
        print(f"apply-auth-smtp: could not read the project's Auth settings (HTTP {status}): run `supabase login`", file=sys.stderr)
        return 1
    differ = {k: v for k, v in WANTED.items() if str(current.get(k)) != str(v)}
    for key in WANTED:
        print(f"{'DIFFERS' if key in differ else 'same   '} {key}")
    has_pass = bool(current.get("smtp_pass"))
    print(f"{'same   ' if has_pass else 'DIFFERS'} smtp_pass (compared by presence only)")
    if not apply:
        print("dry run: nothing changed (add --apply to write)")
        return 0
    body: dict[str, object] = dict(differ)
    body["smtp_pass"] = read_key()
    status, answer = sb_mgmt.call("PATCH", f"/v1/projects/{STAGING_REF}/config/auth", body)
    if status != 200:
        print(f"apply-auth-smtp: the project refused the change (HTTP {status})", file=sys.stderr)
        return 1
    print("applied: SMTP is Resend (smtp.resend.com:465), from noreply@stack19.com; the key was not shown")
    del answer
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
