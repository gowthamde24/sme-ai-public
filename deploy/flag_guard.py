#!/usr/bin/env python3
"""Flags must not change silently between two revisions of a Cloud Run service (12 Nov 2026: a deploy without TELEPHONY_OUTBOUND=1 switched test calls off on staging and nobody saw it until the owner's test).

  flag_guard.py snapshot PROJECT REGION SERVICE OUT.json     write the live revision's environment (names and values; a secret is shown as its secret NAME, never its value) and its min/max instances
  flag_guard.py compare  PROJECT REGION SERVICE BEFORE.json [--allow NAME,NAME]   compare the live revision with BEFORE; exit 3 and list every difference not named in --allow
  flag_guard.py show     PROJECT REGION SERVICE NAME         print one variable of the live revision (empty when unset)

Differences are printed as NAME: before -> after. No secret value is ever read: a secret-backed variable is compared by the secret's name and version."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

SCALE = "autoscaling.knative.dev/minScale", "autoscaling.knative.dev/maxScale"


def describe(project: str, region: str, service: str) -> dict[str, Any]:
    out = subprocess.run(["gcloud", "run", "services", "describe", service, "--project", project, "--region", region, "--format=json"], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def flags_of(service_json: dict[str, Any]) -> dict[str, str]:
    template = service_json["spec"]["template"]
    out: dict[str, str] = {}
    for e in template["spec"]["containers"][0].get("env", []):
        if "value" in e:
            out[e["name"]] = e["value"]
        else:
            ref = (e.get("valueFrom") or e.get("valueSource") or {}).get("secretKeyRef") or {}
            out[e["name"]] = ("secret:" + str(ref.get("name") or ref.get("secret") or "") + ":" + str(ref.get("key") or "")) if ref else ""   # no value and no secret: an empty setting (Cloud Run leaves the value out)
    annotations = template.get("metadata", {}).get("annotations", {})
    for key in SCALE:
        out["@" + key.split("/")[-1]] = str(annotations.get(key, ""))
    return out


ALIASES = {"API_MIN_INSTANCES": "@minScale", "API_MAX_INSTANCES": "@maxScale"}   # the deploy script's names for the two instance limits


def differences(before: dict[str, str], after: dict[str, str], allow: set[str]) -> list[str]:
    allow = allow | {ALIASES[a] for a in allow if a in ALIASES}
    lines = []
    for name in sorted(set(before) | set(after)):
        if before.get(name) != after.get(name) and name not in allow:
            lines.append(f"{name}: {before.get(name, '<unset>') or '<empty>'} -> {after.get(name, '<unset>') or '<empty>'}")
    return lines


def main(argv: list[str]) -> int:
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, project, region, service = argv[1:5]
    if cmd == "snapshot":
        json.dump(flags_of(describe(project, region, service)), open(argv[5], "w"), sort_keys=True, indent=1)
        return 0
    if cmd == "show":
        print(flags_of(describe(project, region, service)).get(argv[5], ""))
        return 0
    if cmd == "compare":
        before = json.load(open(argv[5]))
        allow = set(argv[7].split(",")) if len(argv) > 7 and argv[6] == "--allow" else set()
        found = differences(before, flags_of(describe(project, region, service)), {a for a in allow if a})
        if found:
            print(f"FLAGS CHANGED on {service} (not allowed by ALLOW_FLAG_CHANGE):", *found, sep="\n  ", file=sys.stderr)
            return 3
        print(f"flags unchanged on {service} ({len(before)} settings compared)")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
