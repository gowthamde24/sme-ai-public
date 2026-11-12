"""Split the integration tests into N parts of about equal time (CI speed, owner 12 Nov 2026: a pull request under 7 minutes).

    python3 scripts/ci/shard_integration.py <parts> <part 1..N>   ->  the test files of that part, one per line, as paths from services/ai-api (../../tests/integration/test_x.py)

Every `tests/integration/test_*.py` file is in exactly one part (a file the timing list does not know yet counts as an average file), so a NEW test file lands in some part automatically and none can be
left out. The parts are balanced by the seconds each file took (scripts/ci/integration_test_durations.json; refresh it with scripts/ci/refresh_durations.py from a CI run's junit reports): largest first,
each into the lightest part that does not already hold a file it must be kept apart from (KEEP_APART: two files that hang when one pytest session runs both)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / "tests" / "integration"
DURATIONS = Path(__file__).with_name("integration_test_durations.json")
# these two hang when ONE local pytest session runs both (30 Oct 2026); they have always been in different CI groups
KEEP_APART = [("test_followup_api.py", "test_followup_due_candidates.py")]


def parts(n: int) -> list[list[str]]:
    files = sorted(p.name for p in TESTS.glob("test_*.py"))
    known: dict[str, float] = json.loads(DURATIONS.read_text(encoding="utf-8")) if DURATIONS.exists() else {}
    default = known.pop("__default__", None)   # what an unknown file is worth (until a CI run has measured every file)
    average = float(default) if default is not None else (sum(known.values()) / len(known) if known else 1.0)
    weight = {f: float(known.get(f, average)) for f in files}
    apart: dict[str, set[str]] = {}
    for a, b in KEEP_APART:
        apart.setdefault(a, set()).add(b)
        apart.setdefault(b, set()).add(a)
    out: list[list[str]] = [[] for _ in range(n)]
    load = [0.0] * n
    for f in sorted(files, key=lambda x: (-weight[x], x)):
        order = sorted(range(n), key=lambda i: (load[i], i))
        i = next((k for k in order if not apart.get(f, set()) & set(out[k])), order[0])
        out[i].append(f)
        load[i] += weight[f]
    return [sorted(p) for p in out]


def main() -> int:
    n, k = int(sys.argv[1]), int(sys.argv[2])
    if not 1 <= k <= n:
        print("part must be 1..N", file=sys.stderr)
        return 2
    print("\n".join(f"../../tests/integration/{f}" for f in parts(n)[k - 1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
