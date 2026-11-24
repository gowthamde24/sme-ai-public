#!/usr/bin/env python3
"""Enter the assistant's configuration sheet (reports/customer-zero-configuration-sheet.md) into a workspace in ONE run, through the same API the app uses (C1, 26 Nov 2026).

WHY THIS AND NOT A DATABASE STATEMENT: every one of these settings needs the Owner's second factor in the app. An operator statement would write them without it, which is the one thing the platform never does. So the OWNER runs this
in his own Terminal and types his e-mail, password and the current authenticator code at HIDDEN prompts (nothing is echoed, stored, logged or put on a command line); the script signs in as him, reads what is set now, prints a plain
list of what would change, and only with `--apply` writes it (the same routes, the same checks, the same audit lines as the screens).

  services/ai-api/.venv/bin/python scripts/apply_assistant_config.py --workspace <slug> --supabase-url https://<ref>.supabase.co --api https://<api host> [--config deploy/customer-zero-assistant.json]
        [--days 1-6 --from 09:00 --to 19:00] [--greeting-te "..."] [--apply]

Needs HOSTED_SUPABASE_PUBLISHABLE_KEY in the environment (the public key: `supabase projects api-keys`). Without `--apply` nothing is written (a dry run reads and prints). `may_answer_prices` is forced to false unless a price list is
loaded (the assistant never states a price that is not in a list); everything else is the file's. Idempotent: a value already set is not written again."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "deploy" / "customer-zero-assistant.json"


class Stop(Exception):
    """A closed, plain reason to stop (never a body, a token or a password)."""


def minutes(text: str) -> int:
    hours, _, mins = text.partition(":")
    return int(hours) * 60 + int(mins or 0)


def days(text: str) -> list[int]:
    if "-" in text:
        a, b = text.split("-", 1)
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in text.split(",")]


class Api:
    def __init__(self, client: httpx.Client, base: str) -> None:
        self._c, self._base, self._token = client, base.rstrip("/"), ""

    def sign_in(self, supabase_url: str, key: str, email: str, password: str, code_for: Any) -> None:
        auth = f"{supabase_url.rstrip('/')}/auth/v1"
        r = self._c.post(f"{auth}/token?grant_type=password", headers={"apikey": key}, json={"email": email, "password": password})
        if r.status_code != 200:
            raise Stop("sign-in refused: check the e-mail and password")
        body = r.json()
        token = body["access_token"]
        factor = next((f for f in (body.get("user", {}).get("factors") or []) if f.get("factor_type") == "totp" and f.get("status") == "verified"), None)
        if factor is None:
            raise Stop("this account has no authenticator: the settings need one (Settings > Security)")
        head = {"apikey": key, "authorization": f"Bearer {token}"}
        challenge = self._c.post(f"{auth}/factors/{factor['id']}/challenge", headers=head, json={})
        if challenge.status_code != 200:
            raise Stop("the second factor could not be started")
        done = self._c.post(f"{auth}/factors/{factor['id']}/verify", headers=head, json={"challenge_id": challenge.json()["id"], "code": code_for()})
        if done.status_code != 200:
            raise Stop("the authenticator code was refused: wait for the next code and run again")
        self._token = done.json()["access_token"]

    def call(self, method: str, path: str, body: Any = None) -> Any:
        r = self._c.request(method, f"{self._base}{path}", headers={"authorization": f"Bearer {self._token}"}, json=body)
        if r.status_code >= 400:
            code = ""
            try:
                code = str(r.json().get("error", {}).get("code", ""))
            except ValueError:
                pass
            raise Stop(f"{method} {path.split('?')[0]} refused ({r.status_code} {code})")
        return r.json() if r.content else None


def wanted(config: dict[str, Any], args: argparse.Namespace, prices_loaded: bool) -> dict[str, Any]:
    sheet = dict(config["ai_assistant"])
    if args.days:
        sheet["call_days"] = days(args.days)
    if args.start:
        sheet["call_from_minute"] = minutes(args.start)
    if args.end:
        sheet["call_to_minute"] = minutes(args.end)
    if not prices_loaded:
        sheet["may_answer_prices"] = False   # never a price that is not in a list
    return {"ai_assistant": sheet, "voice": config["voice"], "how": config["how_assistant_speaks"],
            "training": {**{k: v for k, v in config["talk_training"].items()}, **({"greeting": {"te": args.greeting_te}} if args.greeting_te else {})}}


def differences(current: dict[str, Any], desired: dict[str, Any]) -> list[tuple[str, Any, Any]]:
    return [(k, current.get(k), v) for k, v in desired.items() if current.get(k) != v]


def run(args: argparse.Namespace, api: Api, out: Any = print) -> int:
    me = api.call("GET", "/v1/me")
    tenant = next((m["tenant"]["id"] for m in me.get("memberships", []) if m.get("role") == "owner" and m["tenant"].get("slug") == args.workspace), None)
    if tenant is None:
        raise Stop(f"you are not the Owner of a workspace called '{args.workspace}'")
    base = f"/v1/tenants/{tenant}"
    prices = api.call("GET", f"{base}/price-lists/current")
    loaded = bool(prices and prices.get("current"))
    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    want = wanted(config, args, loaded)
    if not loaded:
        out("NOTE: no price list is loaded yet, so 'may answer prices' stays OFF; run this again after the price list is in.")
    plan: list[tuple[str, str, str, dict[str, Any]]] = []   # (label, method, path, body)

    now = api.call("GET", f"{base}/ai-assistant")
    current = now.get("settings", now) if isinstance(now, dict) else {}
    changes = differences(current, want["ai_assistant"])
    if changes:
        plan.append(("The assistant: " + ", ".join(k for k, _, _ in changes), "PUT", f"{base}/ai-assistant", {**current, **want["ai_assistant"]}))
    for k, was, will in changes:
        out(f"  assistant.{k}: {was!r} -> {will!r}")

    voices = api.call("GET", f"{base}/ai-assistant/voices")
    language = want["voice"]["language"]
    chosen = next((x.get("chosen_id") for x in (voices.get("languages") or []) if x.get("language") == language), None) if isinstance(voices, dict) else None
    if chosen != want["voice"]["voice_id"]:
        plan.append((f"The {language} voice", "PUT", f"{base}/ai-assistant/voices", want["voice"]))
        out(f"  voice.{language}: {chosen!r} -> {want['voice']['voice_id']!r}")

    how = api.call("GET", f"{base}/how-assistant-speaks")
    how_now = {"tone": (how.get("tone") or {}).get("value"), "say_ai_when_greeting": (how.get("say_ai_when_greeting") or {}).get("value"), "background": (how.get("background") or {}).get("value")}
    how_changes = {k: v for k, v in want["how"].items() if how_now.get(k) != v}
    if how_changes:
        plan.append(("How the assistant speaks: " + ", ".join(how_changes), "PUT", f"{base}/how-assistant-speaks", how_changes))
        for k, v in how_changes.items():
            out(f"  speaks.{k}: {how_now.get(k)!r} -> {v!r}")

    tr = api.call("GET", f"{base}/talk-training")
    doc = dict(tr.get("training", {}))
    t_changes = differences(doc, want["training"])
    if t_changes:
        plan.append(("Talk training: " + ", ".join(k for k, _, _ in t_changes), "PUT", f"{base}/talk-training", {**doc, **want["training"]}))
        for k, _, will in t_changes:
            out(f"  training.{k}: set ({len(will)} entr{'y' if len(will) == 1 else 'ies'})" if isinstance(will, list | dict) else f"  training.{k}: {will!r}")

    if not plan:
        out("Everything in the sheet is already set. Nothing to do.")
        return 0
    if not args.apply:
        out(f"\nDRY RUN: {len(plan)} step(s) would be written. Run again with --apply to write them.")
        return 0
    for label, method, path, body in plan:
        api.call(method, path, body)
        out(f"done: {label}")
    out("\nAll written. Open My assistant in the app and listen to the voice sample once.")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--workspace", required=True, help="the workspace slug")
    p.add_argument("--supabase-url", required=True)
    p.add_argument("--api", required=True, help="the API address, https://...")
    p.add_argument("--config", default=str(DEFAULT_CONFIG))
    p.add_argument("--days", help="calling days, 1=Monday: 1-6 or 1,2,3")
    p.add_argument("--from", dest="start", help="calling hours start, HH:MM (09:00 to 21:00)")
    p.add_argument("--to", dest="end", help="calling hours end, HH:MM")
    p.add_argument("--greeting-te", help="the Telugu greeting, ONLY when the owner has approved it")
    p.add_argument("--apply", action="store_true", help="write the changes (default: only show them)")
    args = p.parse_args(argv)
    key = os.environ.get("HOSTED_SUPABASE_PUBLISHABLE_KEY", "")
    if not key:
        print("set HOSTED_SUPABASE_PUBLISHABLE_KEY (the public key from `supabase projects api-keys`)", file=sys.stderr)
        return 2
    email, password = getpass.getpass("E-mail (hidden): "), getpass.getpass("Password (hidden): ")
    api = Api(httpx.Client(timeout=30), args.api)
    try:
        api.sign_in(args.supabase_url, key, email, password, lambda: getpass.getpass("Authenticator code now (hidden): ").strip())
        return run(args, api)
    except Stop as why:
        print(f"STOPPED: {why}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
