"""The owner's three TEST workspaces on STAGING (job test-workspaces, 4 Nov 2026): Lakshmi Silks (test), Sri Sai Cements (test), Vidya Public School (test).

Staging only; every guard of scripts/seed_staging.py applies (the flag, the project ref, the project name). Synthetic data only: the real-data gate of every workspace made here stays CLOSED
(the script checks it), phones are the app's fake `+00 000 000 NNNN`, e-mails are on the reserved `example.test` domain; nothing can be sent to anyone.

WHY HELPER ACCOUNTS
  The owner's own account has an authenticator on, and nobody but the owner has the code, so no script can act AS the owner (and none may get round that). So each workspace is made by a helper account
  `owner-test-<pack>@demo.example.test` (password and authenticator secret only in Secret Manager: sme-owner-test-<pack>-password / -totp), exactly as scripts/seed_staging.py makes the demo owners.
  The helper's first-login setup makes the workspace (business type = the pack, named in the account's metadata). Then the OPERATOR adds the owner's own account as Owner
  (app.operator_add_owner_exception: it needs a recorded reason, which the audit log keeps). No invitation has to be accepted: the account exists, the workspace just shows up in the owner's switcher.

PHASES (idempotent: a second run changes nothing it already did)
  provision   helper accounts, workspaces, billing-exempt + assistant allow-list, the owner as Owner, the owner's display name
  seed        the pack's labelled example data + the week's realistic rows (scripts/owner_test_data.py), through OUR API as the helper (row-level security applies)
  handover    the helper leaves every workspace (--handover; run it LAST: after it the script cannot seed again until the helper is re-added with app.operator_add_member as admin)

Run:  python3 -I scripts/seed_owner_test.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> [--phase provision|seed|handover|all]
"""

# ruff: noqa: E501, S608 - long lines like the other seed scripts; the SQL is the operator's, built only from constants and q()-quoted values read from this project

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
from seed_staging import SeedError  # noqa: E402

OWNER_EMAIL = "sodanapalligowthamreddy@gmail.com"
DISPLAY_NAME = "Gowtham"
HELPER_DOMAIN = ss.DEMO_DOMAIN
# pack, workspace name (the account's metadata: the setup uses it as the business name)
WORKSPACES = [
    ("textiles", "Lakshmi Silks (test)"),
    ("construction_materials", "Sri Sai Cements (test)"),
    ("education", "Vidya Public School (test)"),
]
REASON = "Owner's own test workspace, made at the owner's written request of 4 Nov 2026 (job test-workspaces); the account already exists"


def helper_key(pack: str, gen: int = 1) -> str:
    """The helper's name part: `textiles` for the first generation, `textiles-g2` for the helper of a rebuilt workspace (C1's "rebuild test workspace" makes a new one each time)."""
    return pack if gen <= 1 else f"{pack}-g{gen}"


def helper_email(pack: str, gen: int = 1) -> str:
    return f"owner-test-{helper_key(pack, gen).replace('_', '-')}@{HELPER_DOMAIN}"


EXAMPLE_TABLES = ("companies", "contacts", "leads", "products", "enquiries", "requirements", "requirement_fields", "knowledge_sources", "knowledge_facts", "lead_arrivals", "lead_profiles")
MARK_REASON = "Owner test workspace: the seeded week is example data (job test-workspaces, 4 Nov 2026)"


def sql(query: str) -> list[dict[str, Any]]:
    rows = ss.json_from(ss.run(["supabase", "db", "query", "--linked", "--agent", "no", "-o", "json", query]))
    return rows if isinstance(rows, list) else list(rows.get("rows", []))


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


class OwnerTest(ss.Seeder):
    def second_factor_for(self, pack: str, session: dict[str, Any], gen: int = 1) -> str:
        """Like Seeder.second_factor, with this job's own secret names (sme-owner-test-<pack>[-gN]-totp)."""
        token = session["access_token"]
        name = f"sme-owner-test-{helper_key(pack, gen)}-totp"
        secret = ss.secret_get(name)
        factor_id = next((f["id"] for f in session["user"].get("factors", []) or [] if f.get("factor_type") == "totp" and f.get("status") == "verified"), None)
        if factor_id is None:
            st, enrol = ss.http("POST", f"{self.sb}/auth/v1/factors", self.pub_headers(token), {"factor_type": "totp", "friendly_name": f"owner-test-{helper_key(pack, gen)}", "issuer": "stack19-staging-owner-test"})
            if st != 200 or not isinstance(enrol, dict):
                raise SeedError(f"Could not enrol the authenticator for {pack} (HTTP {st}).")
            factor_id, secret = enrol["id"], enrol["totp"]["secret"]
            ss.secret_put(name, secret)
        if not secret:
            raise SeedError(f"The authenticator for {pack} exists but its secret is not in Secret Manager.")
        st, ch = ss.http("POST", f"{self.sb}/auth/v1/factors/{factor_id}/challenge", self.pub_headers(token), {})
        if st != 200 or not isinstance(ch, dict):
            raise SeedError(f"Challenge failed for {pack} (HTTP {st}).")
        st, ver = ss.http("POST", f"{self.sb}/auth/v1/factors/{factor_id}/verify", self.pub_headers(token), {"challenge_id": ch["id"], "code": ss.totp_code(secret)})
        if st != 200 or not isinstance(ver, dict):
            raise SeedError(f"The authenticator code was refused for {pack} (HTTP {st}).")
        return str(ver["access_token"])

    def helper_token(self, pack: str, name: str, terms: dict[str, str], gen: int = 1) -> str:
        email = helper_email(pack, gen)
        pw_name = f"sme-owner-test-{helper_key(pack, gen)}-password"
        password = ss.secret_get(pw_name)
        if password is None:
            password = ss.new_password()
            ss.secret_put(pw_name, password)
        self.create_user(email, password, {"terms_version": terms["terms"], "business_name": name})
        return self.second_factor_for(pack, self.sign_in(email, password), gen)

    def provision(self, pack: str, name: str, terms: dict[str, str], gen: int = 1) -> dict[str, Any]:
        token = self.helper_token(pack, name, terms, gen)
        st, setup = self.call(token, "POST", "/v1/account/setup", {"business_type": pack, "language": "en", "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
        if st != 200 or not isinstance(setup, dict):
            raise SeedError(f"The first-login setup failed for {pack} (HTTP {st}).")
        tenant = str(setup["tenant_id"])
        st, prof = self.call(token, "GET", f"/v1/tenants/{tenant}/profile")
        if st == 200 and isinstance(prof, dict) and prof.get("name") != name:
            st, _ = self.call(token, "PUT", f"/v1/tenants/{tenant}/profile", {"name": name})
            if st != 200:
                raise SeedError(f"Naming the workspace failed for {pack} (HTTP {st}).")
        slug = sql(f"select slug from public.tenants where id = {q(tenant)}")[0]["slug"]
        # the owner: the operator adds the existing account as Owner (once)
        already = sql(f"select 1 as x from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = {q(tenant)} and lower(u.email) = {q(OWNER_EMAIL)}")
        if not already:
            # the free trial allows one owned workspace per owner (tenants.workspace_limit, "changed by the operator only", docs/pre-pilot-checklist.md). The owner already owns one (Stack19 Owner
            # Test, left as it is); a person's allowance is the largest limit among the workspaces they own or join, so the TEST workspaces carry 4 (the owner's one + these three).
            sql(f"update public.tenants set workspace_limit = 4 where id = {q(tenant)} and workspace_limit < 4 returning id")
            sql(f"select app.operator_add_owner_exception({q(slug)}, {q(OWNER_EMAIL)}, {q(REASON)})")
        # the owner's own profile IN THIS WORKSPACE (workspace.member_profiles: per person per workspace): the name "Gowtham", the language pill on Auto. Only when the owner has none yet:
        # whatever the owner later sets in the app is never overwritten by a re-run.
        sql(f"insert into workspace.member_profiles (workspace_id, user_id, display_name, preferred_chat_language) select {q(tenant)}::uuid, u.id, {q(DISPLAY_NAME)}, 'auto' "
            f"from auth.users u where lower(u.email) = {q(OWNER_EMAIL)} on conflict (workspace_id, user_id) do nothing returning user_id")
        sql(f"select app.operator_billing_exempt({q(tenant)}::uuid, true)")
        sql(f"select app.operator_enable_assistant({q(slug)})")
        gate = sql(f"select real_data_allowed from public.tenant_data_policy where tenant_id = {q(tenant)}")
        if gate and gate[0]["real_data_allowed"]:
            raise SeedError(f"The real-data gate of {name} is OPEN: refusing (a test workspace is synthetic only).")
        return {"pack": pack, "workspace": name, "tenant_id": tenant, "slug": slug, "helper": helper_email(pack, gen), "owner_added": not already}


def tenant_of(name: str) -> str:
    """The workspace by its exact name (C1's archive renames an old one "... (archived YYYY-MM-DD)", so the name stays unique)."""
    rows = sql(f"select id from public.tenants where name = {q(name)}")
    if len(rows) != 1:
        raise SeedError(f"Expected one workspace named {name}, found {len(rows)}.")
    return str(rows[0]["id"])


def mark_example(tenant: str) -> dict[str, int]:
    """Register every row of the kinds the example batch can hold (app.operator_mark_example, #287) that is not in the live batch yet, so "Remove example data" / reset reach the week.
    Quotes, orders, ledger, calls, fees and students are never deleted by the database (append-only), so they are not marked; a marked row they use is KEPT and counted by the removal.
    One statement per table; a re-run marks nothing new."""
    out: dict[str, int] = {}
    for table in EXAMPLE_TABLES:
        rows = sql(
            f"select count(app.operator_mark_example({q(tenant)}::uuid, {q(table)}, t.id, {q(MARK_REASON)}))::int as n from public.{table} t "
            f"where t.tenant_id = {q(tenant)}::uuid and not exists (select 1 from packs.example_rows r join packs.example_batches b on b.id = r.batch_id and b.removed_at is null "
            f"where r.tenant_id = t.tenant_id and r.table_name = {q(table)} and r.row_id = t.id)"
        )
        out[table] = int(rows[0]["n"]) if rows else 0
    return out


def provision(s: OwnerTest, pack: str, name: str, terms: dict[str, str], gen: int = 1) -> dict[str, Any]:
    return s.provision(pack, name, terms, gen)


def seed(s: OwnerTest, pack: str, name: str, terms: dict[str, str], gen: int = 1) -> dict[str, Any]:
    import owner_test_data  # noqa: PLC0415 - only the seed phase needs it

    token = s.helper_token(pack, name, terms, gen)
    tenant = tenant_of(name)
    seeded = owner_test_data.seed(pack, lambda m, p, b=None, raw=None, _t=token, _id=tenant: s.call(_t, m, f"/v1/tenants/{_id}{p}", b, raw))
    st, cur = s.call(token, "GET", f"/v1/tenants/{tenant}/example-data")
    if st == 200 and isinstance(cur, dict) and not cur.get("loaded"):
        s.call(token, "POST", f"/v1/tenants/{tenant}/example-data")  # the pack's labelled sample, so the batch exists and Today offers Remove / Remove and load it again
    return {"pack": pack, "seeded": seeded, "marked_example": mark_example(tenant)}


def handover(s: OwnerTest, pack: str, name: str, terms: dict[str, str], gen: int = 1) -> dict[str, Any]:
    """The helper leaves (a person may always remove themselves; the reason is one of the API's codes). Run LAST: seeding again needs the helper re-added (app.operator_add_member as admin)."""
    tenant = tenant_of(name)
    token = s.helper_token(pack, name, terms, gen)
    helper_id = sql(f"select id from auth.users where email = {q(helper_email(pack, gen))}")[0]["id"]
    st, _ = s.call(token, "POST", f"/v1/tenants/{tenant}/members/{helper_id}/remove", {"reason": "left"})
    return {"pack": pack, "helper": helper_email(pack, gen), "helper_removed": st in (200, 204), "http": st}


def guard(args: argparse.Namespace) -> None:
    ss.guard(args)


PHASES = {"provision": provision, "seed": seed, "handover": handover}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--i-know-this-loads-demo-data-into-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--phase", choices=["provision", "seed", "handover", "all"], default="all", help="all = provision then seed (never the hand-over)")
    ap.add_argument("--only", choices=[p for p, _ in WORKSPACES], help="run the phase for this one pack only")
    ap.add_argument("--generation", type=int, default=1, help="the helper generation (C1's rebuild: 2, 3, ...); 1 = the first helpers")
    args = ap.parse_args()
    try:
        guard(args)
        s = OwnerTest(args.api_url)
        terms = s.terms()
        phases = ["provision", "seed"] if args.phase == "all" else [args.phase]
        for pack, name in WORKSPACES:
            if args.only and pack != args.only:
                continue
            for phase in phases:
                print(json.dumps(PHASES[phase](s, pack, name, terms, args.generation), default=str), flush=True)
    except SeedError as e:
        print(f"seed-owner-test: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
