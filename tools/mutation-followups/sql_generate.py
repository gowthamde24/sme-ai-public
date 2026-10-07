"""The list of SQL mutants: operators applied to every follow-up function, the hand-written ones (sql_manual.py), the guard-function operators, and the statement mutants (triggers, indexes, CHECK and
unique constraints, RLS policies, grants). Every mutant has a stable `key` (function, operator, line, description, occurrence): a re-run after the source changed still finds it."""

# ruff: noqa: E501, S608

from __future__ import annotations

import re
from typing import Any

from common import QUESTION_FILES, latest_definition, query
from sql_manual import M

FUNCS = [
    "app.followup_error", "app.followup_forbid_delete", "app.followup_forbid_truncate", "app.int2_array_within", "app.date_array_ok", "app.int2_array_distinct", "app.followup_template_code",
    "app.followup_drafts_guard_insert", "app.followup_drafts_guard_update", "app.followup_active_policy_version", "app.followup_request_hash", "app.followup_policy_json", "app.followup_stopped",
    "app.followup_gate", "app.followup_build", "app.followup_state_hash", "app.followup_blocker", "app.followup_blocker_inner", "app.followup_result_ok", "app.contacts_discard_followup_drafts",
    "app.followup_json_int", "public.create_followup_policy_version", "public.followup_gate", "app.followup_lock", "public.record_touch", "public.create_followup_draft",
    "public.approve_followup_draft", "public.discard_followup_draft", "public.record_draft_sent", "app.question_drafts_guard_insert", "app.question_drafts_guard_update",
    "public.persist_question_drafts", "public.decide_question_draft",
]  # fmt: skip
# the trigger functions and the refusal helpers get the extra operators: a `raise` removed, an `is distinct from` flipped, a negation removed, a move allowed (the test file switches the draft guard
# trigger off and on itself, so a "trigger disabled" statement mutant is undone by the test: the function is what must be mutated)
GUARD_FUNCS = ["app.followup_drafts_guard_insert", "app.followup_drafts_guard_update", "app.question_drafts_guard_insert", "app.question_drafts_guard_update", "app.followup_forbid_delete", "app.followup_forbid_truncate", "app.followup_deny", "app.followup_error"]  # fmt: skip
CODES = ["SM220", "SM221", "SM222", "SM223", "SM224", "SM225", "SM226", "SM227", "SM228", "SM229"]
TABLES = ["followup_policy_versions", "followup_drafts", "lead_touches", "question_drafts"]


def _code_spans(text: str) -> list[tuple[int, int]]:
    """The parts of a function body that are not comments."""
    body = text.index("as $$") + 5
    spans, pos = [], 0
    for line in text.split("\n"):
        end = pos + len(line)
        comment = line.find("--")
        stop = end if comment < 0 else pos + comment
        low = max(pos, body)
        if stop > low:
            spans.append((low, stop))
        pos = end + 1
    return spans


def _balanced(text: str, i: int) -> int | None:
    depth = 0
    for j in range(i, len(text)):
        if text[j] == "(":
            depth += 1
        elif text[j] == ")":
            depth -= 1
            if depth == 0:
                return j + 1
    return None


def _operators(fn: str) -> list[dict[str, Any]]:
    text = latest_definition(fn)
    spans = _code_spans(text)
    out: list[dict[str, Any]] = []

    def add(op: str, a: int, b: int, new: str, desc: str) -> None:
        if any(s <= a and b <= e for s, e in spans):
            out.append({"fn": fn, "op": op, "start": a, "end": b, "new": new, "desc": desc, "line": text[:a].count("\n") + 1})

    for m in re.finditer(r"perform app\.(followup_error|followup_deny|require_aal2)\([^;]*\);", text):
        add("A", m.start(), m.end(), "null;", "statement removed: " + m.group(0)[:70])
    for m in re.finditer(r"app\.has_tenant_role\(", text):
        end = _balanced(text, m.end() - 1)
        if end:
            add("B", m.start(), end, "true", "role proof removed")
    for m in re.finditer(r"array\[((?:'[a-z]+'(?:, )?)+)\]::public\.app_role\[\]", text):
        elements = re.findall(r"'[a-z]+'", m.group(1))
        if len(elements) > 1:
            for k, gone in enumerate(elements):
                keep = [x for i, x in enumerate(elements) if i != k]
                add("C", m.start(), m.end(), "array[" + ", ".join(keep) + "]::public.app_role[]", f"role list without {gone}")
        if "'viewer'" not in elements:
            add("C", m.start(), m.end(), "array[" + ", ".join([*elements, "'viewer'"]) + "]::public.app_role[]", "role list widened with viewer")
    for m in re.finditer(r"interval '(\d+) (days|minutes|seconds|hours)'", text):
        n = int(m.group(1))
        for d in (1, -1):
            if n + d >= 1:
                add("D", m.start(), m.end(), f"interval '{n + d} {m.group(2)}'", f"interval {n} -> {n + d} {m.group(2)}")
    for m in re.finditer(r"(?<=\s)(<=|>=|<|>)(?=\s)", text):
        flip = {"<": "<=", "<=": "<", ">": ">=", ">=": ">"}[m.group(1)]
        add("E", m.start(), m.end(), flip, f"comparison {m.group(1)} -> {flip}")
    for m in re.finditer(r"(?m)^(\s*(?:if|elsif|and|or)\b[^\n]*?)(\s)(<>|=)(\s)", text):
        if ":=" not in m.group(1):
            add("F", m.start(3), m.end(3), "=" if m.group(3) == "<>" else "<>", f"equality {m.group(3)} flipped")
    for m in re.finditer(r"(>=|>|<=|<|between \d+ and) (\d{2,})\b", text):
        n = int(m.group(2))
        for d in (1, -1):
            add("G", m.start(2), m.end(2), str(n + d), f"constant {n} -> {n + d} after {m.group(1)}")
    for m in re.finditer(r"app\.followup_error\('(SM22\d)'(?:, '([a-z_]+)')?\)", text):
        nxt = CODES[(CODES.index(m.group(1)) + 1) % len(CODES)]
        add("H", m.start(1), m.end(1), nxt, f"SQLSTATE {m.group(1)} -> {nxt}")
    for m in re.finditer(r"for update", text):
        add("I", m.start(), m.end(), "", "row lock (for update) removed")
    if fn in GUARD_FUNCS:
        for m in re.finditer(r"raise exception[^;]*;", text):
            add("R", m.start(), m.end(), "null;", f"raise removed: {m.group(0)[:80]}")
        for m in re.finditer(r"is distinct from", text):
            add("J", m.start(), m.end(), "is not distinct from", "is distinct from -> is not distinct from")
        for m in re.finditer(r"\bnot \(", text):
            add("N", m.start(), m.end(), "(", "negation removed")
        for m in re.finditer(r"new\.status in \('approved', 'discarded'\)", text):
            add("K", m.start(), m.end(), "new.status in ('approved', 'discarded', 'recorded_sent')", "a draft may jump to recorded_sent")
    return out


def _files(fn: str) -> list[str] | None:
    return QUESTION_FILES if "question" in fn else None


def function_mutants() -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for fn in FUNCS:
        seen: dict[str, int] = {}
        for m in _operators(fn):
            base = f"{fn}|{m['op']}|L{m['line']}|{m['desc']}"
            seen[base] = seen.get(base, 0) + 1
            result.append({**m, "key": f"{base}|#{seen[base]}", "kind": "fn", "files": _files(fn)})
    seen_manual: dict[str, int] = {}
    for fn, old, new, desc, nth in M:
        text = latest_definition(fn)
        pos = -1
        for _ in range(nth + 1):
            pos = text.index(old, pos + 1)  # a snippet that is gone is a loud error: the source moved, update sql_manual.py
        base = f"{fn}|manual|{desc}"
        seen_manual[base] = seen_manual.get(base, 0) + 1
        result.append({"fn": fn, "op": "manual", "start": pos, "end": pos + len(old), "new": new, "desc": desc, "line": text[:pos].count("\n") + 1, "key": f"{base}|#{seen_manual[base]}", "kind": "fn", "files": _files(fn)})
    return result


def statement_mutants() -> list[dict[str, Any]]:
    rows: list[tuple[str, str, str]] = []
    for t in TABLES:
        for (name,) in [(x,) for x in query(f"select tgname from pg_trigger where tgrelid = 'public.{t}'::regclass and not tgisinternal order by 1").split("\n") if x]:
            rows.append((f'alter table public.{t} disable trigger "{name}"', f'alter table public.{t} enable trigger "{name}"', f"trigger {name} disabled"))
    rows.append(("alter table public.contacts disable trigger contacts_discard_followup_drafts", "alter table public.contacts enable trigger contacts_discard_followup_drafts", "trigger contacts_discard_followup_drafts disabled"))
    for index in ["followup_drafts_one_active_key", "lead_touches_draft_key", "question_drafts_one_active_key"]:
        rows.append((f"drop index public.{index}", query(f"select pg_get_indexdef('public.{index}'::regclass)"), f"unique index {index} dropped"))
    for t in TABLES:
        constraints = query(f"select conname::text || '|' || contype::text || '|' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.{t}'::regclass and contype in ('c', 'u') order by conname")
        for line in [x for x in constraints.split("\n") if x]:
            name, kind, definition = line.split("|", 2)
            rows.append((f'alter table public.{t} drop constraint "{name}"', f'alter table public.{t} add constraint "{name}" {definition}', f"{'check' if kind == 'c' else 'unique'} {name} on {t}: {definition[:60]}"))
    for t in TABLES:
        for policy in [x for x in query(f"select polname from pg_policy where polrelid = 'public.{t}'::regclass order by 1").split("\n") if x]:
            using = query(f"select pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.{t}'::regclass and polname = '{policy}'")
            restore = f'drop policy if exists "{policy}" on public.{t}; create policy "{policy}" on public.{t} for select to authenticated using ({using})'
            rows.append((f'drop policy "{policy}" on public.{t}; create policy "{policy}" on public.{t} for select to authenticated using (true)', restore, f"RLS {policy}: every row of every workspace readable"))
            wide = using.replace("'owner'::app_role, 'admin'::app_role, 'sales'::app_role", "'owner'::app_role, 'admin'::app_role, 'sales'::app_role, 'viewer'::app_role")
            if wide != using:
                rows.append((f'drop policy "{policy}" on public.{t}; create policy "{policy}" on public.{t} for select to authenticated using ({wide})', restore, f"RLS {policy}: a Viewer may read"))
            rows.append((f'drop policy "{policy}" on public.{t}', restore, f"RLS {policy}: no policy at all (nobody reads)"))
        rows.append((f"alter table public.{t} disable row level security", f"alter table public.{t} enable row level security", f"RLS disabled on {t}"))
        rows.append((f"alter table public.{t} no force row level security", f"alter table public.{t} force row level security", f"RLS not forced on {t}"))
        for privilege in ["insert", "update", "delete"]:
            rows.append((f"grant {privilege} on public.{t} to authenticated", f"revoke {privilege} on public.{t} from authenticated", f"authenticated may {privilege} {t} directly"))
        rows.append((f"grant select on public.{t} to anon", f"revoke select on public.{t} from anon", f"anon may read {t}"))
    names = "'create_followup_policy_version','followup_gate','record_touch','create_followup_draft','approve_followup_draft','discard_followup_draft','record_draft_sent','persist_question_drafts','decide_question_draft'"
    for sig in [x for x in query(f"select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ({names}) order by 1").split("\n") if x]:
        rows.append((f"grant execute on function {sig} to anon", f"revoke execute on function {sig} from anon", f"anon may execute {sig.split('(')[0]}"))
        rows.append((f"revoke execute on function {sig} from authenticated", f"grant execute on function {sig} to authenticated", f"authenticated may not execute {sig.split('(')[0]}"))
    return [{"key": f"stmt|{desc}", "kind": "stmt", "do": do, "undo": undo, "desc": desc, "fn": "", "files": QUESTION_FILES if "question" in desc else None} for do, undo, desc in rows]


def all_mutants() -> list[dict[str, Any]]:
    mutants = function_mutants() + statement_mutants()
    keys = [m["key"] for m in mutants]
    if len(keys) != len(set(keys)):
        raise SystemExit("two mutants have the same key")
    return mutants
