# ruff: noqa: E501
"""Create or rotate the billing webhook's own system account on the HOSTED stack19-staging project (owner, 13 Nov 2026).

Only this account (and a business's Owner) may settle an order; the API signs in as it to apply the signed Razorpay events. Its password is made HERE, at random, straight into Secret Manager:
it is never printed, never in a file, never in the chat, never in the repository, never in an environment variable of this shell. (The hidden-prompt rule is for secrets that come from a person or a
provider; this one is made by the system.)

  python3 -I scripts/billing_webhook_account.py create --i-know-this-changes-staging --project-ref uiallwgywitryxatcqxf
  python3 -I scripts/billing_webhook_account.py rotate --i-know-this-changes-staging --project-ref uiallwgywitryxatcqxf

create  : if the secret `sme-billing-webhook-password` does not exist, make a random password and store it; make the Auth account (email already confirmed) with that password if it does not exist;
          register it in the database (`app.operator_register_billing_webhook`, through `supabase db query --linked`: run from a checkout linked to staging).
rotate  : make a NEW random password, set it on the account, store it as a new version of the secret. Then deploy the API (`make deploy-staging WHAT=api`) so a new revision reads the new version
          (the API reads `latest` when a revision starts). The old password stops working the moment the account's password is changed.
Remove the account: `supabase db query --linked "select app.operator_remove_billing_webhook('billing-webhook@system.example.test')"`.
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

STAGING_REF = "uiallwgywitryxatcqxf"
STAGING_NAME = "stack19-staging"
GCP_PROJECT = "project-2757c07e-37d2-4167-88f"
ACCOUNT_EMAIL = "billing-webhook@system.example.test"
VAULT_ENTRY = "sme-billing-webhook-password"   # the NAME of the Secret Manager entry, not its value
EMAIL = re.compile(r"^[a-z0-9.-]{3,60}@[a-z0-9.-]{3,60}\.[a-z]{2,10}$")


class AccountError(Exception):
    """A readable failure. Messages never contain a key, a token, a password or a response body."""


def new_password() -> str:
    """Random, long, and meeting the Auth project's rule (lower, upper, a digit)."""
    return secrets.token_urlsafe(32) + "aA1"


def register_sql(email: str = ACCOUNT_EMAIL) -> str:
    if not EMAIL.fullmatch(email):
        raise AccountError("That does not look like a system e-mail address.")
    return f"select app.operator_register_billing_webhook('{email}')"  # noqa: S608 - the address was checked above: no quote can be in it


def run(argv: list[str], stdin: str | None = None) -> str:
    done = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=120, check=False)  # noqa: S603 - fixed argv
    if done.returncode != 0:
        raise AccountError(f"`{argv[0]} {argv[1] if len(argv) > 1 else ''}` failed (exit {done.returncode}).")
    return done.stdout


def json_from(text: str) -> Any:
    return json.JSONDecoder().raw_decode(text[min(i for i in (text.find("["), text.find("{")) if i >= 0):])[0]


def http(method: str, url: str, headers: dict[str, str], body: Any = None) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, method=method, data=data, headers={"Content-Type": "application/json", "User-Agent": "stack19-billing-webhook-account", **headers})  # noqa: S310
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


def secret_exists() -> bool:
    return subprocess.run(["gcloud", "secrets", "describe", VAULT_ENTRY, f"--project={GCP_PROJECT}"], capture_output=True, text=True, timeout=60, check=False).returncode == 0  # noqa: S603, S607


def secret_put(value: str) -> None:
    """The value goes in through stdin only (never in the argument list, so never in a process listing)."""
    if secret_exists():
        run(["gcloud", "secrets", "versions", "add", VAULT_ENTRY, f"--project={GCP_PROJECT}", "--data-file=-"], stdin=value)
    else:
        run(["gcloud", "secrets", "create", VAULT_ENTRY, f"--project={GCP_PROJECT}", "--replication-policy=user-managed", "--locations=asia-south1", "--data-file=-"], stdin=value)


def guard(args: argparse.Namespace) -> None:
    if not args.i_know_this_changes_staging:
        raise AccountError("Refusing to run: pass --i-know-this-changes-staging. This creates or changes a system account and a secret on the HOSTED stack19-staging project.")
    if args.project_ref != STAGING_REF:
        raise AccountError("Refusing to run: --project-ref is not the stack19-staging project.")
    listed = json_from(run(["supabase", "projects", "list", "--agent", "no", "-o", "json"]))
    match = [p for p in listed if p.get("id") == STAGING_REF or p.get("ref") == STAGING_REF]
    if len(match) != 1 or match[0].get("name") != STAGING_NAME:
        raise AccountError(f"Refusing to run: the project under that ref is not named {STAGING_NAME}.")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=("create", "rotate"))
    ap.add_argument("--i-know-this-changes-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    args = ap.parse_args(argv)
    try:
        guard(args)
        sb = f"https://{STAGING_REF}.supabase.co"
        keys = json_from(run(["supabase", "projects", "api-keys", "--project-ref", STAGING_REF, "--agent", "no", "-o", "json"]))
        service = str(next(k["api_key"] for k in keys if k.get("id") == "service_role"))   # in memory only, used for the Auth admin API
        admin = {"apikey": service, "Authorization": f"Bearer {service}"}
        if args.command == "create":
            if secret_exists():
                password = run(["gcloud", "secrets", "versions", "access", "latest", f"--secret={VAULT_ENTRY}", f"--project={GCP_PROJECT}"])
            else:
                password = new_password()
                secret_put(password)
            st, _ = http("POST", f"{sb}/auth/v1/admin/users", admin, {"email": ACCOUNT_EMAIL, "password": password, "email_confirm": True, "user_metadata": {}})
            if st not in (200, 201, 422):
                raise AccountError(f"Could not create the account (HTTP {st}).")
            print("The account " + ("was created." if st in (200, 201) else "already exists (its password is unchanged)."))
        else:
            password = new_password()
            st, found = http("GET", f"{sb}/auth/v1/admin/users?page=1&per_page=1000", admin)
            uid = next((u["id"] for u in (found or {}).get("users", []) if str(u.get("email", "")).lower() == ACCOUNT_EMAIL), None) if isinstance(found, dict) else None
            if uid is None:
                raise AccountError("The account does not exist: run `create` first.")
            secret_put(password)   # the new version first: if the next step fails, the secret is ahead of the account, and `rotate` can simply be run again
            if http("PUT", f"{sb}/auth/v1/admin/users/{uid}", admin, {"password": password})[0] != 200:
                raise AccountError("Could not set the new password. Run `rotate` again.")
            print("Password rotated. Deploy the API (make deploy-staging WHAT=api) so a new revision reads the new secret version.")
        run(["supabase", "db", "query", "--linked", "--agent", "no", register_sql()])
        print(f"Registered {ACCOUNT_EMAIL} as the billing webhook account. Its password is in Secret Manager (never shown); the runbook names the secret.")
        return 0
    except AccountError as e:
        print(f"Stopped: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
