// npm run audit:3d (run `npm run build` first): the build check of the 3D Office (docs/plans/office-3d-proposal.md, "Lazy-loading plan" 4).
//   1. three.js (its core, marked `__THREE__`) is in exactly ONE client chunk, shared by the two `next/dynamic` entries that need it: the Office's 3D view and Agent OWL on Today;
//   2. each entry (all the chunks one dynamic import loads) is within its own budget (scripts/budget.json, "office3d" and "agentOwl": gzip level 9, the way audit:budget measures);
//   3. no page's first load names any of those chunks: they appear in the routes' react-loadable manifests (fetched on demand) and in no client-reference or build manifest.
// No dependency: Node's fs and zlib. Exit 1 on any violation. It reads files only; it starts nothing.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const WEB = path.resolve(import.meta.dirname, "..");
const NEXT = path.join(WEB, ".next");
const fmt = (n) => n.toLocaleString("en-US");
const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);

let failed = false;
const fail = (m) => {
  failed = true;
  console.error(`FAIL  ${m}`);
};

const chunks = walk(path.join(NEXT, "static/chunks")).filter((f) => f.endsWith(".js"));
if (chunks.length === 0) {
  console.error("No build found: run `npm run build` first.");
  process.exit(1);
}
const gzip = (f) => zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length;
// three's own core carries `__THREE__` (the revision tag); react-three-fiber and our code only mention WebGLRenderer by name. The core must exist exactly once, shared by every lazy entry that needs it.
const core = chunks.filter((f) => fs.readFileSync(f, "utf8").includes("__THREE__"));
console.log(`client chunks: ${chunks.length}; with three's core: ${core.length}`);
if (core.length !== 1) fail(`three.js must be in exactly one client chunk, found ${core.length}: ${core.map((f) => path.basename(f)).join(", ")}`);

// Every lazy entry (a next/dynamic import) that loads the core, per route. Two exist: the 3D Office (three + fiber + drei + the scene, `office3d` budget) and Agent OWL on Today (three + the owl, `agentOwl` budget).
const loadable = walk(path.join(NEXT, "server")).filter((f) => f.endsWith("react-loadable-manifest.json"));
const entries = new Map(); // key = the sorted file list; value = { files, routes }
for (const m of loadable) {
  const json = JSON.parse(fs.readFileSync(m, "utf8"));
  for (const e of Object.values(json)) {
    const files = (e.files ?? []).filter((f) => f.endsWith(".js")).map((f) => path.join(NEXT, f)).sort();
    if (!core.some((c) => files.includes(c))) continue;
    const key = files.join("|");
    const have = entries.get(key) ?? { files, routes: new Set() };
    have.routes.add(path.relative(NEXT, m));
    entries.set(key, have);
  }
}
if (entries.size === 0) fail("no route lazy-loads three.js (is the Office or Today wired?)");
const manifests = walk(NEXT).filter((f) => /(client-reference-manifest\.js|build-manifest\.json|app-paths-manifest\.json)$/.test(f));
const budgets = JSON.parse(fs.readFileSync(path.join(WEB, "scripts/budget.json"), "utf8"));
const seen = new Set();
for (const { files, routes } of entries.values()) {
  const isOffice = files.some((f) => fs.readFileSync(f, "utf8").includes("OrbitControls"));
  const which = isOffice ? "office3d" : "agentOwl";
  seen.add(which);
  const budget = budgets[which].maxGzipBytes;
  const gz = files.reduce((n, f) => n + gzip(f), 0);
  console.log(`${which} entry (${files.map((f) => path.basename(f)).join(", ")}): ${fmt(gz)} B gzip (budget ${fmt(budget)} B; ${budget >= gz ? "margin" : "OVER by"} ${fmt(Math.abs(budget - gz))} B), lazy-loaded by ${[...routes].join(", ")}`);
  if (gz > budget) fail(`the ${which} entry is over its budget`);
  for (const f of files) {
    const name = path.basename(f);
    const first = manifests.filter((m) => fs.readFileSync(m, "utf8").includes(name));
    if (first.length) fail(`${name} (${which}) is part of a first load: ${first.map((m) => path.relative(NEXT, m)).join(", ")}`);
  }
}
for (const need of ["office3d", "agentOwl"]) if (!seen.has(need)) fail(`no route lazy-loads the ${need} entry (is it wired?)`);
console.log(`first-load manifests that name any of them: none (checked ${manifests.length})`);
if (failed) process.exit(1);
console.log("OK  three.js is one shared core, loaded lazily by the 3D Office and by Agent OWL, each within budget, in no first load");
