# ruff: noqa: E501
"""The CI shards (owner, 12 Nov 2026): every test file in exactly one part, the two files that hang together kept apart, the parts about as heavy as each other."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def load(name: str):  # type: ignore[no-untyped-def]
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / "ci" / f"{name}.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_every_integration_file_is_in_exactly_one_part_and_the_hanging_pair_is_kept_apart() -> None:
    shard = load("shard_integration")
    everything = sorted(p.name for p in (ROOT / "tests" / "integration").glob("test_*.py"))
    for n in (2, 5, 7, 9):
        out = shard.parts(n)
        flat = [f for part in out for f in part]
        assert sorted(flat) == everything and len(flat) == len(set(flat)), f"{n} parts: a file is missing or twice"
        for a, b in shard.KEEP_APART:
            assert not any(a in part and b in part for part in out), f"{a} and {b} must not share a part"


def test_the_parts_are_balanced_by_the_recorded_seconds() -> None:
    shard = load("shard_integration")
    known = json.loads(shard.DURATIONS.read_text(encoding="utf-8")) if shard.DURATIONS.exists() else {}
    default = known.pop("__default__", None)
    average = float(default) if default is not None else (sum(known.values()) / len(known) if known else 1.0)
    out = shard.parts(7)
    loads = [sum(float(known.get(f, average)) for f in part) for part in out]
    biggest = max(float(known.get(f, average)) for part in out for f in part)
    # the greedy split cannot be worse than the average part plus its biggest single file
    assert max(loads) <= sum(loads) / 7 + biggest + 1e-6, loads


def test_the_unit_parts_cover_every_unit_test_file_once() -> None:
    shard = load("shard_tests")
    everything = sorted(f"tests/{p.name}" for p in (ROOT / "services" / "ai-api" / "tests").glob("test_*.py"))
    out = shard.parts(3)
    flat = [f for part in out for f in part]
    assert sorted(flat) == everything and len(flat) == len(set(flat))


def test_the_workflow_matrix_and_the_shard_command_agree_on_the_number_of_parts() -> None:
    import re

    text = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    block = text.split("\n  db-integration:\n", 1)[1].split("\n  visual:\n", 1)[0]
    parts = re.search(r"part: \[([^\]]*)\]", block)
    command = re.search(r"shard_integration\.py (\d+) \$\{\{ matrix\.part \}\}", block)
    assert parts and command
    listed = [int(x) for x in parts.group(1).split(",")]
    assert listed == list(range(1, int(command.group(1)) + 1)), "the matrix must list every part 1..N of the shard command"
    unit = re.search(r"shard_tests\.py (\d+) \$\{\{ matrix\.part \}\}", text)
    unit_parts = re.search(r"api-tests:.*?part: \[([^\]]*)\]", text, re.S)
    assert unit and unit_parts and [int(x) for x in unit_parts.group(1).split(",")] == list(range(1, int(unit.group(1)) + 1))
