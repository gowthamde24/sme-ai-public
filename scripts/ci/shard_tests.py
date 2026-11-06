"""Split the API's unit tests into N parts of about equal time (CI speed, owner 6 Nov 2026).

    python3 scripts/ci/shard_tests.py <parts> <part 1..N>   ->  the test files of that part, one per line (paths relative to services/ai-api)

Every `tests/test_*.py` file is in exactly one part (a file the timing list does not know yet counts as an average file), so a new test file can never be left out. The parts are balanced by the
seconds each file took (scripts/ci/api_test_durations.json; refresh it from a CI run's junit report when the suite changes a lot): largest first, each into the lightest part."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "services" / "ai-api" / "tests"
DURATIONS = Path(__file__).with_name("api_test_durations.json")


def parts(n: int) -> list[list[str]]:
    files = sorted(f"tests/{p.name}" for p in TESTS.glob("test_*.py"))
    known: dict[str, float] = json.loads(DURATIONS.read_text(encoding="utf-8")) if DURATIONS.exists() else {}
    average = sum(known.values()) / len(known) if known else 1.0
    weight = {f: float(known.get(f, average)) for f in files}
    out: list[list[str]] = [[] for _ in range(n)]
    load = [0.0] * n
    for f in sorted(files, key=lambda x: (-weight[x], x)):
        i = load.index(min(load))
        out[i].append(f)
        load[i] += weight[f]
    return [sorted(p) for p in out]


def main() -> int:
    n, k = int(sys.argv[1]), int(sys.argv[2])
    if not 1 <= k <= n:
        print("part must be 1..N", file=sys.stderr)
        return 2
    print("\n".join(parts(n)[k - 1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
