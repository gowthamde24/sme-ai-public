// npm run audit:route-js (job CF): the JavaScript budget of EVERY page route, from the build alone. No server, no browser, no network: about a second after `npm run build`.
// What a route loads on a first visit is the framework's root files (build-manifest.json "rootMainFiles") plus the chunks of every layout, loading, error and page segment on its way (the "entryJSFiles" of the route's
// page_client-reference-manifest.js); this is the very list Next puts in the page as <script src>, so the sum matches what a phone downloads (checked against a throttled browser run: within 3%). Each file is gzipped at
// level 9 (the way scripts/audit-budget.mjs and the Stage 0 baseline were measured). The 3D Agent OWL and the 3D office are loaded with next/dynamic after the first paint, so they are NOT in this list; their own
// ceilings are scripts/audit-3d.mjs and `office3d` / `agentOwl` in scripts/budget.json.
//
// Budgets: scripts/budget.json "routeJs". An explicit entry for a route wins; otherwise a public route (no /app prefix) is held to `public`, a signed-in route to `app`. Over its budget, exit 1.
// Change a number only with a reason in the commit (a route that grew on purpose); the owner approves a raise of a ceiling.
//   node scripts/audit-route-js.mjs            # check
//   node scripts/audit-route-js.mjs --all      # print every route, not just the largest and the over-budget ones
import fs from "node:fs";
import path from "node:path";

import { ROOT } from "./lib/leak-audit.mjs";
import { judgeRouteJs, readRouteJs } from "./lib/route-js.mjs";

const NEXT = path.join(ROOT, ".next");
const budget = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/budget.json"), "utf8")).routeJs;
const fmt = (n) => n.toLocaleString("en-US");

if (!fs.existsSync(path.join(NEXT, "build-manifest.json"))) {
  console.error("audit:route-js: there is no build here: run `npm run build` first");
  process.exit(2);
}
const rows = readRouteJs(NEXT);
if (rows.length < 20) {
  console.error(`audit:route-js: only ${rows.length} page routes found in .next/server/app: the build is not the one expected`);
  process.exit(2);
}
const { judged, stale } = judgeRouteJs(rows, budget);

let failed = 0;
const all = process.argv.includes("--all");
for (const r of judged.filter((x, i) => all || i < 8 || x.over || x.explicit)) {
  if (r.over) failed += 1;
  console.log(`${r.over ? "OVER " : "ok   "} ${fmt(r.bytes).padStart(8)} B gzip / ${fmt(r.limit).padStart(8)} B  ${String(r.files).padStart(2)} files  ${r.name}${r.explicit ? "" : "  (default)"}`);
}
for (const k of stale) {
  failed += 1;
  console.error(`STALE budget entry for a route that no longer exists: ${k}`);
}
console.log(`\n${rows.length} routes checked; the largest is ${rows[0].name} at ${fmt(rows[0].bytes)} B gzip`);
console.log(failed ? `ROUTE JS BUDGET FAILED (${failed})` : "ROUTE JS BUDGET PASSED");
process.exit(failed ? 1 : 0);
