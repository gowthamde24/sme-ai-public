"""Count the results and list what is still alive: python3 tools/mutation-followups/summary.py [sql|py|web]"""

# ruff: noqa: E501, S608

from __future__ import annotations

import collections
import sys

from common import latest_by_key, load


def main(argv: list[str]) -> int:
    for which in argv or ["sql", "py", "web"]:
        rows = latest_by_key(load(f"{which}.jsonl"))
        print(which, dict(collections.Counter(r["status"] for r in rows.values())))
        for key, r in rows.items():
            if r["status"] in ("survived", "invalid"):
                print(f"  {r['status']:9s} {key[:140]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
