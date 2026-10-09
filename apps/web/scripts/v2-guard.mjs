// npm run guard:v2 [-- <base-ref>] [--allow <glob> ...]: the guard of the workspace redesign (docs/plans/workspace-v2-redesign-plan.md, 4.1).
// Compares HEAD with a base ref (default: the branch before this one in the stack, given as the first argument) and fails when a LOOK batch
//   1. touched a path it may not touch (actions, lib, *-logic, proxy, csp, next.config, API, SQL, contracts, the root layout, globals.css);
//   2. changed any role list line (ROLES / WRITERS / ... / *_ROLES, ADMINS) in the app sources;
//   3. changed the plain-text snapshot of the screens (apps/web/test/screens/__text__), unless the batch is allowed to (--allow-text).
// Nothing is written. Exit 1 on any violation.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
const allowText = args.includes("--allow-text");
const allow = args.flatMap((a, i) => (a === "--allow" ? [args[i + 1]] : []));
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...a) => execFileSync("git", ["-C", root, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const FORBIDDEN = [
  /^apps\/web\/app\/.*\/actions[^/]*\.ts$/,
  /^apps\/web\/app\/.*-actions\.ts$/,
  /^apps\/web\/app\/.*-logic\.ts$/,
  /^apps\/web\/app\/.*\/[a-z-]*logic[^/]*\.ts$/,
  /^apps\/web\/lib\//,
  /^apps\/web\/proxy[^/]*$/,
  /^apps\/web\/lib\/security\//,
  /^apps\/web\/next\.config\.ts$/,
  /^apps\/web\/app\/layout\.tsx$/,
  /^apps\/web\/app\/globals\.css$/,
  /^services\//,
  /^supabase\//,
  /^packages\//,
  /^\.github\//,
  /^(Makefile|lanes\.json|AGENTS\.md|CLAUDE\.md)$/,
  /^docs\/lanes\.md$/,
];
const globToRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
const allowRes = allow.map(globToRe);

let failed = false;
const say = (s) => console.log(s);

// 1. forbidden paths (test files may change, in their own commits; that is checked by the commit rules, not here)
const changed = git("diff", "--name-status", `${base}...HEAD`).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const touched = changed.flatMap((c) => c.slice(1));
const bad = touched.filter((p) => FORBIDDEN.some((r) => r.test(p)) && !allowRes.some((r) => r.test(p)) && !/\.test\.tsx?$/.test(p));
say(`forbidden-path diff against ${base}: ${bad.length === 0 ? "empty (ok)" : "NOT EMPTY"}`);
for (const p of bad) say(`  forbidden: ${p}`);
if (bad.length) failed = true;

// 2. role lists
const ROLE_LINE = /^\s*(?:export\s+)?const\s+([A-Z_]*(?:ROLES|WRITERS|ADMINS)[A-Z_]*)\b[^=]*=\s*(\[[^\]]*\]|new Set\([^)]*\))/gm;
const roleLines = (ref) => {
  const files = git("ls-tree", "-r", "--name-only", ref, "--", "apps/web/app").split("\n").filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  const out = [];
  for (const f of files) {
    const src = git("show", `${ref}:${f}`);
    for (const m of src.matchAll(ROLE_LINE)) out.push(`${f}: ${m[1]} = ${m[2].replace(/\s+/g, " ")}`);
  }
  return out.sort();
};
const before = roleLines(base);
const after = roleLines("HEAD");
const same = JSON.stringify(before) === JSON.stringify(after);
say(`ROLES/WRITERS lines: ${before.length} before, ${after.length} after, ${same ? "identical (ok)" : "DIFFERENT"}`);
if (!same) {
  failed = true;
  for (const l of before.filter((x) => !after.includes(x))) say(`  - ${l}`);
  for (const l of after.filter((x) => !before.includes(x))) say(`  + ${l}`);
}

// 3. the text snapshot
const snap = git("diff", "--name-status", `${base}...HEAD`, "--", "apps/web/test/screens/__text__").trim();
say(`text snapshot (apps/web/test/screens/__text__): ${snap === "" ? "unchanged (ok)" : allowText ? "changed, allowed for this batch" : "CHANGED"}`);
if (snap !== "") {
  const lines = snap.split("\n");
  for (const l of lines.slice(0, 12)) say(`  ${l}`);
  if (lines.length > 12) say(`  ... and ${lines.length - 12} more`);
  if (!allowText) failed = true;
}

process.exit(failed ? 1 : 0);
