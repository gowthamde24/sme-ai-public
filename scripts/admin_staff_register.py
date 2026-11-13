# ruff: noqa: E501
"""Register a Stack19 STAFF account for the admin console (owner / support / finance) on the HOSTED stack19-staging project.

Run it yourself, in your own terminal (in Claude Code: `! python3 -I scripts/admin_staff_register.py ...`). The password and the authenticator code are typed at HIDDEN prompts: they never appear in the output, a file,
the shell history or the chat, and this script never stores them. A staff account belongs to NO workspace.

  python3 -I scripts/admin_staff_register.py --i-know-this-creates-staff-in-staging --project-ref uiallwgywitryxatcqxf \\
      --api-url https://sme-api-620338396268.asia-south1.run.app --email you@yourdomain --name "Your Name" --role owner

What it does (stops at the first problem, prints no secret):
  1. refuses unless the flag, the project ref and the project NAME are the staging ones;
  2. creates the account through the Auth admin API (email already confirmed) with the password you type, if it does not exist yet (the admin key is read from the Supabase CLI into memory only);
  3. signs in and enrols an authenticator (TOTP): the secret and the otpauth link are shown ONCE, in your terminal only, for your authenticator app; you type the 6-digit code to finish;
  4. registers the account as staff in the database (`app.operator_register_staff`, through `supabase db query --linked`: run this from a checkout linked to staging).
There is exactly one `owner`. To remove a person: `select app.operator_remove_staff('their@email')`. Rotating a password: the person uses "forgot password" or this script's --reset-password (asks the new one).
"""

from __future__ import annotations

import argparse
import getpass
import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

STAGING_REF = "uiallwgywitryxatcqxf"
STAGING_NAME = "stack19-staging"
ROLES = ("owner", "support", "finance")
EMAIL = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,120}\.[A-Za-z]{2,24}$")
NAME = re.compile(r"^[A-Za-z][A-Za-z .'-]{1,78}[A-Za-z.]$")


class StaffError(Exception):
    """A readable failure. Messages never contain keys, tokens, passwords or response bodies."""


def valid_inputs(email: str, name: str, role: str) -> None:
    if not EMAIL.fullmatch(email):
        raise StaffError("That does not look like an e-mail address.")
    if not NAME.fullmatch(name):
        raise StaffError("The name may hold letters, spaces, dots, apostrophes and hyphens (2 to 80 characters).")
    if role not in ROLES:
        raise StaffError("The role is owner, support or finance.")


def register_sql(email: str, name: str, role: str) -> str:
    """The one statement that registers the account. The inputs were checked above to hold no quote or backslash; the quoting is doubled anyway."""
    valid_inputs(email, name, role)
    q = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    return f"select app.operator_register_staff({q(email)}, {q(name)}, {q(role)})"


def password_ok(pw: str) -> bool:
    return len(pw) >= 12 and any(c.isdigit() for c in pw) and any(c.isalpha() for c in pw) and pw.lower() not in {"passwordpassword", "123456789012"}


def run(argv: list[str]) -> str:
    done = subprocess.run(argv, capture_output=True, text=True, check=False)  # noqa: S603
    if done.returncode != 0:
        raise StaffError(f"`{argv[0]} {argv[1] if len(argv) > 1 else ''}` failed.")
    return done.stdout


def http(method: str, url: str, headers: dict[str, str], body: Any = None) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, data=data, headers={"Content-Type": "application/json", "User-Agent": "stack19-admin-staff-register", **headers})  # noqa: S310
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, None


def guard(args: argparse.Namespace) -> None:
    if not args.i_know_this_creates_staff_in_staging:
        raise StaffError("Refusing to run: pass --i-know-this-creates-staff-in-staging. This creates a Stack19 STAFF account on the HOSTED stack19-staging project.")
    if args.project_ref != STAGING_REF:
        raise StaffError("Refusing to run: --project-ref is not the stack19-staging project.")
    if not args.api_url.startswith("https://"):
        raise StaffError("--api-url must be https.")
    listed = json.loads(run(["supabase", "projects", "list", "--agent", "no", "-o", "json"]))
    match = [p for p in listed if p.get("id") == STAGING_REF or p.get("ref") == STAGING_REF]
    if len(match) != 1 or match[0].get("name") != STAGING_NAME:
        raise StaffError(f"Refusing to run: the project under that ref is not named {STAGING_NAME}.")
    valid_inputs(args.email, args.name, args.role)


def ask_password(prompt: str) -> str:
    while True:
        first = getpass.getpass(f"{prompt} (hidden, at least 12 characters with a letter and a digit): ")
        if not password_ok(first):
            print("Too short or too simple. Try again.")
            continue
        if getpass.getpass("Type it once more: ") != first:
            print("The two did not match. Try again.")
            continue
        return first


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--i-know-this-creates-staff-in-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--email", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--role", required=True, choices=ROLES)
    ap.add_argument("--reset-password", action="store_true", help="the account exists: set a new password (hidden prompt) and nothing else")
    args = ap.parse_args(argv)
    try:
        guard(args)
        sb = f"https://{STAGING_REF}.supabase.co"
        keys = json.loads(run(["supabase", "projects", "api-keys", "--project-ref", STAGING_REF, "--agent", "no", "-o", "json"]))
        pub = next(k["api_key"] for k in keys if k.get("type") == "publishable")
        admin = {"apikey": str(next(k["api_key"] for k in keys if k.get("id") == "service_role")), "Authorization": "Bearer " + str(next(k["api_key"] for k in keys if k.get("id") == "service_role"))}
        st, pol = http("GET", f"{args.api_url.rstrip('/')}/v1/policies/current", {})
        meta = {"terms_version": pol["terms"]["version"], "privacy_version": pol["privacy"]["version"]} if st == 200 and isinstance(pol, dict) else {}
        password = ask_password("Choose the password for " + args.email)
        st, _ = http("POST", f"{sb}/auth/v1/admin/users", admin, {"email": args.email, "password": password, "email_confirm": True, "user_metadata": meta})
        created = st in (200, 201)
        if not created and st != 422:
            raise StaffError(f"Could not create the account (HTTP {st}).")
        if args.reset_password:
            st, found = http("GET", f"{sb}/auth/v1/admin/users?page=1&per_page=1000", admin)
            uid = next((u["id"] for u in (found or {}).get("users", []) if str(u.get("email", "")).lower() == args.email.lower()), None) if isinstance(found, dict) else None
            if uid is None or http("PUT", f"{sb}/auth/v1/admin/users/{uid}", admin, {"password": password})[0] != 200:
                raise StaffError("Could not set the new password.")
            print("Password changed.")
            return 0
        # sign in with the typed password (a new account, or a rerun after a failed step): enrol the authenticator unless one is already verified
        st, session = http("POST", f"{sb}/auth/v1/token?grant_type=password", {"apikey": pub}, {"email": args.email, "password": password})
        if st != 200 or not isinstance(session, dict):
            raise StaffError("Could not sign in with that password" + (" (the account exists with another password: use --reset-password)." if not created else "."))
        token = session["access_token"]
        has_factor = any(f.get("factor_type") == "totp" and f.get("status") == "verified" for f in (session.get("user") or {}).get("factors", []) or [])
        if not has_factor:
            st, enrol = http("POST", f"{sb}/auth/v1/factors", {"apikey": pub, "Authorization": f"Bearer {token}"}, {"factor_type": "totp", "friendly_name": "stack19-staff", "issuer": "Stack19 staff"})
            if st != 200 or not isinstance(enrol, dict):
                raise StaffError(f"Could not start the authenticator enrolment (HTTP {st}).")
            print("\nAdd this to your authenticator app NOW (shown once, only here):")
            print("  secret :", enrol["totp"]["secret"])
            print("  link   :", enrol["totp"]["uri"])
            code = getpass.getpass("Then type the 6-digit code it shows (hidden): ").strip()
            st, ch = http("POST", f"{sb}/auth/v1/factors/{enrol['id']}/challenge", {"apikey": pub, "Authorization": f"Bearer {token}"}, {})
            if st != 200 or not isinstance(ch, dict):
                raise StaffError(f"Could not challenge the authenticator (HTTP {st}).")
            st, _ = http("POST", f"{sb}/auth/v1/factors/{enrol['id']}/verify", {"apikey": pub, "Authorization": f"Bearer {token}"}, {"challenge_id": ch["id"], "code": code})
            if st != 200:
                raise StaffError("That code was not accepted. Run the script again with the same password: it will start a new enrolment.")
        run(["supabase", "db", "query", "--linked", register_sql(args.email, args.name, args.role)])
        print(f"Done: {args.email} is registered as {args.role}. Sign in to the admin console with the password and the authenticator code.")
        return 0
    except StaffError as e:
        print(f"Stopped: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
