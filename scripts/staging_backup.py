"""make staging-backup: a logical backup of the HOSTED stack19-staging database to a file outside Git, and the restore drill into the LOCAL agent stack (job DC).

  python3 scripts/staging_backup.py dump  [--dir DIR]   pg_dump 17 (custom format, owners and grants kept; every app schema plus auth) into DIR/stack19-staging-<UTC time>.dump, mode 600
  python3 scripts/staging_backup.py drill FILE          restores FILE into a SCRATCH database next to the agent stack's own (never `postgres`, never the owner's stack), runs supabase/hosted/verify.sql
                                                        there, compares every table's row count with staging, times the restore (the RTO of this drill) and drops the scratch database

The database password is read from Google Secret Manager (sme-staging-db-password) into this process's memory and reaches pg_dump only through the environment of the one command (never an argument, a
file or the output). pg_dump runs INSIDE the local agent stack's Postgres 17 container (the Mac's own pg_dump is 16, older than the server) and talks to the session pooler (IPv4). The dump holds everything:
password hashes and authenticator secrets included. Staging holds synthetic accounts only; when real data arrives (the gate is closed today) keep dumps encrypted at rest and off shared folders.
The default folder is on the Stack19 volume, outside the repository.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_sme-ai-agent"  # the AGENT stack: never the owner's (supabase_db_sme-ai)
DEFAULT_DIR = Path("/Volumes/Stack19/stack19/staging-backups")
SCHEMAS = ["public", "app", "auth", "erasure", "integrations", "notify", "packs", "privacy", "research", "scheduler", "suppression", "team", "voice", "workspace", "billing", "supabase_migrations"]


# Schemas the platform itself manages (a Supabase restore brings them; a plain dump does not need them). Any OTHER schema that is not in SCHEMAS would be silently missing from the backup (the `billing` schema was, until the first
# real drill on 28 Oct 2026), so the dump stops and says so.
MANAGED = {"extensions", "graphql", "graphql_public", "pgbouncer", "realtime", "storage", "vault", "information_schema"}


def unlisted_schemas(existing: set[str]) -> set[str]:
    return {s for s in existing if not s.startswith("pg_") and s not in SCHEMAS and s not in MANAGED}


def counts_sql() -> str:
    schemas = ",".join(f"'{s}'" for s in SCHEMAS)
    return ("select table_schema || '.' || table_name || '=' || (xpath('/row/cnt/text()', query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '')))[1]::text "
            f"from information_schema.tables where table_type = 'BASE TABLE' and table_schema in ({schemas}) order by 1")


def credentials() -> tuple[str, str]:
    password = ss.secret_get("sme-staging-db-password")
    if not password:
        raise SystemExit("no sme-staging-db-password in Secret Manager")
    return f"postgres.{ss.STAGING_REF}", password  # the pooler names the project in the user


def pooler_host() -> str:
    return (ROOT / "supabase/.temp/pooler-url").read_text().strip().split("@", 1)[1].split(":", 1)[0]


def remote_json(sql: str) -> list[dict]:
    return ss.json_from(ss.run(["supabase", "db", "query", "--linked", "--agent", "no", "-o", "json", sql]))


def dump(directory: Path) -> Path:
    role, password = credentials()
    existing = {str(next(iter(row.values()))) for row in remote_json("select nspname from pg_namespace")}
    missing = unlisted_schemas(existing)
    if missing:
        raise SystemExit(f"the database has schemas the backup does not list: {sorted(missing)}. Add them to SCHEMAS (or to MANAGED if the platform owns them) in scripts/staging_backup.py, or the backup would silently leave them out.")
    directory.mkdir(parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = directory / f"stack19-staging-{stamp}.dump"
    inside = f"/tmp/{target.name}"
    args = ["docker", "exec", "-e", "PGPASSWORD", CONTAINER, "pg_dump", "-h", pooler_host(), "-p", "5432", "-U", role, "-d", "postgres", "-Fc", "--no-comments"]
    for s in SCHEMAS:
        args += ["-n", s]
    args += ["-f", inside]
    t0 = time.time()
    r = subprocess.run(args, env={**os.environ, "PGPASSWORD": password}, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("pg_dump failed: " + r.stderr.strip()[:400])
    subprocess.run(["docker", "cp", f"{CONTAINER}:{inside}", str(target)], check=True, capture_output=True)
    subprocess.run(["docker", "exec", CONTAINER, "rm", "-f", inside], check=True, capture_output=True)
    os.chmod(target, 0o600)
    print(f"dump: {target} ({target.stat().st_size} bytes) in {time.time() - t0:.1f} s")
    return target


def psql(db: str, sql: str, user: str = "supabase_admin", stdin: str | None = None) -> str:
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-U", user, "-d", db, "-X", "-At", "-v", "ON_ERROR_STOP=1"]
    r = subprocess.run(cmd + ([] if stdin is not None else ["-c", sql]), input=stdin, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"psql failed: {r.stderr.strip()[:400]}")
    return r.stdout.strip()


def verify(db: str) -> list[str]:
    r = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", db, "-X", "-At", "-F", "|"], input=(ROOT / "supabase/hosted/verify.sql").read_text(), capture_output=True, text=True)
    return sorted(line for line in r.stdout.splitlines() if line and not line.startswith("INFO"))


def drill(file: Path) -> int:
    scratch = "restore_drill_" + datetime.now(timezone.utc).strftime("%H%M%S")
    inside = f"/tmp/{file.name}"
    subprocess.run(["docker", "cp", str(file), f"{CONTAINER}:{inside}"], check=True, capture_output=True)
    ok = False
    try:
        t0 = time.time()
        psql("postgres", f"create database {scratch}")
        psql(scratch, "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;")
        r = subprocess.run(["docker", "exec", CONTAINER, "pg_restore", "-U", "supabase_admin", "-d", scratch, inside], capture_output=True, text=True)
        restore_s = time.time() - t0
        # a new database already has the schema `public`: the one message that is expected, not an error
        errors = [ln for ln in r.stderr.splitlines() if ln.startswith("pg_restore: error") and 'schema "public" already exists' not in ln]
        print(f"restore: {restore_s:.1f} s end to end (the RTO of this drill), {len(errors)} pg_restore error line(s)")
        for ln in errors[:8]:
            print("   ", ln[:220])
        remote = dict(v.split("=") for v in (str(next(iter(row.values()))) for row in remote_json(counts_sql())))
        local = dict(v.split("=") for v in psql(scratch, counts_sql()).splitlines())
        # sign-in tables keep growing after the dump (the scheduler worker signs in every few minutes): there the copy may hold fewer rows, never more
        volatile = {"auth.sessions", "auth.refresh_tokens", "auth.mfa_amr_claims", "auth.audit_log_entries", "auth.flow_state", "auth.one_time_tokens", "auth.mfa_challenges"}
        diff = {k: (remote.get(k), local.get(k)) for k in sorted(set(remote) | set(local))
                if remote.get(k) != local.get(k) and not (k in volatile and int(local.get(k) or 0) <= int(remote.get(k) or 0))}
        print(f"row counts: {len(remote)} tables in staging, {len(local)} restored, {len(diff)} differ")
        for k, v in list(diff.items())[:10]:
            print(f"    {k}: staging={v[0]} restored={v[1]}")
        v_local = verify(scratch)
        bad = [row for row in v_local if row.split("|")[1:2] == ["f"]]
        print(f"verify.sql on the restored copy: {len(v_local)} rows, {len(bad)} not ok")
        for row in bad:
            print("   ", row[:220])
        ok = not diff and not bad and not errors
    finally:
        psql("postgres", f"drop database if exists {scratch} with (force)")
        subprocess.run(["docker", "exec", CONTAINER, "rm", "-f", inside], capture_output=True)
        print(f"scratch database {scratch} dropped")
    print("DRILL " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("dump")
    d.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    r = sub.add_parser("drill")
    r.add_argument("file", type=Path)
    args = ap.parse_args()
    if args.cmd == "dump":
        dump(args.dir)
        return 0
    return drill(args.file)


if __name__ == "__main__":
    raise SystemExit(main())
