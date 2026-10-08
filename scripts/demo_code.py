"""make demo-code: print the current 6-digit second-factor code for the LOCAL demo owner (demo-owner@demo.example.test).

`make seed-demo-manual` (or `make seed-demo`) enrols an authenticator for the demo owner on the local stack. This reads that authenticator's
secret from the LOCAL database container, with the same method `seed_demo.local_factor_secret` uses, and prints today's code. It refuses unless
the Supabase URL is this machine. No service-role key, no new secret; the code is only valid for about 30 seconds and only on this local stack.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from seed_demo import (  # noqa: E402
    DEMO_EMAIL,
    SeedError,
    load_config,
    local_factor_secret,
    require_local,
    totp_code,
)


def demo_user_id() -> str:
    """The demo owner's id, read from the LOCAL database container (the same `docker exec` as `local_factor_secret`)."""
    docker = shutil.which("docker")
    config = (Path(__file__).resolve().parents[1] / "supabase" / "config.toml").read_text()
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config, re.M)
    if docker is None or match is None:
        raise SeedError("Cannot reach the local database container. Is Docker running, and did you run `make db-start`?")
    out = subprocess.run(  # noqa: S603 - fixed argv; the email is a constant of this repository
        [docker, "exec", "-i", f"supabase_db_{match.group(1)}", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-c",
         f"select id from auth.users where email = '{DEMO_EMAIL}' limit 1"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    user_id = out.stdout.strip()
    if out.returncode != 0 or not re.fullmatch(r"[0-9a-f-]{36}", user_id):
        raise SeedError("The demo owner does not exist yet. Run `make seed-demo-manual` first.")
    return user_id


def main() -> int:
    try:
        require_local(load_config().supabase_url, "Supabase URL")
        code = totp_code(local_factor_secret(demo_user_id()))
    except SeedError as exc:
        print(f"demo-code: {exc}", file=sys.stderr)
        return 1
    print(code)
    print(f"(a local demo code for {DEMO_EMAIL}; it works for about 30 seconds on this machine's stack only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
