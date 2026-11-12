#!/usr/bin/env python3
"""Flags must not change silently between two revisions of a Cloud Run service (12 Nov 2026: a deploy without TELEPHONY_OUTBOUND=1 switched test calls off on staging and nobody saw it until the owner's test; the same
day a deploy without TELEPHONY_INBOUND=1 API_MIN_INSTANCES=1 dropped 22 telephony settings and the warm instance, and the new revision already had all the traffic when the check ran).

The deploy scripts now create the new revision WITHOUT traffic, run `compare` against it, and only then move the traffic (deploy/api_guard.sh). So:

  flag_guard.py snapshot PROJECT REGION SERVICE OUT.json     write the environment of the revision that SERVES traffic (names and values; a secret is shown as its secret NAME, never its value) and its min/max instances
  flag_guard.py compare  PROJECT REGION SERVICE BEFORE.json [--revision NAME] [--allow NAME,NAME]   compare a revision (default: the newest one created, the one a deploy just made) with BEFORE; exit 3 and list every difference not named in --allow
  flag_guard.py show     PROJECT REGION SERVICE NAME         print one variable of the revision that serves traffic (empty when unset; "@minScale" and "@maxScale" are the instance limits)
  flag_guard.py serving  PROJECT REGION SERVICE              print the name of the revision that serves most of the traffic
  flag_guard.py created  PROJECT REGION SERVICE              print the name of the newest revision created (it may serve nothing yet)

Differences are printed as NAME: before -> after. No secret value is ever read: a secret-backed variable is compared by the secret's name and key."""

from __future__ import annotations

import json
import subprocess
import sys
from typing import Any

SCALE = "autoscaling.knative.dev/minScale", "autoscaling.knative.dev/maxScale"


def _gcloud_json(args: list[str]) -> dict[str, Any]:
    out = subprocess.run(["gcloud", "run", *args, "--format=json"], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def describe(project: str, region: str, service: str) -> dict[str, Any]:
    return _gcloud_json(["services", "describe", service, "--project", project, "--region", region])


def describe_revision(project: str, region: str, name: str) -> dict[str, Any]:
    return _gcloud_json(["revisions", "describe", name, "--project", project, "--region", region])


def serving_revision(service_json: dict[str, Any]) -> str:
    """The revision that has most of the traffic. NOT the service's template: after a rollback the template is still the newest (rolled-back) revision's."""
    best: tuple[int, str] | None = None
    for t in service_json.get("status", {}).get("traffic", []):
        name, percent = t.get("revisionName"), int(t.get("percent") or 0)
        if name and percent > 0 and (best is None or percent > best[0]):
            best = (percent, str(name))
    if best:
        return best[1]
    ready = service_json.get("status", {}).get("latestReadyRevisionName")
    if not ready:
        raise SystemExit("no revision serves traffic")
    return str(ready)


def created_revision(service_json: dict[str, Any]) -> str:
    name = service_json.get("status", {}).get("latestCreatedRevisionName")
    if not name:
        raise SystemExit("no revision has been created")
    return str(name)


def flags_of(resource: dict[str, Any]) -> dict[str, str]:
    """The settings of a service (its template) or of a revision (the same shape one level up)."""
    spec = resource["spec"]
    if "template" in spec:
        template = spec["template"]
        containers = template["spec"]["containers"]
        annotations = template.get("metadata", {}).get("annotations", {})
    else:
        containers = spec["containers"]
        annotations = resource.get("metadata", {}).get("annotations", {})
    out: dict[str, str] = {}
    for e in containers[0].get("env", []):
        if "value" in e:
            out[e["name"]] = e["value"]
        else:
            ref = (e.get("valueFrom") or e.get("valueSource") or {}).get("secretKeyRef") or {}
            out[e["name"]] = ("secret:" + str(ref.get("name") or ref.get("secret") or "") + ":" + str(ref.get("key") or "")) if ref else ""   # no value and no secret: an empty setting (Cloud Run leaves the value out)
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


def _options(rest: list[str]) -> tuple[str | None, set[str]]:
    revision: str | None = None
    allow: set[str] = set()
    i = 0
    while i < len(rest):
        if rest[i] == "--revision" and i + 1 < len(rest):
            revision = rest[i + 1]
        elif rest[i] == "--allow" and i + 1 < len(rest):
            allow = {a for a in rest[i + 1].split(",") if a}
        else:
            raise SystemExit(__doc__)
        i += 2
    return revision, allow


def main(argv: list[str]) -> int:
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    cmd, project, region, service = argv[1:5]
    if cmd == "snapshot":
        name = serving_revision(describe(project, region, service))
        with open(argv[5], "w") as fh:
            json.dump(flags_of(describe_revision(project, region, name)), fh, sort_keys=True, indent=1)
        print(f"snapshot of {name}", file=sys.stderr)
        return 0
    if cmd == "show":
        print(flags_of(describe_revision(project, region, serving_revision(describe(project, region, service)))).get(argv[5], ""))
        return 0
    if cmd == "serving":
        print(serving_revision(describe(project, region, service)))
        return 0
    if cmd == "created":
        print(created_revision(describe(project, region, service)))
        return 0
    if cmd == "compare":
        with open(argv[5]) as fh:
            before = json.load(fh)
        revision, allow = _options(argv[6:])
        name = revision or created_revision(describe(project, region, service))
        found = differences(before, flags_of(describe_revision(project, region, name)), allow)
        if found:
            print(f"FLAGS CHANGED on {service} revision {name} (not allowed by ALLOW_FLAG_CHANGE):", *found, sep="\n  ", file=sys.stderr)
            return 3
        print(f"flags unchanged on {service} revision {name} ({len(before)} settings compared)")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
