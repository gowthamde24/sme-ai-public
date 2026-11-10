#!/usr/bin/env python3
"""Set a business up on Plivo (job 3 phase C). An OPERATOR tool: run it on a trusted machine, never in the API. Dry run unless --execute. See docs/runbooks/plivo-onboarding.md.

  PLIVO_AUTH_ID=... PLIVO_AUTH_TOKEN=... python3 scripts/plivo_onboard.py --tenant <workspace id> --business "Padma Silks" --compliance-id <the business's accepted application> \
      --public-base https://sme-api-620338396268.asia-south1.run.app [--number +91...] [--subaccount-id SA...] [--application-id ...] [--pattern 80] [--project <google project>] [--execute]

The Auth ID and Auth Token are read from the ENVIRONMENT (an env file you source), never from an argument and never printed. A new subaccount's token goes straight into Secret Manager (on gcloud's stdin).
Nothing is bought without --execute AND --number. The tool never files a compliance application and never touches a document."""

# ruff: noqa: E501
from __future__ import annotations

import argparse
import os
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ai-api"))

from app.telephony.plivo_admin import PlivoAdmin  # noqa: E402
from app.telephony.plivo_onboarding import GcloudSecretWriter, OnboardPlan, onboard  # noqa: E402

PROJECT = "project-2757c07e-37d2-4167-88f"   # staging


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tenant", required=True, type=uuid.UUID)
    ap.add_argument("--business", required=True)
    ap.add_argument("--compliance-id", required=True)
    ap.add_argument("--public-base", required=True)
    ap.add_argument("--number")
    ap.add_argument("--subaccount-id")
    ap.add_argument("--application-id")
    ap.add_argument("--pattern", default="")
    ap.add_argument("--project", default=PROJECT)
    ap.add_argument("--execute", action="store_true")
    a = ap.parse_args()
    auth_id, token = os.environ.get("PLIVO_AUTH_ID", ""), os.environ.get("PLIVO_AUTH_TOKEN", "")
    if not auth_id or not token:
        print("PLIVO_AUTH_ID and PLIVO_AUTH_TOKEN must be in the environment (source your env file).", file=sys.stderr)
        return 2
    main_admin = PlivoAdmin(auth_id, token)
    secrets = GcloudSecretWriter(a.project)
    plan = OnboardPlan(a.tenant, a.business, a.compliance_id, a.public_base, a.number, a.subaccount_id, a.application_id, a.pattern)

    def token_of(sub_id: str) -> str | None:
        return None   # a stored subaccount token is read back only by the API; a resumed run that needs it asks for a fresh run of the step

    result = onboard(plan, main_admin, secrets, lambda sub_id, sub_token: PlivoAdmin(sub_id, sub_token), execute=a.execute, token_of=token_of)
    print("DRY RUN: nothing was changed.\n" if not a.execute else "EXECUTED:\n")
    for step in result.steps:
        print(f"  [{step.status:8}] {step.name}: {step.detail}")
    if result.subaccount_id:
        print(f"\nsubaccount: {result.subaccount_id}")
    if result.application_id:
        print(f"application: {result.application_id}")
    if result.sql:
        print("\nRun as the operator (SQL editor, postgres):\n" + result.sql)
    return 0 if all(s.status != "failed" for s in result.steps) else 1


if __name__ == "__main__":
    sys.exit(main())
