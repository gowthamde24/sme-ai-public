"""Put the repository's four Auth e-mail templates (Confirm, Invite, Reset password, Magic link) on a HOSTED Supabase project (job DE, docs/runbooks/hosted-auth-settings.md).

The templates are files, supabase/templates/*.html, and their subjects are in supabase/config.toml ([auth.email.template.*]): the same ones the local stacks use, so staging, production and a laptop send the same mails. Each links to
the app's own confirm page, {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=..., which verifies on a button press (a mail scanner that opens the link cannot use the token up).

  python3 -I scripts/apply_auth_templates.py --project-ref <ref>            DRY RUN (the default): says which of the 8 settings differ from the repository; changes nothing
  python3 -I scripts/apply_auth_templates.py --project-ref <ref> --apply    writes only those differing settings (the 4 subjects and the 4 bodies), nothing else of the project's Auth settings

Uses the `supabase login` session through scripts/sb_mgmt.py (token in memory only). Never `supabase config push` (it would also push the local-only sign-up and password settings). Custom SMTP is NOT touched: until the owner
chooses an e-mail provider the built-in sender is used, which allows about 2 e-mails an hour on a project (rate_limit_email_sent) and is not for real users. ON THE FREE PLAN WITH THE BUILT-IN SENDER Supabase refuses to change any template
(HTTP 400, "not available for free tier projects using the default email provider"): this script then changes nothing and says so. It works once the project is on Pro or has a custom SMTP provider.
"""

from __future__ import annotations

import argparse
import re
import sys
import tomllib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sb_mgmt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
# the repository's name for each template, and the Management API's
TEMPLATES = {"confirmation": "confirmation", "invite": "invite", "recovery": "recovery", "magic_link": "magic_link"}


def wanted() -> dict[str, str]:
    config = tomllib.loads((ROOT / "supabase" / "config.toml").read_text(encoding="utf-8"))
    section = config["auth"]["email"]["template"]
    out: dict[str, str] = {}
    for name, api in TEMPLATES.items():
        entry = section[name]
        body = (ROOT / entry["content_path"].removeprefix("./")).read_text(encoding="utf-8")
        out[f"mailer_subjects_{api}"] = entry["subject"]
        out[f"mailer_templates_{api}_content"] = body
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--apply", action="store_true", help="write the differing settings (default: a dry run)")
    args = ap.parse_args()
    if not re.fullmatch(r"[a-z]{20}", args.project_ref):
        print("apply-auth-templates: --project-ref is the 20-letter project reference", file=sys.stderr)
        return 2
    want = wanted()
    status, current = sb_mgmt.call("GET", f"/v1/projects/{args.project_ref}/config/auth")
    if status != 200 or not isinstance(current, dict):
        print(f"apply-auth-templates: could not read the project's Auth settings (HTTP {status}): run `supabase login`", file=sys.stderr)
        return 1
    differ = {k: v for k, v in want.items() if (current.get(k) or "").strip() != v.strip()}
    for key in want:
        print(f"{'DIFFERS' if key in differ else 'same   '} {key}")
    if not differ:
        print("nothing to change: the project already has the repository's templates")
        return 0
    if not args.apply:
        print(f"(dry run: {len(differ)} setting(s) would change. Add --apply to write them.)")
        return 0
    status, out = sb_mgmt.call("PATCH", f"/v1/projects/{args.project_ref}/config/auth", differ)
    if status != 200:
        # the API's own sentence (no secret is ever in it); on the Free plan with the built-in sender it says templates cannot be changed
        print(f"apply-auth-templates: the write failed (HTTP {status}): {out if isinstance(out, str) else ''}", file=sys.stderr)
        if "free tier" in str(out):
            print("  Supabase allows custom templates only on a paid plan (Pro, USD 25 a month) or with a custom SMTP provider configured. Nothing was changed.", file=sys.stderr)
        return 1
    status, after = sb_mgmt.call("GET", f"/v1/projects/{args.project_ref}/config/auth")
    bad = [k for k, v in want.items() if not isinstance(after, dict) or (after.get(k) or "").strip() != v.strip()]
    print("written and read back: " + ("all 8 settings match the repository" if not bad else f"STILL DIFFERENT: {bad}"))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
