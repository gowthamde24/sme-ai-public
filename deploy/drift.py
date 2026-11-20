#!/usr/bin/env python3
"""DRIFT of the web service and the worker job from their declared settings (planner, 20 Nov 2026; Customer Zero code list item 4).

The API's settings are declared in deploy/settings/<env>/api.env and checked before every deploy (deploy/settings.py). The WEB (Cloud Run service sme-web) and the WORKER (Cloud Run job sme-worker) had no such check: a
hand edit in the console, or a deploy that forgot a switch, was invisible. Now each has one declared file per environment:

  deploy/settings/<env>/web.env      the environment of the serving revision of sme-web
  deploy/settings/<env>/worker.env   the environment of the job sme-worker
  one setting a line, NAME=value (public values only), NAME=secret:SECRET:KEY for a Secret Manager reference (the value is never read), NAME=@ignore for a setting that must exist but whose value is not for git (a phone
  number), `@minScale` / `@maxScale` for the instance limits of a service; a line starting with # is a comment.

  drift.py check ENV web|worker PROJECT REGION [--allow NAME,NAME]   compare declared and live; exit 3 and list every difference not named in --allow (a deploy names the setting it means to change in ALLOW_FLAG_CHANGE)
  drift.py snapshot ENV web|worker PROJECT REGION                      write the declared file from what is live now (the way to start, or to take a hand edit into the file)

A resource that does not exist yet (production before its bring-up) is not drift: the check says so and passes; the first deploy there is followed by a snapshot."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import flag_guard

ROOT = Path(__file__).resolve().parent
RESOURCES = {"web": ("service", "sme-web"), "worker": ("job", "sme-worker")}
PRIVATE = frozenset({"WHATSAPP_ALLOWED_RECIPIENTS", "EXOTEL_TRIAL_CALLER", "PLIVO_BALANCE_ALERT_TO", "TELEPHONY_SANDBOX_NUMBERS", "SUPABASE_PUBLISHABLE_KEY"})   # real phone numbers and the key-like public key: present, never in git
IGNORE = "@ignore"
HEADER = "# Declared settings of the {kind} {name} ({env}). Public values only; NAME=@ignore means present but not for git; secret:SECRET:KEY is a Secret Manager reference. Edit in a pull request; `python3 deploy/drift.py check` finds a hand edit.\n"


def live_flags(kind: str, name: str, project: str, region: str) -> dict[str, str] | None:
    """The settings of the serving revision of a service, or of a job; None when it does not exist."""
    cmd = ["gcloud", "run", "services" if kind == "service" else "jobs", "describe", name, "--project", project, "--region", region, "--format=json"]
    done = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        if "not found" in done.stderr.lower() or "cannot find" in done.stderr.lower():
            return None
        raise SystemExit(f"could not read {name}: {done.stderr.strip()[:200]}")
    try:
        described = json.loads(done.stdout)
    except ValueError:
        raise SystemExit(f"drift: gcloud did not answer JSON for {name}") from None
    if kind == "service":
        return flag_guard.flags_of(flag_guard.describe_revision(project, region, flag_guard.serving_revision(described)))
    return job_flags(described)


def job_flags(described: dict[str, Any]) -> dict[str, str]:
    containers = described["spec"]["template"]["spec"]["template"]["spec"]["containers"]
    return flag_guard.flags_of({"spec": {"containers": containers}})   # a job has no instance limits: flags_of reports them as empty strings, which the declared file simply omits


def parse_declared(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        name, sep, value = line.partition("=")
        if not sep or not name.strip():
            raise SystemExit(f"drift: line {n} is not NAME=value")
        out[name.strip()] = value
    return out


def differences(declared: dict[str, str], live: dict[str, str], allow: set[str]) -> list[str]:
    """What differs, as NAME: declared -> live; empty live scale entries of a job are not settings."""
    live = {k: v for k, v in live.items() if not (k.startswith("@") and v == "" and k not in declared)}
    found: list[str] = []
    for name in sorted(set(declared) | set(live)):
        if name in allow:
            continue
        want, have = declared.get(name), live.get(name)
        if want == IGNORE:
            if have is None:
                found.append(f"{name}: declared (value not in git) -> <unset>")
            continue
        if want != have:
            found.append(f"{name}: {want if want is not None else '<not declared>'} -> {have if have is not None else '<unset>'}")
    return found


def declared_path(env: str, which: str) -> Path:
    return ROOT / "settings" / env / f"{which}.env"


def snapshot_text(env: str, which: str, live: dict[str, str]) -> str:
    kind, name = RESOURCES[which]
    lines = [HEADER.format(kind=kind, name=name, env=env)]
    for key in sorted(live):
        if key.startswith("@") and live[key] == "":
            continue
        lines.append(f"{key}={IGNORE if key in PRIVATE else live[key]}\n")
    return "".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 6 or argv[1] not in ("check", "snapshot") or argv[3] not in RESOURCES:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, env, which, project, region = argv[1:6]
    allow = set(argv[7].split(",")) if len(argv) > 7 and argv[6] == "--allow" else set()
    kind, name = RESOURCES[which]
    # `env` names a folder under deploy/settings (staging, production): never a path
    if env not in ("staging", "production"):
        print("drift: the environment is staging or production", file=sys.stderr)
        return 2
    live = live_flags(kind, name, project, region)
    path = declared_path(env, which)
    if cmd == "snapshot":
        if live is None:
            print(f"drift: {name} does not exist in {project}/{region}: nothing to write", file=sys.stderr)
            return 1
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(snapshot_text(env, which, live), encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT.parent)} ({len(live)} settings)")
        return 0
    if live is None:
        print(f"drift: {name} does not exist yet in {project}/{region}: nothing to compare (take a snapshot after its first deploy)")
        return 0
    if not path.is_file():
        print(f"drift: {path.relative_to(ROOT.parent)} is missing: run `python3 deploy/drift.py snapshot {env} {which} {project} {region}` and review it", file=sys.stderr)
        return 3
    found = differences(parse_declared(path.read_text(encoding="utf-8")), live, allow)
    if found:
        print(f"DRIFT in {name} ({env}), declared -> live (not allowed by ALLOW_FLAG_CHANGE):", *found, sep="\n  ", file=sys.stderr)
        return 3
    print(f"{name} ({env}) matches its declared settings")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
