// One slow web test must not hide behind the 8 s async timeout (planner, 18 Nov 2026). Reads a vitest JSON report and fails when any single test took longer than the limit (3 s)
// unless it is in scripts/slow-tests-baseline.json (today's slow ones, each with the time it may take: a ratchet, the list only shrinks).
//   npx vitest run --reporter=default --reporter=json --outputFile=vitest-report.json && node scripts/check-slow-tests.mjs vitest-report.json
//   node scripts/check-slow-tests.mjs vitest-report.json --write-baseline     (rewrites the baseline from this report: only to shrink it, or at the start)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LIMIT_MS = 3000;
const COLD_FIRST = 2; // the first test of a file may take COLD_FIRST x the limit: the file's modules and first render are cold (planner, 19 Nov: a check that fails at random is a flake)
const GRACE = 2; // a baselined test may be up to 2x its recorded time before it fails (CI machines differ)
const BASELINE_FROM_MS = 1500; // the baseline also holds the tests above this: a test at 2.5 s here may be 3.5 s on a busy runner
const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "slow-tests-baseline.json");
const report = process.argv[2];
if (!report) {
  console.error("usage: node scripts/check-slow-tests.mjs <vitest-report.json> [--write-baseline]");
  process.exit(2);
}
const results = JSON.parse(readFileSync(report, "utf8")).testResults ?? [];
// a test is keyed by its file and a short hash of its full name (never the words: a test name may mention what other guards forbid anywhere in the repository)
const names = {};
const first = new Set(); // keys of the first test of each file
const slow = {};
for (const file of results) {
  let isFirst = true;
  for (const t of file.assertionResults ?? []) {
    const wasFirst = isFirst;
    isFirst = false;
    if ((t.duration ?? 0) > BASELINE_FROM_MS) {
      const key = `${file.name.split("/apps/web/")[1] ?? file.name} > #${createHash("sha1").update(t.fullName).digest("hex").slice(0, 10)}`;
      slow[key] = Math.round(t.duration);
      names[key] = t.fullName;
      if (wasFirst) first.add(key);
    }
  }
}
if (process.argv.includes("--write-baseline")) {
  const sorted = Object.fromEntries(Object.entries(slow).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, JSON.stringify({ note: `Web tests slower than ${BASELINE_FROM_MS} ms when this was written (ms). A test NOT on this list that takes more than ${LIMIT_MS} ms fails CI; these may take up to ${GRACE}x their time. Make one faster, then remove it (the list only shrinks).`, limit_ms: LIMIT_MS, tests: sorted }, null, 1) + "\n");
  console.log(`baseline written: ${Object.keys(sorted).length} slow tests`);
  process.exit(0);
}
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")).tests ?? {} : {};
const bad = Object.entries(slow).filter(([key, ms]) => (key in baseline ? ms > baseline[key] * GRACE : ms > (first.has(key) ? LIMIT_MS * COLD_FIRST : LIMIT_MS)));
if (bad.length) {
  console.error(`${bad.length} web test(s) took longer than ${LIMIT_MS} ms (a slow UI test hides behind the 8 s wait): make them faster, do not add them to the baseline.`);
  for (const [key, ms] of bad.sort((a, b) => b[1] - a[1])) console.error(`  ${ms} ms  ${key}  ${names[key]}${key in baseline ? `  (baseline ${baseline[key]} ms)` : ""}`);
  process.exit(1);
}
console.log(`slow-test check: ok (${Object.keys(slow).length} above ${BASELINE_FROM_MS} ms, all within the baseline or under ${LIMIT_MS} ms)`);
