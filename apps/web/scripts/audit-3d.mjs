// npm run audit:3d (run `npm run build` first): the build check of the 3D Office (docs/plans/office-3d-proposal.md, "Lazy-loading plan" 4).
//   1. three.js (the WebGL renderer) is in exactly ONE client chunk: the one `next/dynamic` loads for the Office's 3D view;
//   2. that chunk is within its own budget (scripts/budget.json, "office3d": the gzip size at level 9, the way audit:budget measures);
//   3. no page's first load names it: it appears in the route's react-loadable manifest (fetched on demand) and in no client-reference or build manifest.
// No dependency: Node's fs and zlib. Exit 1 on any violation. It reads files only; it starts nothing.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const WEB = path.resolve(import.meta.dirname, "..");
const NEXT = path.join(WEB, ".next");
const budget = JSON.parse(fs.readFileSync(path.join(WEB, "scripts/budget.json"), "utf8")).office3d;
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
const withRenderer = chunks.filter((f) => fs.readFileSync(f, "utf8").includes("WebGLRenderer"));
console.log(`client chunks: ${chunks.length}; with the WebGL renderer: ${withRenderer.length}`);
if (withRenderer.length !== 1) fail(`three.js must be in exactly one client chunk, found ${withRenderer.length}: ${withRenderer.map((f) => path.basename(f)).join(", ")}`);

for (const file of withRenderer) {
  const body = fs.readFileSync(file);
  const gz = zlib.gzipSync(body, { level: 9 }).length;
  const name = path.basename(file);
  console.log(`3D chunk ${name}: ${fmt(body.length)} B raw, ${fmt(gz)} B gzip (budget ${fmt(budget.maxGzipBytes)} B gzip; ${budget.maxGzipBytes >= gz ? "margin" : "OVER by"} ${fmt(Math.abs(budget.maxGzipBytes - gz))} B)`);
  if (gz > budget.maxGzipBytes) fail(`the 3D chunk is over its budget`);
  // where the chunk is named: only the lazy loader's manifest and the chunk that calls import()
  const manifests = walk(NEXT).filter((f) => /(client-reference-manifest\.js|build-manifest\.json|app-paths-manifest\.json)$/.test(f));
  const first = manifests.filter((f) => fs.readFileSync(f, "utf8").includes(name));
  if (first.length) fail(`the 3D chunk is part of a first load: ${first.map((f) => path.relative(NEXT, f)).join(", ")}`);
  else console.log(`first-load manifests that name it: none (checked ${manifests.length})`);
  const loadable = walk(path.join(NEXT, "server")).filter((f) => f.endsWith("react-loadable-manifest.json") && fs.readFileSync(f, "utf8").includes(name));
  console.log(`lazy-load manifests that name it: ${loadable.map((f) => path.relative(NEXT, f)).join(", ") || "none"}`);
  if (loadable.length === 0) fail("no route lazy-loads the 3D chunk (is the Office wired?)");
}
if (failed) process.exit(1);
console.log("OK  the 3D Office is one lazy chunk, within budget, in no first load");
