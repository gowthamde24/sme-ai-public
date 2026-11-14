# ruff: noqa: E501
"""Put the Google OAuth client of the Google Calendar sync (appointment booking slice 4) into Secret Manager, for the STAGING project.

Run it yourself, in your own terminal (in Claude Code: `! python3 -I scripts/google_oauth_client_register.py ...`). The client id and the client secret are typed at HIDDEN prompts: they never appear in the
output, a file, the shell history or the chat, and this script never stores them. Each value goes to `gcloud secrets ... --data-file=-` on standard input only.

  python3 -I scripts/google_oauth_client_register.py --i-know-this-writes-staging-secrets --project project-2757c07e-37d2-4167-88f

Before: create the OAuth client in the Google Cloud console (APIs & Services > Credentials > Create credentials > OAuth client ID > Web application), with the Authorized redirect URI
    https://sme-api-620338396268.asia-south1.run.app/v1/integrations/google-calendar/callback
(the staging API's PUBLIC_BASE_URL + /v1/integrations/google-calendar/callback), and enable the Google Calendar API in the same project. The consent screen's scopes: calendar.events and
calendar.freebusy only (docs/plans/google-oauth-verification.md).

What it does (stops at the first problem, prints no value):
  1. refuses unless the flag is given and the project is the staging one;
  2. asks for the client id (hidden, checked to look like `<digits>-<letters>.apps.googleusercontent.com`) and the client secret (hidden, typed twice);
  3. writes `sme-google-oauth-client-id` and `sme-google-oauth-client-secret` (creates each secret, replicated in asia-south1, or adds a new version when it exists);
  4. prints the NEXT steps (the read grants for the API's and the worker's service accounts, and the lines that switch the feature on): an IAM change is the owner's own, so it is printed, not run.
Rotating: run it again (a new version; disable the old one in the console after the deploy took the new one).
"""

from __future__ import annotations

import argparse
import getpass
import re
import subprocess
import sys

STAGING_PROJECT = "project-2757c07e-37d2-4167-88f"
REGION = "asia-south1"
ID_SECRET = "sme-google-oauth-client-id"   # noqa: S105 - not-a-secret: the NAME of a Secret Manager secret
SECRET_SECRET = "sme-google-oauth-client-secret"   # noqa: S105 - not-a-secret: the NAME of a Secret Manager secret
CLIENT_ID = re.compile(r"^[0-9]{6,20}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$")
CLIENT_SECRET = re.compile(r"^[A-Za-z0-9_-]{20,80}$")


class RegisterError(Exception):
    """A readable failure. Messages never contain the id, the secret or gcloud's output."""


def valid_id(value: str) -> bool:
    return bool(CLIENT_ID.fullmatch(value))


def valid_secret(value: str) -> bool:
    return bool(CLIENT_SECRET.fullmatch(value))


def gcloud(args: list[str], *, stdin: str | None = None) -> int:
    """Run gcloud; its output is swallowed (it never holds the value, but nothing of it is needed either)."""
    done = subprocess.run(["gcloud", *args], input=stdin, capture_output=True, text=True, check=False)  # noqa: S603, S607
    return done.returncode


def write_secret(project: str, name: str, value: str) -> str:
    """Create the secret with this first version, or add a version to the existing one. The value travels on stdin only."""
    if gcloud(["secrets", "describe", name, "--project", project, "--format=value(name)"]) == 0:
        if gcloud(["secrets", "versions", "add", name, "--project", project, "--data-file=-"], stdin=value) != 0:
            raise RegisterError(f"Could not add a version to {name}.")
        return "new version"
    if gcloud(["secrets", "create", name, "--project", project, "--replication-policy=user-managed", f"--locations={REGION}",
               "--labels=app=stack19,kind=google-oauth", "--data-file=-"], stdin=value) != 0:
        raise RegisterError(f"Could not create {name} (is the Secret Manager API on, and are you signed in to gcloud as the owner?).")
    return "created"


def ask(prompt: str, check: object, twice: bool) -> str:
    for _ in range(3):
        first = getpass.getpass(prompt).strip()
        if not check(first):  # type: ignore[operator]
            print("That does not look right. Try again (nothing was shown or saved).")
            continue
        if twice and getpass.getpass("Type it once more (hidden): ").strip() != first:
            print("The two did not match. Try again.")
            continue
        return first
    raise RegisterError("Three tries; stopping. Nothing was written.")


def next_steps(project: str) -> str:
    api_sa = f"sme-api-run@{project}.iam.gserviceaccount.com"
    worker_sa = f"sme-worker-run@{project}.iam.gserviceaccount.com"
    grants = "\n".join(f"  gcloud secrets add-iam-policy-binding {s} --project {project} --member serviceAccount:{sa} --role roles/secretmanager.secretAccessor"
                       for s in (ID_SECRET, SECRET_SECRET) for sa in (api_sa, worker_sa))
    return f"""
Next (your own steps; nothing below was run):
1. Let the API and the worker read the two secrets (an IAM change: yours to run):
{grants}
2. Switch it on for the API: add to deploy/settings/staging/api.secrets
     GOOGLE_OAUTH_CLIENT_ID={ID_SECRET}
     GOOGLE_OAUTH_CLIENT_SECRET={SECRET_SECRET}
   and deploy with ALLOW_FLAG_CHANGE=GOOGLE_OAUTH_CLIENT_ID,GOOGLE_OAUTH_CLIENT_SECRET (see deploy/settings/staging/README.md).
3. Switch it on for the worker: deploy it with WORKER_GOOGLE_CALENDAR=1 (deploy/staging.sh).
4. In the web: Settings > Integrations > Google Calendar > Connect (your own Google account is the test user until Google verifies the app).
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--i-know-this-writes-staging-secrets", action="store_true")
    ap.add_argument("--project", required=True)
    args = ap.parse_args(argv)
    try:
        if not args.i_know_this_writes_staging_secrets:
            raise RegisterError("Refusing to run: pass --i-know-this-writes-staging-secrets. This writes two secrets into the STAGING Google Cloud project.")
        if args.project != STAGING_PROJECT:
            raise RegisterError("Refusing to run: --project is not the staging project.")
        client_id = ask("Paste the OAuth client ID (hidden): ", valid_id, twice=False)
        client_secret = ask("Paste the OAuth client secret (hidden): ", valid_secret, twice=True)
        print(f"{ID_SECRET}: {write_secret(args.project, ID_SECRET, client_id)}")
        print(f"{SECRET_SECRET}: {write_secret(args.project, SECRET_SECRET, client_secret)}")
        del client_id, client_secret
        print(next_steps(args.project))
        return 0
    except RegisterError as exc:
        print(f"google-oauth-client: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped. Nothing more was written.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
