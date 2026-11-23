#!/usr/bin/env python3
"""Refresh the shard timing files from the junit reports of ONE CI run (owner, 12 Nov 2026: CI under 7 minutes).

    python3 scripts/ci/refresh_durations.py <run id> [--dry-run]

Downloads the artifacts `junit-unit-*` and `junit-int-*` of that run with `gh`, adds up the seconds each test FILE took and writes
`scripts/ci/api_test_durations.json` (unit tests, key `tests/test_x.py`) and `scripts/ci/integration_test_durations.json` (integration tests, key `test_x.py`).
shard_tests.py and shard_integration.py balance their parts with these files; a file they do not know counts as an average file, so a new test is never left out. Run this when the suite changed a lot
(a part that takes much longer than the others in a CI run is the sign)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET  # noqa: S405 - our own CI's reports
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILE = re.compile(r"(test_[A-Za-z0-9_]+)")


def seconds_per_file(report: Path) -> dict[str, float]:
    out: dict[str, float] = {}
    for case in ET.parse(report).getroot().iter("testcase"):  # noqa: S314
        prop = next((p.get("value") for p in case.iter("property") if p.get("name") == "file"), None)   # recorded by tests/integration/conftest.py
        where = prop or case.get("file") or case.get("classname") or ""
        m = FILE.search(where)
        if m:
            out[m.group(1) + ".py"] = out.get(m.group(1) + ".py", 0.0) + float(case.get("time") or 0.0)
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    run, dry = argv[1], "--dry-run" in argv
    unit: dict[str, float] = {}
    integration: dict[str, float] = {}
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["gh", "run", "download", run, "-D", tmp, "-p", "junit-*"], check=True)  # noqa: S603, S607
        for report in sorted(Path(tmp).rglob("*.xml")):
            target = integration if "junit-int" in report.name or "junit-int" in str(report.parent) else unit
            for name, secs in seconds_per_file(report).items():
                target[name] = target.get(name, 0.0) + secs
    print(f"{len(unit)} unit files ({sum(unit.values()):.0f} s), {len(integration)} integration files ({sum(integration.values()):.0f} s)")
    if dry:
        return 0
    if unit:
        (HERE / "api_test_durations.json").write_text(json.dumps({f"tests/{k}": round(v, 1) for k, v in sorted(unit.items())}, indent=1) + "\n", encoding="utf-8")
    if integration:
        (HERE / "integration_test_durations.json").write_text(json.dumps({k: round(v, 1) for k, v in sorted(integration.items())}, indent=1) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
