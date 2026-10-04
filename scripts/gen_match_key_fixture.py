#!/usr/bin/env python3
"""Generate the pgTAP copy of the match_key golden vectors from the single shared JSON file.

    tests/vectors/match_key.json  --(this script)-->  the block between the GENERATED markers in
    supabase/tests/database/27_match_key.test.sql

The Python test (services/ai-api/tests/test_match_key_vectors.py) reads the same JSON and runs every
row through the PRODUCTION function app.leads.keys.match_key; pgTAP cannot read files, so it carries
this generated copy. A drift test fails when the copy is stale. Usage:

    python3 scripts/gen_match_key_fixture.py            # rewrite the block
    python3 scripts/gen_match_key_fixture.py --check    # exit 1 if the block is stale
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VECTORS = ROOT / "tests" / "vectors" / "match_key.json"
TARGET = ROOT / "supabase" / "tests" / "database" / "27_match_key.test.sql"
BEGIN = (
    "-- BEGIN GENERATED VECTORS "
    "(tests/vectors/match_key.json via scripts/gen_match_key_fixture.py; do not edit)"
)
END = "-- END GENERATED VECTORS"


def sql_literal(value: str | None) -> str:
    """A SQL literal that survives any editor: printable ASCII stays readable, everything else is a
    U&'\\+XXXXXX' escape (so ZWNJ, NEL, bidi marks and the like are visible in the file)."""
    if value is None:
        return "null"
    if all(0x20 <= ord(c) < 0x7F for c in value):
        return "'" + value.replace("'", "''") + "'"
    out: list[str] = []
    for c in value:
        if c == "'":
            out.append("''")
        elif c == "\\":
            out.append("\\\\")
        elif 0x20 <= ord(c) < 0x7F:
            out.append(c)
        else:
            out.append(f"\\+{ord(c):06X}")
    return "U&'" + "".join(out) + "'"


def render_block(vectors: list[dict[str, object]]) -> str:
    rows = []
    for v in vectors:
        cells = (
            sql_literal(str(v["label"])),
            sql_literal(_opt(v["input"])),
            sql_literal(_opt(v["expected"])),
        )
        rows.append("  (" + ", ".join(cells) + ")")
    return BEGIN + "\ninsert into vectors values\n" + ",\n".join(rows) + ";\n" + END


def _opt(value: object) -> str | None:
    return None if value is None else str(value)


def load_vectors() -> list[dict[str, object]]:
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    vectors: list[dict[str, object]] = data["vectors"]
    labels = [str(v["label"]) for v in vectors]
    if len(set(labels)) != len(labels):
        raise SystemExit("vector labels must be unique")
    return vectors


def current_block(text: str) -> str:
    start, end = text.index(BEGIN), text.index(END) + len(END)
    return text[start:end]


def splice(text: str, block: str) -> str:
    start, end = text.index(BEGIN), text.index(END) + len(END)
    return text[:start] + block + text[end:]


def main(argv: list[str]) -> int:
    block = render_block(load_vectors())
    text = TARGET.read_text(encoding="utf-8")
    if "--check" in argv:
        if current_block(text) != block:
            print(
                f"{TARGET.relative_to(ROOT)} is stale: run python3 scripts/gen_match_key_fixture.py"
            )
            return 1
        return 0
    TARGET.write_text(splice(text, block), encoding="utf-8")
    print(f"wrote {len(load_vectors())} vectors into {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
