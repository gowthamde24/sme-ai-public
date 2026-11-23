"""Put the Meta app's secret and the test Page's access token (Lead Ads, Track D) into Secret Manager, for the STAGING project.

Run it yourself, in your own terminal (in Claude Code: `! python3 -I scripts/staging_meta_secrets.py --i-know-this-writes-staging-secrets --project project-2757c07e-37d2-4167-88f`).
Both values are typed at HIDDEN prompts: they never appear in the output, a file, the shell history or the chat, and this script never stores them. Each goes to
`gcloud secrets ... --data-file=-` on standard input only.

Before: in the Meta app, App settings > Basic shows the App Secret (press Show); Graph API Explorer gives the Page access token (user or Page = the test Page, permissions leads_retrieval,
pages_show_list, pages_manage_metadata, pages_read_engagement). See docs/plans/meta-app-review.md and docs/runbooks/lead-sources.md.

What it does (stops at the first problem, prints no value):
  1. refuses unless the flag is given and the project is the staging one;
  2. asks for the App Secret (hidden, 32 hex characters) and the Page access token (hidden, starts with EAA, typed twice);
  3. writes `sme-meta-app-secret` and `sme-meta-page-token` (creates each secret, replicated in asia-south1, or adds a new version when it exists);
  4. prints the NEXT steps (the read grant for the API's service account and the lines that switch the feature on): an IAM change is the owner's own, so it is printed, not run.
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
APP_ENTRY = "sme-meta-app-secret"   # the NAME of a Secret Manager entry (a label, not a value)
TOKEN_ENTRY = "sme-meta-page-token"   # the NAME of a Secret Manager entry (a label, not a value)
APP_SECRET = re.compile(r"^[0-9a-f]{32}$")
PAGE_TOKEN = re.compile(r"^EAA[A-Za-z0-9]{40,500}$")


class RegisterError(Exception):
    """A readable failure. Messages never contain the secret, the token or gcloud's output."""


def valid_secret(value: str) -> bool:
    return bool(APP_SECRET.fullmatch(value))


def valid_token(value: str) -> bool:
    return bool(PAGE_TOKEN.fullmatch(value))


def gcloud(args: list[str], *, stdin: str | None = None) -> int:
    """Run gcloud; its output is swallowed (it never holds the value, but nothing of it is needed either)."""
    done = subprocess.run(["gcloud", *args], input=stdin, capture_output=True, text=True, check=False)
    return done.returncode


def has_entry(project: str, name: str) -> bool:
    return gcloud(["secrets", "describe", name, "--project", project, "--format=value(name)"]) == 0


def write_secret(project: str, name: str, value: str) -> None:
    """Create the entry with this first version, or add a version to the existing one. The value travels on stdin only; nothing is returned."""
    if has_entry(project, name):
        if gcloud(["secrets", "versions", "add", name, "--project", project, "--data-file=-"], stdin=value) != 0:
            raise RegisterError(f"Could not add a version to {name}.")
        return
    if gcloud(["secrets", "create", name, "--project", project, "--replication-policy=user-managed", f"--locations={REGION}",
               "--labels=app=stack19,kind=meta-lead-ads", "--data-file=-"], stdin=value) != 0:
        raise RegisterError(f"Could not create {name} (is the Secret Manager API on, and are you signed in to gcloud as the owner?).")


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
    grants = "\n".join(f"  gcloud secrets add-iam-policy-binding {s} --project {project} --member serviceAccount:{api_sa} --role roles/secretmanager.secretAccessor"
                       for s in (APP_ENTRY, TOKEN_ENTRY))
    return f"""
Next (nothing below was run):
1. Let the API read the two secrets (an IAM change: it runs only after the owner's OK for these exact commands):
{grants}
2. Switch it on for the API (declared settings, deploy/settings/staging/):
     api.env      META_LEAD_PROVIDER=graph
     api.secrets  META_APP_SECRET={APP_ENTRY}
                  META_PAGE_TOKEN={TOKEN_ENTRY}
   and deploy with ALLOW_FLAG_CHANGE=META_LEAD_PROVIDER,META_APP_SECRET,META_PAGE_TOKEN (after calllog.sh 15 is clear).
3. Then the Meta source is created for the owner's workspace; its callback URL and verify token are shown once.
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
        app_secret = ask("Paste the Meta App Secret (hidden): ", valid_secret, twice=True)
        page_token = ask("Paste the Page access token (hidden): ", valid_token, twice=True)
        app_existed = has_entry(args.project, APP_ENTRY)
        token_existed = has_entry(args.project, TOKEN_ENTRY)
        write_secret(args.project, APP_ENTRY, app_secret)
        write_secret(args.project, TOKEN_ENTRY, page_token)
        del app_secret, page_token
        print("first entry: " + ("new version" if app_existed else "created"))   # a fixed word only: no value is ever printed
        print("second entry: " + ("new version" if token_existed else "created"))
        print(next_steps(args.project))
        return 0
    except RegisterError as exc:
        print(f"meta-secrets: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nStopped. Nothing more was written.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
