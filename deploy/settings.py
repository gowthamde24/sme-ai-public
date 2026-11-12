#!/usr/bin/env python3
"""Every setting of a Cloud Run service is DECLARED in the repository (owner, 12 Nov 2026), so a deploy can never lose one and a hand edit in the console shows up as drift.

For the API of an environment `deploy/settings/<env>/` holds three small files, reviewed like code:

  api.env       NAME=value                    plain settings (public values only; a line starting with # is a comment). A value may not contain `|` or a newline.
                NAME=@worker-job:OTHER        "the value is read from the Cloud Run job sme-worker (its OTHER) at deploy time": for values that are not for git (the test fence's phone numbers)
                NAME=@local:OTHER             "the value is read from deploy/settings/<env>/api.local.env (NOT in git: it is in .gitignore) at deploy time": for a personal phone number
                NAME=@env:OTHER               "the value is read from the environment of the deploy (deploy/staging.sh exports it) at deploy time": for the Supabase publishable key (public by design, but a secret scanner cannot tell)
  api.secrets   NAME=secret-name[:version]    a Secret Manager reference (version `latest` unless given). The secret's VALUE is never in the repository, never read here.
  api.scale     min_instances=1 / max_instances=1 / concurrency=80

  settings.py snapshot PROJECT REGION SERVICE DIR      write the three files from the revision that SERVES traffic (the way to start, or to take a hand edit into the file)
  settings.py env-arg DIR [PROJECT REGION]             print the value of `gcloud run deploy --update-env-vars` (the `^|^A=b|C=d` form: a value may hold a comma)
  settings.py secrets-arg DIR                          print the value of `--update-secrets`
  settings.py scale DIR                                print shell assignments: MIN_INSTANCES=1 API_MAX_INSTANCES=1 API_CONCURRENCY=80
  settings.py check PROJECT REGION SERVICE DIR [--revision NAME] [--allow NAME,NAME]
                                                       compare the DECLARED settings with a revision (default: the one that serves); exit 3 and list every difference not named in --allow

A deploy checks the declared files against the serving revision BEFORE it builds (a difference is drift, or a change meant for this deploy: name it in ALLOW_FLAG_CHANGE), deploys WITHOUT traffic, and
deploy/flag_guard.py then compares the new revision with the serving one before the traffic moves (deploy/api_guard.sh)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import flag_guard  # the same reading of a revision as the guard (deploy/flag_guard.py)

NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")
WORKER_REF = re.compile(r"^@worker-job:([A-Z][A-Z0-9_]*)$")
LOCAL_REF = re.compile(r"^@local:([A-Z][A-Z0-9_]*)$")
ENV_REF = re.compile(r"^@env:([A-Z][A-Z0-9_]*)$")
SCALE_KEYS = ("min_instances", "max_instances", "concurrency")
HEADER_ENV = "# Declared settings of the API (plain values, public only). Edit this file in a pull request; a deploy applies it and stops on any difference it was not told about (ALLOW_FLAG_CHANGE).\n"
HEADER_REFS = "# Secret Manager references: NAME=secret-name[:version]. The value is never in git; the owner creates it at a hidden prompt.\n"
HEADER_SCALE = "# Instances and concurrency of the API.\n"


def _lines(path: Path) -> list[tuple[int, str]]:
    return [(i, line.rstrip("\n")) for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1) if line.strip() and not line.lstrip().startswith("#")]


def parse_pairs(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for n, line in _lines(path):
        name, sep, value = line.partition("=")
        if not sep or not NAME.match(name) and path.name != "api.scale":
            raise SystemExit(f"{path}:{n}: expected NAME=value")
        if name in out:
            raise SystemExit(f"{path}:{n}: {name} is declared twice")
        if "|" in value or value != value.strip():
            raise SystemExit(f"{path}:{n}: {name}: a value may not contain | or start/end with a space")
        out[name] = value
    return out


def worker_value(project: str, region: str, name: str) -> str:
    """One value of the Cloud Run job sme-worker (the test fence's numbers are not kept in git: the worker holds the same list)."""
    out = subprocess.run(["gcloud", "run", "jobs", "describe", "sme-worker", "--project", project, "--region", region, "--format=json"], check=True, capture_output=True, text=True).stdout
    job = json.loads(out)
    for c in job["spec"]["template"]["spec"]["template"]["spec"]["containers"]:
        for e in c.get("env", []):
            if e["name"] == name:
                return str(e.get("value", ""))
    return ""


def declared_env(dirpath: Path, project: str = "", region: str = "") -> dict[str, str]:
    env = parse_pairs(dirpath / "api.env")
    for name, value in list(env.items()):
        from_env = ENV_REF.match(value)
        if from_env:
            got = os.environ.get(from_env.group(1), "")
            if not got:
                raise SystemExit(f"{name} is read from the environment variable {from_env.group(1)}, which is not set (deploy/staging.sh exports it)")
            env[name] = got
            continue
        local = LOCAL_REF.match(value)
        if local:
            path = dirpath / "api.local.env"
            if not path.exists():
                raise SystemExit(f"{name} is read from {path}, which is not in git and does not exist on this machine")
            env[name] = parse_pairs(path).get(local.group(1), "")
            continue
        m = WORKER_REF.match(value)
        if m:
            if not project:
                raise SystemExit(f"{name} is read from the worker job: give PROJECT and REGION")
            env[name] = worker_value(project, region, m.group(1))
    return env


def declared_refs(dirpath: Path) -> dict[str, str]:
    return parse_pairs(dirpath / "api.secrets")


def declared_scale(dirpath: Path) -> dict[str, int]:
    raw = parse_pairs(dirpath / "api.scale")
    unknown = set(raw) - set(SCALE_KEYS)
    if unknown:
        raise SystemExit(f"api.scale: unknown keys {sorted(unknown)}")
    return {k: int(v) for k, v in raw.items()}


def declared_flags(dirpath: Path, project: str = "", region: str = "") -> dict[str, str]:
    """The declared settings in the guard's own shape (flag_guard.flags_of): plain NAME -> value, a secret NAME -> secret:<name>:<key>, @minScale / @maxScale."""
    out: dict[str, str] = dict(declared_env(dirpath, project, region))
    for name, ref in declared_refs(dirpath).items():
        ref_name, _, version = ref.partition(":")
        out[name] = f"secret:{ref_name}:{version or 'latest'}"
    scale = declared_scale(dirpath)
    out["@minScale"] = str(scale["min_instances"]) if "min_instances" in scale else ""
    out["@maxScale"] = str(scale["max_instances"]) if "max_instances" in scale else ""
    return out


def env_arg(dirpath: Path, project: str = "", region: str = "") -> str:
    return "^|^" + "|".join(f"{k}={v}" for k, v in declared_env(dirpath, project, region).items())


def refs_arg(dirpath: Path) -> str:
    return ",".join(f"{k}={v if ':' in v else v + ':latest'}" for k, v in declared_refs(dirpath).items())


def write_snapshot(resource: dict[str, Any], dirpath: Path, keep: dict[str, str]) -> None:
    """Write the three files from a revision (the shape of `gcloud run revisions describe --format=json`). `keep`: names whose existing line is a placeholder (@worker-job: / @local: / @env:), which stays."""
    spec = resource["spec"]
    env = spec["containers"][0].get("env", [])
    flags = flag_guard.flags_of(resource)   # plain NAME -> value; a reference NAME -> secret:<name>:<key>; an empty setting -> ""
    plain: dict[str, str] = {}
    refs: dict[str, str] = {}
    for e in env:
        name = str(e["name"])
        if "value" not in e and flags.get(name, "").startswith("secret:"):
            _, ref_name, key = flags[name].split(":", 2)
            refs[name] = ref_name if key in ("latest", "") else f"{ref_name}:{key}"
        else:   # a plain setting, or an EMPTY one (Cloud Run leaves the value out)
            value = str(e.get("value", ""))
            if "|" in value:
                raise SystemExit(f"{name}: the value contains |, which the file format does not allow")
            plain[name] = keep.get(name, value)
    annotations = resource.get("metadata", {}).get("annotations", {})
    scale = [f"min_instances={annotations.get('autoscaling.knative.dev/minScale', '0') or '0'}", f"max_instances={annotations.get('autoscaling.knative.dev/maxScale', '1') or '1'}", f"concurrency={spec.get('containerConcurrency', 80)}"]
    dirpath.mkdir(parents=True, exist_ok=True)
    (dirpath / "api.env").write_text(HEADER_ENV + "".join(f"{k}={plain[k]}\n" for k in sorted(plain)), encoding="utf-8")
    (dirpath / "api.secrets").write_text(HEADER_REFS + "".join(f"{k}={refs[k]}\n" for k in sorted(refs)), encoding="utf-8")
    (dirpath / "api.scale").write_text(HEADER_SCALE + "\n".join(scale) + "\n", encoding="utf-8")


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
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    cmd = argv[1]
    if cmd == "env-arg":
        print(env_arg(Path(argv[2]), *(argv[3:5] if len(argv) >= 5 else ("", ""))))
        return 0
    if cmd == "secrets-arg":
        print(refs_arg(Path(argv[2])))
        return 0
    if cmd == "scale":
        scale = declared_scale(Path(argv[2]))
        names = {"min_instances": "MIN_INSTANCES", "max_instances": "API_MAX_INSTANCES", "concurrency": "API_CONCURRENCY"}
        print(" ".join(f"{names[k]}={v}" for k, v in scale.items()))
        return 0
    if len(argv) < 6:
        print(__doc__, file=sys.stderr)
        return 2
    project, region, service, target = argv[2:6]
    if cmd == "snapshot":
        svc = flag_guard.describe(project, region, service)
        name = flag_guard.serving_revision(svc)
        rev = flag_guard.describe_revision(project, region, name)
        existing = parse_pairs(Path(target) / "api.env") if (Path(target) / "api.env").exists() else {}
        write_snapshot(rev, Path(target), {n: v for n, v in existing.items() if WORKER_REF.match(v) or LOCAL_REF.match(v) or ENV_REF.match(v)})
        print(f"snapshot of {name} written to {target}", file=sys.stderr)
        return 0
    if cmd == "check":
        revision, allow = _options(argv[6:])
        svc = flag_guard.describe(project, region, service)
        name = revision or flag_guard.serving_revision(svc)
        actual = flag_guard.flags_of(flag_guard.describe_revision(project, region, name))
        found = flag_guard.differences(declared_flags(Path(target), project, region), actual, allow)
        if found:
            print(f"DECLARED SETTINGS DIFFER from {service} revision {name} (declared -> actual; not allowed by ALLOW_FLAG_CHANGE):", *found, sep="\n  ", file=sys.stderr)
            return 3
        print(f"declared settings match {service} revision {name} ({len(actual)} settings)")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
