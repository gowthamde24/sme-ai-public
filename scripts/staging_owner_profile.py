#!/usr/bin/env python3
"""Put the owner's OWN name and phone on their STAGING profile (owner, 14 Nov 2026: "me / my number / send Gowtham" must reach the owner's own phone from the profile, never asked in the chat).

Run it yourself in the terminal (`! python3 scripts/staging_owner_profile.py` inside Claude Code):
  * the phone is asked with a HIDDEN prompt (nothing you type is shown, written to a file or sent to the chat); the name is not secret and is shown;
  * it writes ONE row: your member profile in your own workspace on staging (name, phone, "entered while signed in" stamp), through the Supabase CLI that is already signed in;
  * it never prints the number back.
Once the web app has the "My phone" field in Settings, you can do the same there; this script is for the first time on staging."""

from __future__ import annotations

import getpass
import re
import subprocess
import sys

TENANT = "63e9ce7f-1343-45c3-b3d4-2c1f59253aae"   # the owner's own Stack19 workspace on staging


def clean_phone(raw: str) -> str | None:
    d = re.sub(r"[^0-9+]", "", raw)
    if re.fullmatch(r"[6-9][0-9]{9}", d):
        return "+91" + d
    if re.fullmatch(r"91[6-9][0-9]{9}", d):
        return "+" + d
    return d if re.fullmatch(r"\+[1-9][0-9]{9,14}", d) else None


def sql(query: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["supabase", "db", "query", "--linked", query], capture_output=True, text=True, check=False)


def main() -> int:
    name = " ".join(input("Your name as the assistant should know it (for example Gowtham): ").split())
    if not re.fullmatch(r"[A-Za-z .'-]{2,60}|[^\x00-\x7f ]{2,60}", name):
        sys.exit("a name of 2 to 60 letters, please")
    phone = clean_phone(getpass.getpass("Your own mobile number (hidden): ").strip())
    if phone is None:
        sys.exit("that is not a mobile number (10 digits, optional +91)")
    owner = sql(f"select user_id from public.memberships where tenant_id = '{TENANT}' and role = 'owner' limit 1")
    if owner.returncode != 0 or '"user_id"' not in owner.stdout:
        sys.exit("could not find the owner of your staging workspace (is the Supabase CLI signed in and linked?)")
    user_id = re.search(r'"user_id":\s*"([0-9a-f-]{36})"', owner.stdout)
    if user_id is None:
        sys.exit("unexpected answer from the database")
    uid = user_id.group(1)
    safe_name = name.replace("'", "''")
    done = sql(
        "insert into workspace.member_profiles (workspace_id, user_id, display_name, phone, phone_confirmed_at) "
        f"values ('{TENANT}', '{uid}', '{safe_name}', '{phone}', now()) "
        "on conflict (workspace_id, user_id) do update set display_name = excluded.display_name, phone = excluded.phone, phone_confirmed_at = excluded.phone_confirmed_at, updated_at = now()"
    )
    if done.returncode != 0:
        print("FAILED:", (done.stderr or done.stdout).strip().splitlines()[-1][:200])
        return 1
    print(f"Stored your name ({name}) and your number on your staging profile. Say \"send me: test\" in the assistant now.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
