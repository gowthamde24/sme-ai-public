"""SYNTHETIC quote reference data for a LOCAL workspace (T009): six invented products, a price list version, a quote policy version and a mapper
config version. Run it with `make seed-quote-data TENANT=<workspace slug>`.

It calls the operator function `app.operator_seed_quote_reference_data` inside the local database container (`docker exec ... psql`): no application
role can call that function, no key of any kind is read, and the script REFUSES unless the configured Supabase URL is this machine. It creates only
what is missing, so a second run changes nothing. Every value is invented: not a tax rate, price, advance or freight of any business. Real values
come from the owner and the accountant, through the (later) import page, never from this script."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def is_local(url: str) -> bool:
    return (urlparse(url).hostname or "") in LOCAL_HOSTS


def container_name(config_text: str) -> str:
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config_text, re.M)
    if match is None:
        raise ValueError("supabase/config.toml has no project_id")
    return f"supabase_db_{match.group(1)}"


def seed_sql(slug: str) -> str:
    if not SLUG.fullmatch(slug):
        raise ValueError("the workspace slug is not a valid slug")
    return f"select app.operator_seed_quote_reference_data('{slug}')"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tenant-slug", required=True)
    args = parser.parse_args(argv)
    url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321")
    if not is_local(url):
        print(
            "refusing: SUPABASE_URL is not this machine; this script seeds the LOCAL stack only",
            file=sys.stderr,
        )
        return 2
    try:
        sql = seed_sql(args.tenant_slug)
        container = container_name((ROOT / "supabase" / "config.toml").read_text())
    except (ValueError, OSError) as exc:
        print(f"refusing: {exc}", file=sys.stderr)
        return 2
    docker = shutil.which("docker")
    if docker is None:
        print("docker is required (the local Supabase stack runs in it)", file=sys.stderr)
        return 2
    result = subprocess.run(  # noqa: S603 - fixed argv, our own container, a validated slug
        [
            docker,
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if result.returncode != 0:
        print(
            "the seed failed (is the workspace slug right, and is `supabase start` running?)",
            file=sys.stderr,
        )
        return 1
    print(json.dumps(json.loads(result.stdout.strip()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
